---
layout: home

hero:
  name: "lab-ipxe-os"
  text: "Multi-OS iPXE & Cloud-Init Hub"
  tagline: "A high-performance, lightweight network autoinstall server for Bare-metal and Virtual Machines powered by Bun & TypeScript."
  actions:
    - theme: brand
      text: Get Started
      link: /en/HOW_IT_WORKS
    - theme: alt
      text: View on GitHub
      link: https://github.com/001123/lab-ipxe-os
    - theme: alt
      text: Download Releases
      link: https://github.com/001123/lab-ipxe-os/releases

features:
  - icon: 🚀
    title: Standalone Single Binary
    details: No Node.js or complex dependencies required. Pre-packaged with an embedded Web UI, SQLite database, and HTTP Byte-Range static asset server.
  - icon: 🔄
    title: Anti-Boot Loop Mechanism
    details: Smart MAC-based State Machine in SQLite. Once provisioning completes, nodes automatically boot from local disk instead of re-installing.
  - icon: 🐧
    title: Multi-OS Installation Engine
    details: Automated provisioning support for Ubuntu (Subiquity & Cloud-Init), Talos Linux (immutable K8s without SSH), and openSUSE Leap Micro (Combustion/Ignition).
  - icon: 📊
    title: Web UI & Live WebSocket Logs
    details: Modern management dashboard to monitor provisioning state, configure node inventories via SQLite, and stream live terminal logs over WebSocket.
  - icon: 📦
    title: Smart Asset Mirroring
    details: Automated downloading, extraction, and local hosting of ISOs, vmlinuz kernels, and initrd ramdisks with HTTP Byte-Range support.
  - icon: ⚙️
    title: CI/CD & Kubernetes Out-of-the-Box
    details: Automated single-node bootstrapping for K3s and RKE2, ArgoCD GitOps integration, remote Kubeconfig generation, and phone-home webhooks.
---

## Quick Start

### 1. Download the Standalone Executable

Download the precompiled binary for your architecture from [GitHub Releases](https://github.com/001123/lab-ipxe-os/releases):

```bash
# Example for Linux x64
tar -xzf lab-ipxe-os-v1.0.0-linux-x64.tar.gz
cd lab-ipxe-os
./lab-ipxe-os
```

### 2. Configure DHCP / iPXE Chaining

Direct your DHCP server or iPXE client to the boot script endpoint:

```ini
chain http://<SERVER-IP>:3000/boot.ipxe?mac=${net0/mac}
```

### 3. Explore Detailed Documentation

- [End-to-End Architecture & Workflow (HOW_IT_WORKS)](/en/HOW_IT_WORKS)
- [Anti-Boot Loop & State Machine](/en/anti-boot-loop)
- [OS Installation Engines & Profiles](/en/os-engines)
- [DHCP Configuration & Network Routing](/en/network-protocols)
