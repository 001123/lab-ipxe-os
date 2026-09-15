# Hướng Dẫn Vận Hành & Kiến Trúc Toàn Trình (How It Works)

Chào mừng bạn đến với tài liệu kiến trúc toàn trình của hệ thống **Bun Multi-OS iPXE & Cloud-Init Server**.

Tài liệu này giải thích chi tiết bức tranh tổng thể về cách thức một máy tính trắng (Bare-Metal hoặc máy ảo Proxmox VE) chuyển mình thành một máy chủ Kubernetes (**K3s**) hoàn chỉnh chỉ từ một lệnh bật nguồn (**Zero-Touch Provisioning - ZTP**).

---

## 1. Sơ Đồ Kiến Trúc Hệ Thống (System Architecture)

```mermaid
flowchart TB
    subgraph ClientLayer ["1. Tầng Máy Đích (Target Machines)"]
        VM["Proxmox Virtual Machine<br/>(MAC: bc:24:11:00:24:33)"]
        BM["Bare-Metal Server<br/>(Physical Machine)"]
    end

    subgraph NetworkLayer ["2. Tầng Hạ Tầng Mạng (Network Infrastructure)"]
        Router["Router / DHCP Server<br/>(OPNsense / MikroTik / dnsmasq)"]
        TFTP["TFTP Service<br/>(Phục vụ ipxe.efi Stage 1)"]
        NFS["NFS Server<br/>(Chia sẻ Rootfs cho VM RAM thấp)"]
    end

    subgraph BunLayer ["3. Tầng Điều Khiển Trung Tâm (Bun HTTP Engine)"]
        HTTP["Bun HTTP Server (:3000)"]
        RouterDispatcher["Route Dispatcher<br/>(/boot.ipxe, /os/*, /api/*)"]
        ConfigMgr["ConfigManager<br/>(hosts.yaml Seed & Backup)"]
        StateMgr["StateManager<br/>(data/state.db - SQLite WAL)"]
        AssetServer["StaticAssetServer<br/>(HTTP Range 206 Partial Content)"]
        Registry["OS Provider Registry<br/>(Ubuntu, Talos, SUSE)"]
    end

    subgraph OrchestrationLayer ["4. Tầng Tự Động Hóa Quản Trị (Automation)"]
        PVE["Proxmox VE API<br/>(proxmox/create-vm.ts)"]
    end

    %% Flow connections
    VM -->|"1. DHCP DORA & TFTP"| Router
    BM -->|"1. DHCP DORA & TFTP"| Router
    Router -.->|"Chỉ định Next-Server"| TFTP
    TFTP -->|"Cung cấp ipxe.efi"| VM

    VM -->|"2. iPXE Chainload HTTP"| HTTP
    BM -->|"2. iPXE Chainload HTTP"| HTTP
    HTTP --> RouterDispatcher
    RouterDispatcher --> ConfigMgr
    RouterDispatcher --> StateMgr
    RouterDispatcher --> AssetServer
    RouterDispatcher --> Registry

    VM -->|"3. Gắn kết Rootfs (NFS Boot)"| NFS
    VM -->|"4. Phone-Home Webhook"| HTTP

    PVE -->|"Tạo & Khởi động VM tự động"| VM
```

---

## 2. Luồng Vận Hành Toàn Trình (End-to-End Sequence Diagram)

Dưới đây là chu kỳ tương tác thời gian thực từ lúc máy tính được cấp nguồn cho đến khi cụm Kubernetes đi vào hoạt động ổn định:

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Quản Trị Viên / PVE
    participant Node as Target Node (VM / Server)
    participant DHCP as Router (DHCP / TFTP)
    participant Bun as Bun Server (:3000)
    participant NFS as NFS Server
    participant OS as Ubuntu Subiquity Installer

    Admin->>Node: Bật nguồn máy (Power On / PXE Boot First)
    Note over Node,DHCP: Chặng 1: Khởi tạo mạng sơ cấp (DHCP & TFTP)
    Node->>DHCP: DHCPDISCOVER (Broadcast UDP 67/68)
    DHCP-->>Node: DHCPOFFER (Cấp IP + Option 66: Next-Server + Option 67: ipxe.efi)
    Node->>DHCP: TFTP Read Request: ipxe.efi
    DHCP-->>Node: Truyền file ipxe.efi vào RAM

    Note over Node,Bun: Chặng 2: iPXE Chainloading sang Bun HTTP Server
    Node->>Node: Thực thi ipxe.efi & gửi DHCP lần 2 (Option 175)
    DHCP-->>Node: Trả về URL: http://<BUN_IP>:3000/boot.ipxe?mac=${net0/mac}
    Node->>Bun: HTTP GET /boot.ipxe?mac=bc:24:11:00:24:33
    Bun->>Bun: Tra cứu data/state.db (SQLite - Chưa cài đặt)
    Bun-->>Node: Trả về kịch bản iPXE Boot Script (Kernel args + autoinstall)

    Note over Node,Bun: Chặng 3: Nạp Kernel, Initrd & Rootfs
    Node->>Bun: HTTP GET /assets/ubuntu/24.04/vmlinuz
    Bun-->>Node: Truyền Linux Kernel
    Node->>Bun: HTTP GET /assets/ubuntu/24.04/initrd
    Bun-->>Node: Truyền Ramdisk Initrd
    Node->>Node: Khởi chạy Linux Casper môi trường Live
    alt Chế độ NFS Boot (VM RAM 4GB)
        Node->>NFS: mount -t nfs <NFS_IP>:/srv/nfs/ubuntu-24.04
        NFS-->>Node: Gắn kết trực tiếp rootfs không tốn RAM
    else Chế độ HTTP Boot (Máy thật RAM >= 8GB)
        Node->>Bun: HTTP Range GET /assets/.../ubuntu-24.04.iso (Mã 206)
        Bun-->>Node: Tải ISO vào tmpfs RAM
    end

    Note over Node,Bun: Chặng 4: Cài đặt tự động Subiquity (Cloud-Init)
    Node->>Bun: HTTP GET /os/ubuntu/:mac/meta-data
    Bun-->>Node: Trả về instance-id & hostname
    Node->>Bun: HTTP GET /os/ubuntu/:mac/user-data
    Bun-->>Node: Trả về #cloud-config (Storage, Network, Packages, Late Commands)
    Node->>OS: Phân vùng ổ đĩa, cài đặt Base OS, cấu hình Netplan

    Note over OS,Bun: Chặng 5: Hậu cài đặt (Late Commands) & K3s Bootstrap
    OS->>OS: Tắt Swap trong /etc/fstab
    OS->>OS: Nạp sysctl net.ipv4.ip_forward=1 & module br_netfilter
    OS->>OS: Cài đặt K3s nhị phân (INSTALL_K3S_SKIP_START=true)
    OS->>OS: Thiết lập KUBECONFIG=/etc/rancher/k3s/k3s.yaml
    OS->>Bun: POST /api/installed?mac=bc:24:11:00:24:33 (Phone-Home Webhook)
    Bun->>Bun: Cập nhật trạng thái INSTALLED vào data/state.db
    Bun-->>OS: HTTP 200 OK (Xác nhận đã khóa boot loop)
    OS->>Node: Cài đặt hoàn tất -> Reboot máy!

    Note over Node,Bun: Chặng 6: Tái khởi động & Nhường quyền cho ổ cứng
    Node->>DHCP: DHCPDISCOVER lần 3
    DHCP-->>Node: Option 67: http://<BUN_IP>:3000/boot.ipxe?mac=...
    Node->>Bun: HTTP GET /boot.ipxe?mac=bc:24:11:00:24:33
    Bun->>Bun: Kiểm tra data/state.db -> Node ĐÃ CÀI ĐẶT!
    Bun-->>Node: Script: sanboot --no-describe --drive 0x80
    Node->>Node: Nhảy thẳng vào HĐH Ubuntu trên ổ cứng SSD
    Node->>Node: Systemd khởi chạy K3s Server -> Cluster READY!

    Note over User,Bun: Chặng 7: Lấy Kubeconfig & Quản trị Cụm (Zero-Manual Fetch)
    User->>Bun: HTTP GET /api/kubeconfig/k3s-single-node (hoặc theo MAC)
    Bun->>Node: SSH cat /etc/rancher/k3s/k3s.yaml (Real-time, không cache)
    Node-->>Bun: Kubeconfig gốc (server: 127.0.0.1:6443)
    Bun->>Bun: Tự động đổi server URL thành IP ngoài (192.168.250.33:6443)
    Bun-->>User: File kubeconfig YAML (hoặc JSON nếu ?format=json)
    User->>Node: kubectl get nodes (kết nối trực tiếp cluster)
```

---

## 3. Các Chặng Chuyển Đổi Vòng Đời (Lifecycle Boot Phases)

Hệ thống hoạt động mượt mà nhờ việc phân định ranh giới rõ ràng giữa 7 giai đoạn kế tiếp nhau:

| Giai Đoạn | Thực Thể Chịu Trách Nhiệm | Nhiệm Vụ Cốt Lõi | Cơ Chế Bàn Giao (Handoff) |
| :--- | :--- | :--- | :--- |
| **Phase 1: Hardware POST** | Bo mạch chủ / Card mạng | Khởi tạo phần cứng, kích hoạt PXE ROM. | Phát sóng gói tin DHCPDISCOVER. |
| **Phase 2: Stage 1 iPXE** | TFTP Server | Nạp `ipxe.efi` (vài trăm KB) vào bộ nhớ RAM. | Thực thi nhị phân iPXE trong không gian EFI. |
| **Phase 3: Stage 2 HTTP** | Bun HTTP Server | Truy vấn MAC trong `data/state.db` (SQLite) để trả về iPXE script tương ứng. | Lệnh iPXE `kernel` và `initrd` nạp Linux. |
| **Phase 4: Live OS Boot** | Linux Casper Environment | Mount hệ thống tệp gốc qua **NFS** hoặc nạp **ISO vào RAM**. | Khởi chạy tiến trình `subiquity` của Canonical. |
| **Phase 5: Subiquity Engine** | Cloud-Init & Curtin | Đọc cấu hình từ `/os/ubuntu/:mac/user-data`, phân vùng ổ đĩa, chạy late-commands. | Gửi Webhook Phone-Home `/api/installed` rồi `reboot`. |
| **Phase 6: Production Run** | Local Drive / K3s / RKE2 | iPXE nhận diện trạng thái đã cài -> thực thi `sanboot 0x80`. | Máy khởi động vào OS trên SSD và cụm Kubernetes sẵn sàng. |
| **Phase 7: Cluster Access** | Bun Kubeconfig API | Cung cấp endpoint `GET /api/kubeconfig/:identifier` SSH thời gian thực, tự đổi server IP. | Trả file YAML/JSON sẵn sàng cho `kubectl` kết nối từ xa. |

---

## 4. Mô Hình Cấu Hình Khai Báo (Declarative Infrastructure)

Hệ thống tuân thủ triệt để nguyên lý **Infrastructure as Code (IaC)**. Quản trị viên không cần gõ lệnh thủ công trên từng node, tất cả định nghĩa nằm trong [config/hosts.yaml](file:///Users/timi/lab/lab-ipxe-os/config/hosts.yaml):

1. **Khối cấu hình mặc định (`default`)**: Áp dụng cho mọi máy lạ chưa đăng ký địa chỉ MAC (Zero-Touch cắm là chạy).
2. **Khối cấu hình máy chủ (`hosts`)**: Ghi đè chi tiết theo từng địa chỉ MAC cụ thể:
   - Hostname, địa chỉ IP tĩnh / Netmask / Gateway / DNS.
   - Hệ điều hành mục tiêu (`ubuntu`, `talos`, `suse-micro`).
   - Profile chuyên biệt (`k3s-single-node`, `generic`).
   - Phương thức nạp rootfs (`boot_method: nfs` cho VM hoặc `boot_method: http` cho máy thật).
   - Thiết bị lưu trữ mục tiêu (`target_disk: /dev/sda` hoặc `/dev/nvme0n1`).

---

## 5. Danh Mục Tài Liệu Chuyên Sâu (Master Navigation Hub)

Để tìm hiểu sâu hơn về từng khía cạnh kỹ thuật cụ thể, vui lòng tham khảo các chuyên đề bên dưới:

- 🌐 [**Giao Thức Mạng & Thiết Lập Bộ Định Tuyến** (`network-protocols.md`)](network-protocols.md):
  * Phân tích chi tiết chu kỳ DHCP DORA và các DHCP Option 66, 67, 60, 93, 175.
  * Bản chất kỹ thuật của Two-Stage Chainloading.
  * Cấu hình mẫu sẵn sàng copy-paste cho OPNsense/pfSense, MikroTik, dnsmasq, và OpenWrt.
- ⚙️ [**Động Cơ Cài Đặt Hệ Điều Hành** (`os-engines.md`)](os-engines.md):
  * Phân tích Casper, Subiquity Autoinstall và Cloud-Init.
  * So sánh chi tiết kỹ thuật Rootfs: HTTP Range 206 Partial Content vs. NFS Stream Boot.
  * Mổ xẻ Profile `k3s-single-node` (Ubuntu) và `rke2-single-node` (openSUSE Leap Micro).
  * Giới thiệu Talos Linux MachineConfig và openSUSE Combustion.
  * Mô hình kiến trúc 2 tầng Registry: Provider Registry & Profile Registry Map.
  * Hướng dẫn từng bước tự thêm Profile và OS Provider mới.

- 🛡️ [**Cơ Chế Chống Boot Loop & Máy Trạng Thái** (`anti-boot-loop.md`)](anti-boot-loop.md):
  * Giải quyết nghịch lý vòng lặp cài đặt vô tận trong Zero-Touch Provisioning.
  * Kỹ thuật chuyển giao phần cứng `sanboot --drive 0x80 || exit 1`.
  * Kiến trúc State Machine `data/state.db` (SQLite WAL) và giao thức Phone-Home Webhook.
  * Các kịch bản phục hồi ngoại lệ và quy trình ép cài đặt lại (`force_install`).
- 🩺 [**Sổ Tay Chẩn Đoán & Xử Lý Sự Cố** (`troubleshooting.md`)](troubleshooting.md):
  * Sơ đồ phân tầng tìm lỗi từ L1/L2 Mạng đến Subiquity và Kubernetes.
  * Xử lý triệt để lỗi OOM Killer crash installer trên VM RAM 4GB–5GB.
  * Cách bật Emergency Shell và xem log thời gian thực trong quá trình cài đặt.
  * Bảng tra cứu nhanh triệu chứng và mã lệnh cứu hộ khẩn cấp.
