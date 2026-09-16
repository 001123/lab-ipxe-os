# lab-ipxe-os

[![Documentation](https://img.shields.io/badge/Docs-VitePress-646cff?style=flat&logo=vitepress)](https://001123.github.io/lab-ipxe-os/)
[![GitHub Release](https://img.shields.io/github/v/release/001123/lab-ipxe-os?color=blue&logo=github)](https://github.com/001123/lab-ipxe-os/releases)
[![Runtime: Bun](https://img.shields.io/badge/Runtime-Bun-f472b6?style=flat&logo=bun)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A high-performance, lightweight **Multi-OS iPXE and Cloud-Init Autoinstall Server** powered by **Bun** and **TypeScript**. Designed for Zero-Touch Provisioning (ZTP) in Homelabs, Edge Computing, and Data Centers.

> 📖 **Official Documentation**: Detailed guides, architecture deep-dives, and router configs are available at **[https://001123.github.io/lab-ipxe-os/](https://001123.github.io/lab-ipxe-os/)**.

---

## ✨ Key Features

- 🚀 **Single Executable Binary**: Runs standalone without Node.js or external runtime dependencies. Includes embedded Web UI, SQLite database, and HTTP Byte-Range static server.
- 🛡️ **Anti Boot-Loop Mechanism**: Intelligent MAC-based State Machine in SQLite. Automatically switches booting machines to local disk (`sanboot 0x80`) after installation completes.
- 🐧 **Multi-OS Provisioning**:
  - **Ubuntu Server 24.04 LTS** (Subiquity Autoinstall & Cloud-Init, NFS/HTTP root boot)
  - **Talos Linux v1.14.0** (Immutable Kubernetes OS via MachineConfig)
  - **openSUSE Leap Micro 6.2** (Combustion/Ignition automated scripting)
- 📊 **Modern Web UI Dashboard**: Manage nodes, view live installation statuses, edit configurations, and stream server logs in real-time via WebSocket.
- 📦 **Smart Asset Mirroring**: Automatically downloads and manages OS kernels, initrds, and ISO images locally with HTTP Range request support.
- ☸️ **Kubernetes Out-of-the-Box**: Automated single-node bootstrapping for K3s and RKE2, ArgoCD GitOps integration, and real-time remote Kubeconfig retrieval API.

---

## 🚀 Quick Start

### Option 1: Standalone Binary (Recommended)

Download the precompiled binary for your architecture from [GitHub Releases](https://github.com/001123/lab-ipxe-os/releases):

```bash
# Example for Linux x64
tar -xzf lab-ipxe-os-v1.0.0-linux-x64.tar.gz
cd lab-ipxe-os

# Optional: configure your inventory
cp config/hosts.yaml.example config/hosts.yaml

# Run the server
./lab-ipxe-os
```

### Option 2: Docker / Docker Compose

```bash
docker compose up -d
```

### Option 3: Run from Source using Bun

Prerequisite: [Bun](https://bun.sh) (v1.2+) installed.

```bash
# Clone the repository
git clone https://github.com/001123/lab-ipxe-os.git
cd lab-ipxe-os

# Install dependencies
bun install

# Start server
bun start
```

Once running, access the Web UI Dashboard at **http://localhost:3000/**.

---

## 🌐 Network / DHCP Boot Configuration

Configure your router (OPNsense, pfSense, MikroTik, OpenWrt, or dnsmasq) to chainload clients to:

```ini
chain http://<SERVER_IP>:3000/boot.ipxe?mac=${net0/mac}
```

---

## 📚 Documentation & Technical Guides

All comprehensive architecture explanations, step-by-step guides, and configuration templates are hosted on the documentation site:

| Topic | Link |
| :--- | :--- |
| **Architecture & How It Works** | [HOW_IT_WORKS Guide](https://001123.github.io/lab-ipxe-os/HOW_IT_WORKS) |
| **Anti-Boot Loop & State Machine** | [Anti-Boot Loop Deep Dive](https://001123.github.io/lab-ipxe-os/anti-boot-loop) |
| **OS Provisioning & Profiles** | [OS Engines & Profiles](https://001123.github.io/lab-ipxe-os/os-engines) |
| **Router & DHCP Protocols** | [Network Protocols & Setup](https://001123.github.io/lab-ipxe-os/network-protocols) |
| **Kernel & Netboot Synchronization** | [Kernel Sync Guide](https://001123.github.io/lab-ipxe-os/kernel-sync-and-netboot-guide) |
| **openSUSE Leap Micro & Combustion** | [SUSE Micro Guide](https://001123.github.io/lab-ipxe-os/suse-micro-update-guide) |
| **Troubleshooting & Diagnostics** | [Troubleshooting Guide](https://001123.github.io/lab-ipxe-os/troubleshooting) |

---

## 📜 License

This project is open source and available under the [MIT License](LICENSE).
