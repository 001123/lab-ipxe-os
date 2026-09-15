# Bun Multi-OS iPXE & Cloud-Init Server

Hệ thống máy chủ HTTP iPXE siêu tốc, gọn nhẹ và linh hoạt được xây dựng hoàn toàn bằng **Bun (TypeScript)**, phục vụ quy trình khởi động và cài đặt tự động không chạm (**Zero-Touch Provisioning - ZTP**) cho môi trường Homelab / Data Center:

- 🐧 **Ubuntu Server 24.04 LTS** (Noble Numbat) qua **Subiquity Autoinstall** & **Cloud-Init**:
  - Hỗ trợ **NFS Boot** (`boot_method: nfs`): Tối ưu cho máy ảo Proxmox RAM khiêm tốn (4–5GB), nạp rootfs trực tiếp qua NFS mà không tải toàn bộ ISO vào RAM.
  - Hỗ trợ **HTTP Boot** (`boot_method: http`): Nạp ISO trực tiếp qua HTTP cho máy chủ vật lý (RAM ≥ 8GB) mà không cần cấu hình NFS server.
  - Tích hợp profile **`k3s-single-node`**: Cài đặt sẵn K3s Single Node, declarative config `/etc/rancher/k3s/config.yaml`, tự động cấu hình dynamic `tls-san` (IP & hostname), symlink `~/.kube/config`, disable swap, tinh chỉnh sysctl/modules mạng Kubernetes.
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
      ├── Tra cứu MAC trong data/state.db (SQLite WAL Mode - Single Source of Truth)
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
                  ──> Server cập nhật trạng thái INSTALLED vào data/state.db để khóa boot loop vĩnh viễn!
```

---

## 2. Các Profile Cài Đặt & Mô Hình Registry Map

Hệ thống quản lý profile cài đặt theo mô hình **Profile Registry Map** (`Record<string, ProfileHandler>`). Mỗi profile được tách thành một file riêng biệt độc lập trong thư mục `src/providers/<os>/profiles/`, cho phép dễ dàng mở rộng và bảo trì theo nguyên lý Open-Closed:

### 2.1. Ubuntu Server 24.04 LTS (`src/providers/ubuntu/profiles/`)

| Profile | Gói cài đặt sẵn | Tinh chỉnh hệ thống tự động |
| :--- | :--- | :--- |
| **`k3s-single-node`** *(Mặc định cho K3s)* | `curl`, `qemu-guest-agent`, `htop`, `iotop`, `net-tools`, `open-iscsi`, `nfs-common`, `ca-certificates` | - Tắt swap trong `/etc/fstab`<br>- Cấu hình sysctl: `net.bridge.bridge-nf-call-iptables=1`, `net.ipv4.ip_forward=1`<br>- Nạp kernel module `overlay`, `br_netfilter`<br>- Tạo file cấu hình `/etc/rancher/k3s/config.yaml` với `write-kubeconfig-mode: "0644"` và dynamic `tls-san` (IP & hostname)<br>- Cài K3s server bản stable (hoặc `custom.k3s_version`), tự động enable systemd service<br>- Cấu hình `~/.kube/config` symlink và `KUBECONFIG` toàn hệ thống |
| **`generic`** | `qemu-guest-agent`, `curl`, `htop`, `vim`, `tmux`, `net-tools`, `git` | Cấu hình máy chủ cơ bản kèm SSH key & tự động nối base late commands |

### 2.2. openSUSE Leap Micro 6.2 (`src/providers/suse-micro/profiles/`)

| Profile | Gói cài đặt sẵn | Tinh chỉnh hệ thống tự động |
| :--- | :--- | :--- |
| **`rke2-single-node`** *(Cụm RKE2)* | `curl`, `ca-certificates`, `tar`, `gzip`, `qemu-guest-agent`, `nfs-client`, `open-iscsi` | - Cài Rancher RKE2 qua RPM method chính thức<br>- Cấu hình SELinux permissive & tắt swap/firewalld<br>- Tinh chỉnh sysctl K8s (`vm.max_map_count = 262144`, `fs.file-max`)<br>- Tắt auto-reboot ban đêm (`rebootmgr strategy=off`)<br>- Bổ sung `/sbin` vào PATH & cấu hình `/etc/crictl.yaml`<br>- Tạo file `/etc/rancher/rke2/config.yaml` hỗ trợ CNI (`canal`/`cilium`), Ingress, token, dynamic TLS SAN<br>- Kích hoạt systemd `rke2-server.service` và tạo symlink `~/.kube/config`<br>*(Xem [Hướng dẫn Quản trị & Cập nhật openSUSE Leap Micro](docs/suse-micro-update-guide.md))* |
| **`generic`** | `curl`, `qemu-guest-agent`, `git` | Cấu hình hệ thống cơ bản và tự động mở rộng Btrfs filesystem (`btrfs filesystem resize max /`) |


---

## 3. Cấu Hình Khai Báo Máy Chủ & SQLite Single Source of Truth

Toàn bộ cấu hình máy chủ, thông số mạng, storage, profile K8s và trạng thái vòng đời cài đặt được lưu trữ tập trung tại **`data/state.db` (SQLite WAL Mode)** làm **Single Source of Truth** duy nhất:
- **Tự động Seed ban đầu**: Khi khởi động lần đầu (nếu database chưa có dữ liệu), hệ thống tự động đọc cấu hình mẫu từ `config/hosts.yaml` (hoặc `config/hosts.example.yaml`) và seed vào SQLite.
- **Quản lý Full CRUD**: Bạn có thể Thêm (+ Add Node), Sửa (Edit), Xoá vĩnh viễn (Delete) và Khôi phục cài đặt (Reset) trực tiếp trên Web UI Dashboard hoặc qua RESTful API mà không cần mở file thủ công.
- **Xuất / Nhập Backup YAML**: Bất cứ lúc nào bạn cũng có thể xuất toàn bộ cấu hình trong SQLite ra file `hosts.yaml` chuẩn thông qua nút **Export YAML** trên Web UI hoặc endpoint `GET /api/export/yaml`.

### 3.1. Khởi Tạo Cấu Hình Mẫu Ban Đầu (`config/hosts.yaml`)

File `config/hosts.yaml` đóng vai trò là seed ban đầu và mẫu backup (được bảo vệ trong `.gitignore`):
```bash
# Dùng file cấu hình mẫu tổng hợp (khuyên dùng):
cp config/hosts.example.yaml config/hosts.yaml

# Hoặc dùng các template chuyên biệt theo từng hệ điều hành trong thư mục config/examples/:
# - Ubuntu (Generic / K3s Single-Node qua NFS root):
#   cp config/examples/hosts.ubuntu.yaml config/hosts.yaml
# - openSUSE Leap Micro (Generic / RKE2 Single-Node + ArgoCD GitOps):
#   cp config/examples/hosts.suse-micro.yaml config/hosts.yaml
# - Talos Linux (Controlplane / Worker):
#   cp config/examples/hosts.talos.yaml config/hosts.yaml
```

> **Cơ chế Tự Động Fallback**: Khi bạn vừa clone dự án về mà chưa tạo file `config/hosts.yaml`, hệ thống sẽ tự động fallback sang `config/hosts.example.yaml` để seed database, đảm bảo server và test suite luôn chạy ngay lập tức.

### 3.2. Cấu Trúc File Cấu Hình Mẫu

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
    hostname: "k3s-single-node"
    note: "VM Ubuntu 24.04 chạy K3s Single-Node (NFS root boot)"
    os: ubuntu
    version: "24.04"
    profile: k3s-single-node
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
  #   profile: k3s-single-node
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

## 9. Web UI Dashboard & API Quản Trị

### 9.1. Web UI Dashboard (Bulma CSS & HTMX v4)
Mở trực tiếp trên trình duyệt tại:
```
http://localhost:3000/
```
- **Bulma CSS v1.0**: Thiết kế giao diện hiện đại theo chuẩn [Bulma CSS v1.0.4 Overview](https://bulma.io/documentation/start/overview/), hỗ trợ tự động Dark/Light theme theo hệ thống kèm nút toggle trên Navbar.
- **Nâng cấp HTMX v4**: Hệ thống sử dụng HTMX v4 (`4.0.0`). Tham khảo tài liệu và hướng dẫn tại [four.htmx.org/docs](https://four.htmx.org/docs).
- **Kiến trúc file tĩnh `public/`**: Toàn bộ script và style tùy biến được tách sạch sẽ khỏi template HTML và lưu trong thư mục `public/`:
  - `public/js/dashboard.js`: Xử lý modal controllers, HTMX events, auto-polling 3s và điều khiển Dark/Light mode.
  - `public/css/dashboard.css`: Animation pulse dot và các tùy biến giao diện.
- **Quản Trị Full CRUD Trực Quan Ngay Trên UI**:
  - **Nút `+ Add Node`**: Mở Bulma Modal đăng ký máy chủ mới với đầy đủ thông số (MAC, Hostname, OS, Profile, Static IP/DHCP, Gateway, DNS, Target Disk, Note, ArgoCD & GitOps).
  - **Nút `Edit`**: Nằm trên từng hàng trong bảng, mở Modal chỉnh sửa nhanh toàn bộ thông số máy chủ.
  - **Nút `Delete`**: Xoá vĩnh viễn node khỏi database SQLite (tự động xoá hàng khỏi DOM qua HTMX).
  - **Nút `Reset` (1-Click)**: Xóa khóa cài đặt, đưa trạng thái về `PENDING` để tái cài đặt mà vẫn giữ nguyên toàn bộ cấu hình node.
  - **Nút `Export YAML`**: Xuất và tải ngay file `hosts.yaml` backup toàn bộ cấu hình hiện tại trong database.
  - **Nút `Kubeconfig`**: Tải file kubeconfig ngay lập tức cho các node K3s/RKE2 đã cài đặt thành công.
  - **Toggle `Auto-polling (3s)`**: Tự động làm mới bảng trạng thái theo thời gian thực.

### 9.2. Bộ RESTful API Hoàn Chỉnh

Hệ thống cung cấp đầy đủ chuẩn RESTful API cho phép tự động hóa hoặc tích hợp bên thứ ba:

#### 1. Quản lý Host (Full CRUD)
- **Lấy danh sách toàn bộ hosts**:
  ```bash
  curl -s http://localhost:3000/api/hosts
  ```
- **Xem chi tiết cấu hình 1 host theo MAC**:
  ```bash
  curl -s http://localhost:3000/api/hosts/bc:24:11:00:24:33
  ```
- **Tạo mới một host trong SQLite**:
  ```bash
  curl -X POST "http://localhost:3000/api/hosts" \
    -H "Content-Type: application/json" \
    -d '{
      "mac": "52:54:00:12:34:56",
      "hostname": "worker-rke2-01",
      "os": "suse-micro",
      "version": "6.2",
      "profile": "rke2-single-node",
      "ip": "192.168.250.88",
      "gateway": "192.168.250.1",
      "target_disk": "/dev/vda",
      "note": "Worker node tạo qua API"
    }'
  ```
- **Cập nhật cấu hình host**:
  ```bash
  curl -X PUT "http://localhost:3000/api/hosts/52:54:00:12:34:56" \
    -H "Content-Type: application/json" \
    -d '{
      "hostname": "worker-rke2-renamed",
      "ip": "192.168.250.89",
      "note": "Cập nhật IP và mô tả mới"
    }'
  ```
- **Xoá vĩnh viễn host khỏi database**:
  ```bash
  curl -X DELETE "http://localhost:3000/api/hosts/52:54:00:12:34:56"
  ```

#### 2. Backup & Export
- **Xuất toàn bộ database ra file YAML**:
  ```bash
  curl -s http://localhost:3000/api/export/yaml > hosts.backup.yaml
  ```

#### 3. Vòng đời Cài đặt & Tiện ích
- **Reset trạng thái cài đặt (về `PENDING`)**:
  ```bash
  curl -X POST "http://localhost:3000/api/reset?mac=bc:24:11:00:24:33"
  ```
- **Webhook Phone-Home** (Cloud-Init / Combustion gọi khi cài xong):
  ```bash
  curl -X POST "http://localhost:3000/api/installed?mac=bc:24:11:00:24:33&hostname=k3s-single-node&os=ubuntu"
  ```
- **Cập nhật ghi chú cho node**:
  ```bash
  curl -X POST "http://localhost:3000/api/note" \
    -H "Content-Type: application/json" \
    -d '{"mac": "bc:24:11:00:24:33", "note": "Node master K3s phòng lab"}'
  ```
- **Lấy Kubeconfig của Node K3s / RKE2**:
  ```bash
  # Tải file YAML:
  curl -s http://localhost:3000/api/kubeconfig/rke2-single-node-i5 > kubeconfig-rke2.yaml

  # Pipe trực tiếp cho kubectl:
  curl -s http://localhost:3000/api/kubeconfig/rke2-single-node-i5 | kubectl --kubeconfig=/dev/stdin get nodes
  ```
- **Kiểm tra trạng thái server**:
  ```bash
  curl http://localhost:3000/health
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
k3s-single-node   Ready    control-plane   4m30s   v1.36.4+k3s1   192.168.250.33   <none>        Ubuntu 24.04.5 LTS   7.0.0-31-generic (amd64)   containerd://2.3.4-k3s1.36

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
