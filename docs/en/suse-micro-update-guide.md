# Administration & Update Guide for openSUSE Leap Micro (Kubernetes RKE2)

This document provides a comprehensive operational guide for managing, updating, installing software, and performing rollback recovery on nodes running **openSUSE Leap Micro 6.2** hosting **RKE2 (Rancher Kubernetes Engine v2)**.

---

## 1. Understanding Immutable Operating Systems

openSUSE Leap Micro is designed from the ground up as an **Immutable & Transactional OS**:
* **Read-Only Root (`/`) Partition:** The core operating system files are protected in read-only mode. Direct modifications to system directories such as `/usr`, `/lib`, and `/bin` are blocked to prevent state drift, human error, and package conflicts.
* **Writable Btrfs Subvolumes:** Directories requiring persistent read-write operations are separated into dedicated subvolumes:
  * `/etc`: System configuration files (OverlayFS or writable snapshots).
  * `/var`: Container storage, RKE2 state, and logs (`/var/lib/rancher/rke2`, `/var/log`).
  * `/home`: User home directories (`/home/homelab`).
  * `/opt`: Third-party binaries and local persistent storage.
  * `/usr/local`: Custom operator scripts and binaries.
* **Transactional Updates:** OS upgrades and package installations **never mutate the running system**. Instead, `transactional-update` creates a new Btrfs snapshot in the background, applies updates inside that snapshot, and designates it as default for the next reboot. If update processing fails, the snapshot is discarded without impacting the active workload.

---

## 2. Operating System Update Workflow

### 2.1. Scan and Download Updates
To scan for and install security patches, kernel updates, and package fixes:

```bash
sudo transactional-update up
```

This command will:
1. Create a fresh Btrfs snapshot (e.g., snapshot `#3`).
2. Download and apply package updates from openSUSE official repositories into snapshot `#3`.
3. If successful, mark snapshot `#3` as the default boot target for the next reboot.

### 2.2. Inspect Snapshots Post-Update
```bash
sudo snapper list
```
* Snapshots marked with `*` indicate the currently mounted, active snapshot.
* Snapshots marked with `+` denote the next snapshot to be activated on reboot.

```text
 # │ Type   │ Pre # │ Date                     │ User │ Used Space │ Cleanup │ Description           │ Userdata
───┼────────┼───────┼──────────────────────────┼──────┼────────────┼─────────┼───────────────────────┼─────────
0  │ single │       │                          │ root │            │         │ current               │
1  │ single │       │ Mon Jul 20 10:06:07 2026 │ root │ 354.91 MiB │         │ first root filesystem │
2* │ single │       │ Tue Sep 15 09:20:38 2026 │ root │ 389.69 MiB │ number  │ Snapshot Update of #1 │
3+ │ single │       │ Wed Sep 16 10:00:00 2026 │ root │ 120.00 MiB │ number  │ snapshot after update │
```

### 2.3. Reboot to Activate the Updated System

> [!IMPORTANT]
> Because the host runs Kubernetes (RKE2), verify workload status before rebooting. In multi-node clusters, cordon and drain the node first:
> ```bash
> kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data
> ```
> In single-node homelab deployments, ensure critical transactions are quiesced.

Reboot the host:
```bash
sudo reboot
```

Verify the active kernel version and snapshot state upon reboot:
```bash
uname -r
sudo snapper list   # The '*' moves to the new snapshot
kubectl get nodes
```

---

## 3. Package Management with `transactional-update`

> [!WARNING]
> Never execute **`zypper in <package>`** directly on Leap Micro. It will fail with `Read-only file system`.

### 3.1. Install Packages
```bash
sudo transactional-update pkg in <package-name>
```
*Example:* Installing `htop` and `tcpdump`:
```bash
sudo transactional-update pkg in htop tcpdump
```
Once installed, reboot the machine to load the newly created snapshot:
```bash
sudo reboot
```

### 3.2. Remove Packages
```bash
sudo transactional-update pkg rm <package-name>
sudo reboot
```

### 3.3. Interactive Debugging via Writable Shell
When troubleshooting or executing complex manual configuration tasks:
```bash
sudo transactional-update shell
```
* Opens a sub-shell chrooted into a temporary writable snapshot where `zypper` and file modifications are permitted.
* Exit with `exit 0` to commit changes into a new bootable snapshot (requires reboot).
* Exit with `exit 1` to discard all temporary changes without touching the disk.

---

## 4. Reboot Manager (`rebootmgr`)

Leap Micro includes `rebootmgr` to regulate automatic reboots triggered by the `transactional-update.timer` service.

### 4.1. Inspect Status
```bash
rebootmgrctl status
rebootmgrctl get-strategy
```

### 4.2. Strategy Options
1. **`off` (Recommended for Kubernetes Nodes):** Patches are staged in snapshots in the background, but the host **never reboots automatically**. Operators retain full manual control over reboot timing.
   ```bash
   sudo rebootmgrctl set-strategy off
   ```
2. **`maint-window` (Fixed Maintenance Window):** Reboots occur exclusively during pre-scheduled windows (e.g., weekend nights):
   ```bash
   sudo rebootmgrctl set-strategy maint-window
   sudo rebootmgrctl set-window "Sun *-*-* 03:00:00" 02:00
   ```
3. **`best-effort`:** Reboots automatically during default windows (03:30 - 05:00) provided no lock exists.

This setting is stored declaratively in `/etc/rebootmgr.conf`:
```ini
[rebootmgr]
strategy=off
```

---

## 5. Emergency Rollback Recovery

If an update introduces kernel regressions or breaks critical services, rolling back is instantaneous.

### Method 1: CLI Rollback (When SSH is Accessible)
1. List available snapshots:
   ```bash
   sudo snapper list
   ```
2. Revert to the known good snapshot (e.g., snapshot `#2`):
   ```bash
   sudo transactional-update rollback 2
   ```
3. Reboot the machine:
   ```bash
   sudo reboot
   ```
   The node immediately boots back into the exact state of snapshot `#2`.

### Method 2: GRUB Bootloader Rollback (When OS Fails to Boot)
During system boot at the GRUB menu:
1. Select **`Start bootloader from a read-only snapshot`**.
2. Select your desired known good snapshot based on date and time.
3. Log in to the host and permanently commit this snapshot as default:
   ```bash
   sudo transactional-update rollback
   sudo reboot
   ```

---

## 6. Retrofitting Existing Nodes with Optimized Configurations

For openSUSE Leap Micro hosts provisioned prior to recent profile updates, apply these optimizations (Disable Auto-Reboot, Kubernetes Sysctls, `crictl.yaml`, PATH) via SSH:

```bash
# 1. Disable disruptive nighttime auto-reboots
sudo sh -c 'cat <<EOF > /etc/rebootmgr.conf
[rebootmgr]
strategy=off
EOF'
sudo rebootmgrctl set-strategy off || true

# 2. Tune Kernel Sysctl for Kubernetes & high-throughput workloads
sudo sh -c 'cat <<EOF > /etc/sysctl.d/99-kubernetes.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
vm.max_map_count                    = 262144
fs.file-max                         = 2097152
fs.inotify.max_user_watches         = 524288
fs.inotify.max_user_instances       = 8192
EOF'
sudo /sbin/sysctl --system

# 3. Configure crictl to target RKE2 containerd socket
sudo sh -c 'cat <<EOF > /etc/crictl.yaml
runtime-endpoint: unix:///run/k3s/containerd/containerd.sock
image-endpoint: unix:///run/k3s/containerd/containerd.sock
timeout: 10
debug: false
EOF'

# 4. Append /sbin and /usr/sbin to PATH for homelab user
sudo sed -i 's|export PATH=\$PATH:/var/lib/rancher/rke2/bin:/usr/local/bin|export PATH=\$PATH:/var/lib/rancher/rke2/bin:/usr/local/bin:/sbin:/usr/sbin|g' /etc/profile.d/rke2.sh
```
