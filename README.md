# Bun Multi-OS iPXE & Cloud-Init Server

Hệ thống máy chủ HTTP iPXE siêu tốc, gọn nhẹ và linh hoạt được xây dựng hoàn toàn bằng **Bun (TypeScript)**, phục vụ quy trình khởi động và cài đặt tự động không chạm (**Zero-Touch Provisioning - ZTP**) cho môi trường Homelab / Data Center:

- 🐧 **Ubuntu Server 24.04 LTS** (Noble Numbat) qua **Subiquity Autoinstall** & **Cloud-Init**:
  - Hỗ trợ **NFS Boot** (`boot_method: nfs`): Tối ưu cho máy ảo Proxmox RAM khiêm tốn (4–5GB), nạp rootfs trực tiếp qua NFS mà không tải toàn bộ ISO vào RAM.
  - Hỗ trợ **HTTP Boot** (`boot_method: http`): Nạp ISO trực tiếp qua HTTP cho máy chủ vật lý (RAM ≥ 8GB) mà không cần cấu hình NFS server.
  - Tích hợp profile **`k3s-server`**: Cài đặt sẵn K3s, disable swap, tinh chỉnh sysctl/modules mạng Kubernetes, thiết lập `KUBECONFIG` tự động cho user `homelab`.
- ☸️ **Talos Linux v1.14.0** (Kubernetes OS bất biến) qua **Talos MachineConfig**.
- 🦎 **openSUSE Leap Micro 6.2** qua **Combustion** automated scripting.
- 🔌 Kiến trúc **OS Provider Registry** dạng module, dễ dàng mở rộng thêm OS mới (Debian, Alpine, Fedora CoreOS...).
- 🖥️ **Proxmox VE Automation**: Tích hợp CLI (`proxmox/create-vm.ts` và `proxmox/create-vm.sh`) để tạo, khởi động và xóa nhanh các máy ảo test với địa chỉ MAC và cấu hình chuẩn.
- 🛡️ **Anti-Boot-Loop Mechanism**: Tự động đánh dấu node đã hoàn tất cài đặt qua Webhook phone-home (`/api/installed`) và tự động chuyển sang boot ổ cứng (`sanboot --drive 0x80`) ở các lần khởi động tiếp theo.

> 📚 **Tài Liệu Kỹ Thuật Chi Tiết (Deep-Dive Docs)**:
> - 📖 [**Hướng Dẫn Vận Hành & Kiến Trúc Toàn Trình (HOW_IT_WORKS.md)**](docs/HOW_IT_WORKS.md)
> - 🌐 [Giao thức mạng & Cấu hình Router (network-protocols.md)](docs/network-protocols.md)
> - ⚙️ [Động cơ cài đặt OS & Subiquity Autoinstall (os-engines.md)](docs/os-engines.md)
> - 🛡️ [Cơ chế chống Boot Loop & State Machine (anti-boot-loop.md)](docs/anti-boot-loop.md)
> - 🩺 [Sổ tay chẩn đoán & xử lý sự cố (troubleshooting.md)](docs/troubleshooting.md)

---

## 1. Kiến Trúc Luồng Hoạt Động (Architecture Flow)

```
[ Bare-metal / Proxmox VM ]
            │
            ▼ (1) PXE DHCP & TFTP
[ Router (TFTP / netboot.xyz / iPXE chain) ]
            │
            ▼ (2) Chainload HTTP: http://<BUN_IP>:3000/boot.ipxe?mac=${net0/mac}
[ Bun iPXE Server ]
      │
      ├── Tra cứu MAC trong config/hosts.yaml & kiểm tra data/state.json
      │
      ├── ĐÃ CÀI ĐẶT?  ──> Trả về script iPXE bypass mạng, boot thẳng ổ cứng (sanboot)
      │
      └── CHƯA CÀI?    ──> Hiển thị Menu iPXE đếm ngược (mặc định 5s)
            │
            ├── Nạp Kernel (vmlinuz) & Initrd từ /assets/...
            ├── Lựa chọn phương thức nạp Rootfs:
            │     ├── NFS Boot:  netboot=nfs nfsroot=<NFS_IP>:/srv/nfs/ubuntu-24.04 (Tiết kiệm RAM)
            │     └── HTTP Boot: url=http://<BUN_IP>:3000/assets/.../ubuntu-24.04-live-server-amd64.iso
            │
            ├── Nạp cấu hình tự động:
            │     ├── Ubuntu:      GET /os/ubuntu/:mac/user-data (Subiquity Cloud-Init)
            │     ├── Talos:       GET /os/talos/:mac/config.yaml (Talos MachineConfig)
            │     └── SUSE Micro:  GET /os/suse-micro/:mac/combustion/script (Combustion)
            │
            └── Hậu cài đặt (Late Commands):
                  POST /api/installed?mac=:mac (Phone-home Webhook)
                  ──> Server ghi nhận vào data/state.json để khóa boot loop vĩnh viễn!
```

---

## 2. Các Profile Cài Đặt Sẵn Cho Ubuntu Server

Trong `src/providers/ubuntu/profiles/index.ts`, hệ thống định nghĩa sẵn các profile chuyên dụng:

| Profile | Gói cài đặt sẵn | Tinh chỉnh hệ thống tự động |
| :--- | :--- | :--- |
| **`k3s-server`** *(Mặc định cho K3s)* | `curl`, `qemu-guest-agent`, `htop`, `iotop`, `net-tools`, `open-iscsi`, `nfs-common`, `ca-certificates` | - Tắt swap trong `/etc/fstab`<br>- Cấu hình sysctl: `net.bridge.bridge-nf-call-iptables=1`, `net.ipv4.ip_forward=1`<br>- Nạp kernel module `overlay`, `br_netfilter`<br>- Cài K3s server với cờ `--write-kubeconfig-mode 644`<br>- Cấu hình `KUBECONFIG=/etc/rancher/k3s/k3s.yaml` toàn hệ thống |
| **`docker-host`** | `docker.io`, `containerd`, `docker-compose-v2`, `curl`, `qemu-guest-agent`, `htop` | - Kích hoạt dịch vụ `docker`<br>- Thêm người dùng vào group `docker` |
| **`k8s-node`** | `containerd`, `curl`, `apt-transport-https`, `ca-certificates`, `socat`, `conntrack`, `qemu-guest-agent` | - Tắt swap<br>- Bật forwarding & bridge nf-call<br>- Nạp module kernel chuẩn bị cho kubeadm |
| **`generic`** | `qemu-guest-agent`, `curl`, `htop`, `vim`, `tmux`, `net-tools`, `git` | Cấu hình máy chủ cơ bản kèm SSH key |

---

## 3. Cấu Hình Khai Báo Máy Chủ (`config/hosts.yaml`)

Mọi node trong mạng được quản lý theo mô hình khai báo (**Declarative Infrastructure**):

```yaml
# Cấu hình mặc định áp dụng khi gặp máy lạ (MAC chưa đăng ký)
default:
  os: ubuntu
  version: "24.04"
  profile: generic
  user: homelab
  ssh_authorized_keys:
    - "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... user@laptop"
  storage:
    layout: direct
    target_disk: "/dev/sda"
  network:
    dhcp: true

# Danh mục máy chủ cố định theo địa chỉ MAC
hosts:
  # ----------------------------------------------------------------------------
  # 1. Ubuntu Server 24.04 LTS (K3s Single-Node Cluster trên Proxmox VM)
  # ----------------------------------------------------------------------------
  "bc:24:11:00:24:33":
    hostname: "k3s-master-01"
    os: ubuntu
    version: "24.04"
    profile: k3s-server
    # Máy ảo RAM 4-5GB: dùng NFS để stream rootfs trực tiếp, không ngốn RAM
    custom:
      boot_method: nfs
      nfs_root: "192.168.250.4:/srv/nfs/ubuntu-${version}"
    network:
      dhcp: false
      ip: "192.168.250.33"
      netmask: "255.255.255.0"
      gateway: "192.168.250.1"
      nameservers: ["192.168.250.1", "1.1.1.1"]
    storage:
      target_disk: "/dev/sda"
    force_install: false

  # ----------------------------------------------------------------------------
  # 2. Template cho máy vật lý (Bare-Metal K3s Server)
  # ----------------------------------------------------------------------------
  # "aa:bb:cc:dd:ee:ff":
  #   hostname: "baremetal-k3s-01"
  #   os: ubuntu
  #   version: "24.04"
  #   profile: k3s-server
  #   # Máy thật RAM >= 8GB: dùng HTTP kéo ISO qua mạng mà KHÔNG cần NFS server
  #   custom:
  #     boot_method: http
  #   network:
  #     dhcp: false
  #     ip: "192.168.250.34"
  #     netmask: "255.255.255.0"
  #     gateway: "192.168.250.1"
  #     nameservers: ["192.168.250.1", "1.1.1.1"]
  #   storage:
  #     target_disk: "/dev/nvme0n1" # /dev/nvme0n1 (NVMe) hoặc /dev/sda (SATA SSD)
  #   force_install: false
```

---

## 4. Lựa Chọn Boot Method: NFS Boot vs. HTTP Boot

Hệ thống hỗ trợ linh hoạt 2 cơ chế boot cho Ubuntu Server:

### Cách 1: NFS Boot (`boot_method: nfs`) — Tối ưu cho Máy Ảo RAM thấp (4–5GB)
- **Cơ chế**: Kernel Linux nạp qua iPXE, sau đó gắn rootfs trực tiếp qua giao thức NFS (`boot=casper netboot=nfs nfsroot=...`).
- **Ưu điểm**: Không cần tải file ISO 2.6GB vào RAM; VM chỉ cần 4GB–5GB RAM là cài đặt mượt mà, tránh hoàn toàn lỗi Subiquity bị OOM kill.
- **Yêu cầu**: Cần 1 máy chủ NFS (ví dụ: Synology NAS, TrueNAS, hoặc máy Linux) trích xuất nội dung ISO Ubuntu:
  ```bash
  mkdir -p /srv/nfs/ubuntu-24.04
  mount -o loop ubuntu-24.04-live-server-amd64.iso /mnt
  cp -a /mnt/. /srv/nfs/ubuntu-24.04/
  umount /mnt
  # Cấu hình /etc/exports: /srv/nfs/ubuntu-24.04 *(ro,sync,no_subtree_check)
  ```

### Cách 2: HTTP Boot (`boot_method: http`) — Đơn giản nhất cho Máy Thật (RAM ≥ 8GB)
- **Cơ chế**: Casper tự động tải file ISO từ HTTP server của Bun (`url=http://<IP>:3000/assets/.../ubuntu-24.04-live-server-amd64.iso`) vào RAM.
- **Ưu điểm**: Hoàn toàn độc lập, không cần thiết lập máy chủ NFS phụ trợ.
- **Yêu cầu**: Máy vật lý hoặc máy ảo cần có từ 8GB RAM trở lên.

---

## 5. Tích Hợp Với Router & iPXE Chaining

Khi node khởi động qua PXE:

1. **Chuỗi URL Boot**:
   ```
   http://<IP_MÁY_CHỦ_BUN>:3000/boot.ipxe?mac=${net0/mac}
   ```
2. **Cấu hình trên Router / netboot.xyz**:
   - Nếu bạn dùng **netboot.xyz**: Vào menu -> Chọn **"Custom URLs"** và nhập URL trên.
   - Hoặc thêm dòng sau vào script khởi động:
     ```ipxe
     chain --autofree http://192.168.250.202:3000/boot.ipxe?mac=${net0/mac}
     ```
3. **Các tham số tùy chọn**:
   - `?force=true`: Bỏ qua kiểm tra trạng thái đã cài đặt, ép buộc hiển thị menu cài lại.
   - `?auto=1`: Tự động chọn phương án cài đặt ngay không cần chờ timeout menu.

---

## 6. Quản Lý Assets (`assets/`)

Tự động kiểm tra hoặc tải các file kernel, initrd, ISO vào thư mục `assets/`:

```bash
# Kiểm tra danh sách các file cần thiết
bun run sync-assets

# Tải tự động các file có URL chính thức (Ubuntu netboot kernel/initrd, Talos Linux, SUSE)
bun run sync-assets ubuntu --download
bun run sync-assets talos --download
bun run sync-assets suse-micro --download
```

Cấu trúc thư mục assets:
```
assets/
├── ubuntu/24.04/
│   ├── vmlinuz
│   ├── initrd
│   └── ubuntu-24.04-live-server-amd64.iso
├── talos/v1.14.0/
│   ├── vmlinuz-amd64
│   └── initramfs-amd64.xz
└── suse-micro/6.2/
    ├── vmlinuz
    ├── initrd
    └── openSUSE-Leap-Micro.x86_64-6.2-Default-SelfInstall.iso
```

> **Lưu ý**: Máy chủ tĩnh của Bun hỗ trợ đầy đủ **HTTP Range Requests (Mã phản hồi 206 Partial Content)**, cho phép nạp ISO một cách mượt mà và tối ưu băng thông.

---

## 7. Tự Động Tạo VM Test Trên Proxmox VE (`proxmox/`)

Thư mục `proxmox/` cung cấp công cụ tự động hóa khởi tạo máy ảo thử nghiệm trên Proxmox VE qua API:

### 1. Thiết lập Credentials:
```bash
cp proxmox/credentials.env.example proxmox/credentials.env
```
Điền các giá trị của Proxmox cluster vào `proxmox/credentials.env`:
```ini
PVE_HOST=https://192.168.250.4:8006
PVE_NODE=pve
PVE_TOKEN_ID=root@pam!automation
PVE_TOKEN_SECRET=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
PVE_BRIDGE=vmbr0
PVE_STORAGE=local-lvm
```

### 2. Định nghĩa VM test (`proxmox/test-vms.yaml`):
```yaml
vms:
  - vmid: 9033
    name: "test-ubuntu-k3s"
    os: "ubuntu"
    mac: "bc:24:11:00:24:33"
    cores: 2
    memory: 5120 # 5GB RAM
    disk_size: 30 # GB
    bios: "ovmf" # UEFI boot
```

### 3. Thực thi tạo VM:
```bash
# Tạo VM Ubuntu K3s và bật boot PXE ngay
bun run proxmox:create --os ubuntu --start

# Hoặc tạo theo VMID cụ thể
bun run proxmox:create --vmid 9033 --start

# Xóa và tạo mới lại VM từ đầu
bun run proxmox:create --vmid 9033 --recreate --start

# Dọn dẹp / hủy VM test khi đã thử nghiệm xong
bun run proxmox:create --destroy 9033
```
*(Bạn cũng có thể sử dụng script Bash thay thế: `bash proxmox/create-vm.sh ubuntu`)*

---

## 8. Hướng Dẫn Khởi Chạy Server

### Cách 1: Chạy trực tiếp với Bun (Khuyên dùng)
```bash
# Cài đặt dependencies (< 1 giây)
bun install

# Chạy development mode (tự động reload khi sửa code)
bun run dev

# Chạy production mode
bun start
```

### Cách 2: Chạy bằng Docker Compose
```bash
docker compose up -d
docker compose logs -f
```

### Biến môi trường (`.env`):
| Biến | Mặc định | Mô tả |
| :--- | :--- | :--- |
| `PORT` | `3000` | Cổng dịch vụ HTTP |
| `HOST` | `0.0.0.0` | Địa chỉ IP bind server |
| `BASE_URL` | `http://192.168.250.202:3000` | Địa chỉ URL máy chủ iPXE mà các client truy cập |
| `CONFIG_PATH` | `./config/hosts.yaml` | Đường dẫn file cấu hình node |
| `IPXE_MENU_TIMEOUT` | `5` | Thời gian đếm ngược menu iPXE (giây) |

---

## 9. API Quản Trị & Phone-Home Webhook

- **Kiểm tra trạng thái server**:
  ```bash
  curl http://localhost:3000/health
  ```
- **Xem danh sách toàn bộ máy chủ và trạng thái cài đặt**:
  ```bash
  curl http://localhost:3000/api/hosts
  ```
- **Xem dữ liệu trạng thái (`data/state.json`)**:
  ```bash
  curl http://localhost:3000/api/state
  ```
- **Xóa khóa cài đặt (Reset trạng thái để cho phép cài đặt lại máy)**:
  ```bash
  curl -X POST "http://localhost:3000/api/reset?mac=bc:24:11:00:24:33"
  ```
- **Webhook Phone-Home** (Cloud-Init gọi khi hoàn thành cài đặt):
  ```bash
  curl -X POST "http://localhost:3000/api/installed?mac=bc:24:11:00:24:33&hostname=k3s-master-01&os=ubuntu"
  ```

---

## 10. Chạy Kiểm Thử Tự Động (Test Suite)

Chạy bộ unit test & integration test tích hợp sẵn của Bun:

```bash
# Nếu server chính đang chạy trên port 3000, truyền PORT khác để tránh xung đột:
PORT=3002 bun test
```

Bộ test tự động kiểm thử toàn diện:
- Phân tích và nạp cấu hình `hosts.yaml` (bao gồm lookup MAC, deep merge mặc định, fallback unassigned node).
- Cơ chế quản lý trạng thái và phòng chống boot loop của `StateManager`.
- Khả năng sinh kịch bản iPXE theo cấu hình node.
- Khả năng sinh file autoinstall `#cloud-config` hoàn chỉnh cho K3s server.
- Khả năng phục vụ HTTP 206 Partial Content Range Requests cho file ISO lớn.

---

## 11. Trạng Thái Hoạt Động Thực Tế (Production Verification)

Cluster K3s đã được triển khai và kiểm chứng tự động thành công thông qua quy trình iPXE của dự án:

```bash
$ ssh homelab@192.168.250.33 "kubectl get nodes -o wide; kubectl get pods -A"

NAME            STATUS   ROLES           AGE     VERSION        INTERNAL-IP      EXTERNAL-IP   OS-IMAGE             KERNEL-VERSION             CONTAINER-RUNTIME
k3s-master-01   Ready    control-plane   4m30s   v1.36.4+k3s1   192.168.250.33   <none>        Ubuntu 24.04.5 LTS   7.0.0-31-generic (amd64)   containerd://2.3.4-k3s1.36

NAMESPACE     NAME                                      READY   STATUS      RESTARTS   AGE
kube-system   coredns-54996dc9b4-pvn2v                  1/1     Running     0          4m24s
kube-system   helm-install-traefik-crd-8wxqj            0/1     Completed   0          4m18s
kube-system   helm-install-traefik-mqdbn                0/1     Completed   2          4m18s
kube-system   local-path-provisioner-77b9867795-lr875   1/1     Running     0          4m24s
kube-system   metrics-server-6dc596dfb8-6bn7s           1/1     Running     0          4m23s
kube-system   svclb-traefik-6a2bdc71-hwvq9              2/2     Running     0          3m44s
kube-system   traefik-59b7647586-jwsc9                  1/1     Running     0          3m44s
```
*(Toàn bộ các dịch vụ Kubernetes và Traefik ingress đã sẵn sàng hoạt động ngay sau khi máy tính hoàn tất boot mạng mà không cần bất kỳ thao tác thủ công nào).*
