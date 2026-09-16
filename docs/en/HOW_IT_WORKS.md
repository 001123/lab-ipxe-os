# Architecture & End-to-End Workflow (How It Works)

Welcome to the end-to-end architecture documentation of the **Bun Multi-OS iPXE & Cloud-Init Server**.

This document explains the comprehensive big picture of how a blank, unconfigured machine (Bare-Metal server or Proxmox VE virtual machine) transforms into a fully functional Kubernetes (**K3s**) node from a single power-on trigger (**Zero-Touch Provisioning - ZTP**).

---

## 1. System Architecture Diagram

```mermaid
flowchart TB
    subgraph ClientLayer ["1. Target Machine Layer"]
        VM["Proxmox Virtual Machine<br/>(MAC: bc:24:11:00:24:33)"]
        BM["Bare-Metal Server<br/>(Physical Machine)"]
    end

    subgraph NetworkLayer ["2. Network Infrastructure Layer"]
        Router["Router / DHCP Server<br/>(OPNsense / MikroTik / dnsmasq)"]
        TFTP["TFTP Service<br/>(Serves Stage 1 ipxe.efi)"]
        NFS["NFS Server<br/>(Rootfs share for low-RAM VMs)"]
    end

    subgraph BunLayer ["3. Central Control Engine (Bun HTTP Server)"]
        HTTP["Bun HTTP Server (:3000)"]
        RouterDispatcher["Route Dispatcher<br/>(/boot.ipxe, /os/*, /api/*)"]
        ConfigMgr["ConfigManager<br/>(hosts.yaml Seed & Backup)"]
        StateMgr["StateManager<br/>(data/state.db - SQLite WAL)"]
        AssetServer["StaticAssetServer<br/>(HTTP Range 206 Partial Content)"]
        Registry["OS Provider Registry<br/>(Ubuntu, Talos, SUSE)"]
    end

    subgraph OrchestrationLayer ["4. Automation & Orchestration Layer"]
        PVE["Proxmox VE API<br/>(proxmox/create-vm.ts)"]
    end

    %% Flow connections
    VM -->|"1. DHCP DORA & TFTP"| Router
    BM -->|"1. DHCP DORA & TFTP"| Router
    Router -.->|"Next-Server Option"| TFTP
    TFTP -->|"Delivers ipxe.efi"| VM

    VM -->|"2. iPXE Chainload HTTP"| HTTP
    BM -->|"2. iPXE Chainload HTTP"| HTTP
    HTTP --> RouterDispatcher
    RouterDispatcher --> ConfigMgr
    RouterDispatcher --> StateMgr
    RouterDispatcher --> AssetServer
    RouterDispatcher --> Registry

    VM -->|"3. Mount Rootfs (NFS Boot)"| NFS
    VM -->|"4. Phone-Home Webhook"| HTTP

    PVE -->|"Automated VM Provisioning"| VM
```

---

## 2. End-to-End Sequence Diagram

Below is the real-time interaction lifecycle from node power-on until the Kubernetes cluster reaches a stable, ready state:

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Administrator / PVE
    participant Node as Target Node (VM / Server)
    participant DHCP as Router (DHCP / TFTP)
    participant Bun as Bun Server (:3000)
    participant NFS as NFS Server
    participant OS as Ubuntu Subiquity Installer

    Admin->>Node: Power on machine (PXE Boot First)
    Note over Node,DHCP: Phase 1: Primary Network Initialization (DHCP & TFTP)
    Node->>DHCP: DHCPDISCOVER (Broadcast UDP 67/68)
    DHCP-->>Node: DHCPOFFER (Lease IP + Option 66: Next-Server + Option 67: ipxe.efi)
    Node->>DHCP: TFTP Read Request: ipxe.efi
    DHCP-->>Node: Stream ipxe.efi into RAM

    Note over Node,Bun: Phase 2: iPXE Chainloading to Bun HTTP Server
    Node->>Node: Execute ipxe.efi & send 2nd DHCP request (Option 175)
    DHCP-->>Node: Return URL: http://<BUN_IP>:3000/boot.ipxe?mac=${net0/mac}
    Node->>Bun: HTTP GET /boot.ipxe?mac=bc:24:11:00:24:33
    Bun->>Bun: Query data/state.db (SQLite - Status: NOT INSTALLED)
    Bun-->>Node: Serve dynamic iPXE Boot Script (Kernel args + autoinstall URL)

    Note over Node,Bun: Phase 3: Fetch Kernel, Initrd & Rootfs
    Node->>Bun: HTTP GET /assets/ubuntu/24.04/vmlinuz
    Bun-->>Node: Stream Linux Kernel
    Node->>Bun: HTTP GET /assets/ubuntu/24.04/initrd
    Bun-->>Node: Stream Ramdisk Initrd
    Node->>Node: Boot Live Linux Casper environment
    alt NFS Boot Mode (4GB RAM VMs)
        Node->>NFS: mount -t nfs <NFS_IP>:/srv/nfs/ubuntu-24.04
        NFS-->>Node: Mount rootfs directly without RAM overhead
    else HTTP Boot Mode (Bare-metal servers RAM >= 8GB)
        Node->>Bun: HTTP Range GET /assets/.../ubuntu-24.04.iso (Status 206)
        Bun-->>Node: Stream ISO into tmpfs RAM
    end

    Note over Node,Bun: Phase 4: Subiquity Automated Installation (Cloud-Init)
    Node->>Bun: HTTP GET /os/ubuntu/:mac/meta-data
    Bun-->>Node: Return instance-id & hostname
    Node->>Bun: HTTP GET /os/ubuntu/:mac/user-data
    Bun-->>Node: Return #cloud-config (Storage, Network, Packages, Late Commands)
    Node->>OS: Partition disk, install base OS, configure Netplan

    Note over OS,Bun: Phase 5: Post-Install (Late Commands) & K3s Bootstrap
    OS->>OS: Disable Swap in /etc/fstab
    OS->>OS: Load sysctl net.ipv4.ip_forward=1 & br_netfilter module
    OS->>OS: Install K3s binary (INSTALL_K3S_SKIP_START=true)
    OS->>OS: Configure KUBECONFIG=/etc/rancher/k3s/k3s.yaml
    OS->>Bun: POST /api/installed?mac=bc:24:11:00:24:33 (Phone-Home Webhook)
    Bun->>Bun: Update status to INSTALLED in data/state.db
    Bun-->>OS: HTTP 200 OK (Boot-loop lock confirmed)
    OS->>Node: Installation finished -> Trigger system reboot!

    Note over Node,Bun: Phase 6: Reboot & Handoff to Local Disk
    Node->>DHCP: 3rd DHCPDISCOVER request
    DHCP-->>Node: Option 67: http://<BUN_IP>:3000/boot.ipxe?mac=...
    Node->>Bun: HTTP GET /boot.ipxe?mac=bc:24:11:00:24:33
    Bun->>Bun: Check data/state.db -> Node IS ALREADY INSTALLED!
    Bun-->>Node: iPXE Script: sanboot --no-describe --drive 0x80
    Node->>Node: Boot directly into Ubuntu OS on internal SSD/NVMe
    Node->>Node: Systemd launches K3s Server -> Cluster READY!

    Note over User,Bun: Phase 7: Retrieve Kubeconfig & Cluster Access (Zero-Manual Fetch)
    User->>Bun: HTTP GET /api/kubeconfig/k3s-single-node (or by MAC)
    Bun->>Node: SSH cat /etc/rancher/k3s/k3s.yaml (Real-time, non-cached)
    Node-->>Bun: Raw Kubeconfig (server: 127.0.0.1:6443)
    Bun->>Bun: Automatically rewrite server URL to external IP (192.168.250.33:6443)
    Bun-->>User: Ready-to-use Kubeconfig YAML (or JSON if ?format=json)
    User->>Node: kubectl get nodes (Direct cluster management)
```

---

## 3. Lifecycle Boot Phases

The system operates smoothly by establishing clear boundaries across 7 sequential phases:

| Phase | Responsible Entity | Core Function | Handoff Mechanism |
| :--- | :--- | :--- | :--- |
| **Phase 1: Hardware POST** | Motherboard / NIC PXE ROM | Hardware initialization, enable PXE ROM. | Broadcasts DHCPDISCOVER packet. |
| **Phase 2: Stage 1 iPXE** | TFTP Server | Load `ipxe.efi` (~1MB binary) into RAM memory. | Executes iPXE binary inside EFI environment. |
| **Phase 3: Stage 2 HTTP** | Bun HTTP Server | Query MAC in `data/state.db` (SQLite) and generate customized iPXE boot script. | iPXE `kernel` and `initrd` commands fetch Linux assets. |
| **Phase 4: Live OS Boot** | Linux Casper Environment | Mount root filesystem via **NFS** or load **ISO into RAM tmpfs**. | Launches Canonical's `subiquity` installer process. |
| **Phase 5: Subiquity Engine** | Cloud-Init & Curtin | Fetch configuration from `/os/ubuntu/:mac/user-data`, partition disk, run late-commands. | Fires Phone-Home Webhook `/api/installed` and triggers `reboot`. |
| **Phase 6: Production Run** | Local Disk / K3s / RKE2 | iPXE detects installed state -> executes `sanboot 0x80`. | System boots into OS on local disk; Kubernetes cluster ready. |
| **Phase 7: Cluster Access** | Bun Kubeconfig API | Serves `GET /api/kubeconfig/:identifier` with real-time SSH query and automated IP rewriting. | Delivers ready-to-use YAML/JSON for remote `kubectl` access. |

---

## 4. Declarative Infrastructure Model

The system strictly adheres to **Infrastructure as Code (IaC)** principles. Operators never need to run manual commands on target nodes; all definitions reside declaratively in `config/hosts.yaml`:

1. **Default Configuration Block (`default`)**: Applied to any unrecognized MAC address (Plug-and-play Zero-Touch Provisioning).
2. **Host Configuration Block (`hosts`)**: Per-MAC granular overrides:
   - Hostname, static IP / Netmask / Gateway / DNS.
   - Target Operating System (`ubuntu`, `talos`, `suse-micro`).
   - Specific OS Profile (`k3s-single-node`, `generic`).
   - Rootfs delivery mechanism (`boot_method: nfs` for low-RAM VMs or `boot_method: http` for physical servers).
   - Target installation disk (`target_disk: /dev/sda` or `/dev/nvme0n1`).

---

## 5. Master Navigation Hub

For deeper insights into specific technical components, explore our comprehensive topic guides:

- 🌐 [**Network Protocols & Router Setup** (`network-protocols.md`)](network-protocols.md):
  * In-depth DHCP DORA breakdown and DHCP Options 66, 67, 60, 93, 175.
  * Technical mechanics of Two-Stage Chainloading.
  * Ready-to-use configuration templates for OPNsense/pfSense, MikroTik, dnsmasq, and OpenWrt.
- ⚙️ [**OS Installation Engines** (`os-engines.md`)](os-engines.md):
  * Comprehensive breakdown of Casper, Subiquity Autoinstall, and Cloud-Init.
  * Rootfs delivery showdown: HTTP Range 206 Partial Content vs. NFS Stream Boot.
  * Architectural dissection of the `k3s-single-node` (Ubuntu) and `rke2-single-node` (openSUSE) profiles.
  * Talos Linux MachineConfig and openSUSE Combustion deep dives.
  * Two-tier Provider Registry & Profile Registry Map architecture.
  * Step-by-step guide to adding custom OS Providers and Profiles.
- 🛡️ [**Anti-Boot Loop & State Machine** (`anti-boot-loop.md`)](anti-boot-loop.md):
  * Resolving the infinite boot-loop paradox in Zero-Touch Provisioning.
  * Hardware handoff via `sanboot --drive 0x80 || exit 1`.
  * State Machine architecture with SQLite WAL (`data/state.db`) and Phone-Home Webhooks.
  * Failure recovery scenarios and forced re-installation workflows (`force_install`).
- 🩺 [**Diagnostic & Troubleshooting Handbook** (`troubleshooting.md`)](troubleshooting.md):
  * Layered triage guide from L1/L2 physical networking to Subiquity and Kubernetes.
  * Resolving OOM Killer crashes on memory-constrained 4GB–5GB VMs.
  * Enabling the Emergency Shell and streaming live installation logs in real time.
  * Rapid diagnostic symptom matrix and emergency rescue command reference.
