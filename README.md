# Bun Multi-OS iPXE & Cloud-Init Server

Hệ thống máy chủ HTTP iPXE siêu tốc và linh hoạt được xây dựng hoàn toàn bằng **Bun (TypeScript)**, phục vụ quy trình khởi động và cài đặt tự động không chạm (**Zero-Touch Provisioning**) cho nhiều hệ điều hành:
- 🐧 **Ubuntu Server 24.04 LTS** (Noble Numbat) qua **Subiquity Autoinstall** & **Cloud-Init**
- ☸️ **Talos Linux v1.14.0** (Kubernetes OS bất biến) qua **Talos MachineConfig**
- 🦎 **openSUSE Leap Micro 6.2** qua **Combustion** automated scripting
- 🔌 Dễ dàng mở rộng thêm các OS khác (Debian, Alpine, Fedora CoreOS...) nhờ kiến trúc **OS Provider Registry**.
- 🖥️ **Proxmox Automation**: Thư mục `proxmox/` chứa script tạo nhanh VM test trên Proxmox VE với MAC cố định và ưu tiên boot PXE.

---

## 1. Kiến Trúc Luồng Hoạt Động (Architecture Flow)

```
[ Bare-metal / Proxmox VM ]
            │
            ▼ (1) PXE DHCP & TFTP
[ Router (TFTP / netboot.xyz) ]
            │
            ▼ (2) Chainload HTTP: http://<BUN_IP>:3000/boot.ipxe?mac=${net0/mac}
[ Bun iPXE Server ]
      │
      ├── Tra cứu MAC trong config/hosts.yaml & kiểm tra data/state.json
      │
      ├── ĐÃ CÀI ĐẶT?  ──> Trả về script iPXE boot trực tiếp ổ cứng (sanboot / exit)
      │
      └── CHƯA CÀI?    ──> Hiển thị Menu iPXE đếm ngược 5s
            │
            ├── Nạp Kernel (vmlinuz) & Initrd từ /assets/...
            ├── Tải file ISO (hỗ trợ HTTP Range Requests 206 Partial Content)
            ├── Nạp cấu hình tự động:
            │     - Ubuntu:      GET /os/ubuntu/:mac/user-data (Subiquity Cloud-Init)
            │     - Talos:       GET /os/talos/:mac/config.yaml (Talos MachineConfig)
            │     - SUSE Micro:  GET /os/suse-micro/:mac/combustion/script (Combustion)
            │
            └── Hậu cài đặt:
                  POST /api/installed?mac=:mac (Phone-home Webhook)
                  --> Ghi nhận vào data/state.json để khóa boot loop!
```

---

## 2. Tích Hợp Với Router Sẵn Có (TFTP / netboot.xyz)

Vì Router của bạn đã cài sẵn TFTP và netboot.xyz:
1. **Qua netboot.xyz Menu**:
   - Khi máy tính boot vào menu netboot.xyz -> Chọn **"Custom URLs"** (hoặc Custom Menus).
   - Nhập URL:
     ```
     http://<IP_MÁY_CHỦ_BUN>:3000/boot.ipxe?mac=${net0/mac}
     ```
2. **Hoặc cấu hình Custom iPXE chain trong netboot.xyz**:
   ```ipxe
   chain --autofree http://192.168.1.50:3000/boot.ipxe?mac=${net0/mac}
   ```

---

## 3. Cấu Hình Máy Chủ `config/hosts.yaml`

Mọi máy trong homelab được định nghĩa dạng khai báo (Declarative):

```yaml
# Cấu hình mặc định cho máy lạ (chưa đăng ký MAC)
default:
  os: ubuntu
  version: "24.04"
  profile: generic
  user: homelab
  ssh_authorized_keys:
    - "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... homelab-admin"
  storage:
    layout: direct
    target_disk: "/dev/sda"
  network:
    dhcp: true

# Danh sách máy cố định theo địa chỉ MAC
hosts:
  # 1. Ubuntu Server 24.04 - Docker Host
  "bc:24:11:00:24:04":
    hostname: "srv-docker-01"
    os: ubuntu
    version: "24.04"
    profile: docker-host
    network:
      dhcp: false
      ip: "192.168.1.50"
      netmask: "255.255.255.0"
      gateway: "192.168.1.1"
      nameservers: ["1.1.1.1", "8.8.8.8"]
    storage:
      target_disk: "/dev/sda"

  # 2. Ubuntu Server 24.04 - Kubernetes Worker Node
  "bc:24:11:00:24:05":
    hostname: "k8s-worker-01"
    os: ubuntu
    version: "24.04"
    profile: k8s-node
    network:
      dhcp: true

  # 3. Talos Linux v1.14.0 - K8s Control Plane
  "bc:24:11:00:14:00":
    hostname: "talos-cp-01"
    os: talos
    version: "v1.14.0"
    role: controlplane
    network:
      dhcp: false
      ip: "192.168.1.60"
      gateway: "192.168.1.1"

  # 4. openSUSE Leap Micro 6.2
  "bc:24:11:00:06:20":
    hostname: "suse-micro-01"
    os: suse-micro
    version: "6.2"
    network:
      dhcp: true
```

---

## 4. Quản Lý File Bộ Cài (Assets)

Kiểm tra hoặc tải tự động file kernel/initrd/ISO vào thư mục `assets/`:

```bash
# Kiểm tra danh sách file cần thiết
bun run sync-assets

# Tải tự động các file có sẵn đường dẫn chính thức (ví dụ: Talos Linux)
bun run sync-assets talos --download
```

Cấu trúc lưu trữ assets:
```
assets/
├── ubuntu/24.04/
│   ├── vmlinuz
│   ├── initrd
│   └── ubuntu-24.04.1-live-server-amd64.iso
├── talos/v1.14.0/
│   ├── vmlinuz-amd64
│   └── initramfs-amd64.xz
└── suse-micro/6.2/
    ├── vmlinuz
    ├── initrd
    └── openSUSE-Leap-Micro.x86_64-6.2-Default-SelfInstall.iso
```

---

## 5. Tự Động Tạo VM Test Trên Proxmox VE (`proxmox/`)

Thư mục `proxmox/` giúp bạn tạo ngay các máy ảo test tương ứng với địa chỉ MAC trong cấu hình chỉ bằng 1 lệnh:

1. Thiết lập credentials:
   ```bash
   cp proxmox/credentials.env.example proxmox/credentials.env
   # Điền PVE_HOST, PVE_TOKEN_ID, PVE_TOKEN_SECRET vào credentials.env
   ```

2. Chạy lệnh tạo VM test:
   ```bash
   # Xem hướng dẫn
   bun run proxmox/create-vm.ts

   # Tạo VM test Ubuntu và tự khởi động vào PXE ngay
   bun run proxmox/create-vm.ts --os ubuntu --start

   # Tạo VM test Talos
   bun run proxmox/create-vm.ts --os talos --start

   # Tạo toàn bộ các VM test
   bun run proxmox/create-vm.ts --all

   # Xóa VM test khi xong
   bun run proxmox/create-vm.ts --destroy 9001
   ```

---

## 6. Hướng Dẫn Khởi Chạy Server

### Cách 1: Chạy trực tiếp bằng Bun
```bash
# Cài đặt dependencies (chỉ mất < 1 giây)
bun install

# Chạy development mode (tự reload khi sửa code)
bun run dev

# Hoặc chạy production
bun start
```

### Cách 2: Chạy bằng Docker Compose
```bash
# Khởi động container
docker compose up -d

# Xem log
docker compose logs -f
```

---

## 7. API Quản Trị & Cơ Chế Chống Boot Loop

- **Xem danh sách máy và trạng thái**:
  ```bash
  curl http://localhost:3000/api/hosts
  ```
- **Xóa khóa cài đặt để cho phép cài lại 1 máy**:
  ```bash
  curl -X POST "http://localhost:3000/api/reset?mac=bc:24:11:00:24:04"
  ```
- **Webhook Phone-Home** (do Cloud-Init / Combustion tự gọi khi hoàn tất):
  ```bash
  curl -X POST "http://localhost:3000/api/installed?mac=bc:24:11:00:24:04"
  ```

---

## 8. Chạy Kiểm Thử Tự Động (Tests)

```bash
bun test
```
Toàn bộ 16 bài test kiểm tra nạp cấu hình, parse iPXE, sinh YAML Subiquity, Talos MachineConfig, Combustion script, cơ chế chống boot loop và HTTP Range Request (206) sẽ được thực thi chỉ trong ~100ms.
