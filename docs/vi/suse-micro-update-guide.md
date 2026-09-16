# Hướng dẫn Quản trị và Cập nhật openSUSE Leap Micro (Kubernetes RKE2)

Tài liệu này cung cấp hướng dẫn toàn diện về cơ chế vận hành, cập nhật hệ điều hành, quản lý phần mềm và khôi phục sự cố (rollback) cho các máy chủ chạy **openSUSE Leap Micro 6.2** làm nền tảng cho **RKE2 (Rancher Kubernetes Engine v2)**.

---

## 1. Bản chất của Immutable OS (Hệ điều hành Bất biến)

openSUSE Leap Micro được thiết kế theo triết lý **Immutable & Transactional OS**:
* **Phân vùng Root (`/`) Read-Only:** Hệ điều hành chính được bảo vệ ở chế độ chỉ đọc. Mọi thay đổi trực tiếp vào các thư mục hệ thống như `/usr`, `/lib`, `/bin` đều bị chặn nhằm chống xung đột hoặc lỗi do thao tác thủ công.
* **Btrfs Subvolumes ghi dữ liệu:** Các thư mục cần ghi dữ liệu người dùng và ứng dụng được tách thành các subvolume riêng biệt:
  * `/etc`: Chứa cấu hình hệ thống (OverlayFS hoặc writable snapshot).
  * `/var`: Lưu trữ dữ liệu container, RKE2 state, log (`/var/lib/rancher/rke2`, `/var/log`).
  * `/home`: Thư mục người dùng cá nhân (`/home/homelab`).
  * `/opt`: Thư mục cài đặt ứng dụng phụ hoặc lưu trữ local storage.
  * `/usr/local`: Thư mục chứa script/binary tùy biến của người quản trị.
* **Transactional Updates:** Mọi thao tác cập nhật OS hoặc cài thêm RPM package **không bao giờ sửa trực tiếp trên hệ thống đang chạy**. Thay vào đó, công cụ `transactional-update` tạo một snapshot Btrfs mới ngầm trong nền, áp dụng thay đổi vào snapshot đó, và chuyển snapshot mới thành default cho lần reboot kế tiếp. Nếu quá trình cập nhật gặp lỗi, snapshot mới bị hủy và hệ thống đang chạy hoàn toàn không bị ảnh hưởng.

---

## 2. Quy trình Cập nhật Hệ điều hành (OS Update)

### 2.1. Kiểm tra và tải bản cập nhật mới
Để quét và cài đặt các bản vá bảo mật cũng như cập nhật kernel/packages:

```bash
sudo transactional-update up
```

Lệnh này sẽ:
1. Tạo một Btrfs snapshot mới (ví dụ snapshot `#3`).
2. Tải và cài đặt các package cập nhật từ repository chính thức của openSUSE vào snapshot `#3`.
3. Nếu thành công, đánh dấu snapshot `#3` làm snapshot mặc định để khởi động.

### 2.2. Kiểm tra danh sách Snapshot sau khi cập nhật
```bash
sudo snapper list
```
* Snapshot có dấu `*` là snapshot đang được mount chạy hiện tại.
* Snapshot có dấu `+` là snapshot mới sẽ được kích hoạt ở lần boot tới.

```text
 # │ Type   │ Pre # │ Date                     │ User │ Used Space │ Cleanup │ Description           │ Userdata
───┼────────┼───────┼──────────────────────────┼──────┼────────────┼─────────┼───────────────────────┼─────────
0  │ single │       │                          │ root │            │         │ current               │
1  │ single │       │ Mon Jul 20 10:06:07 2026 │ root │ 354.91 MiB │         │ first root filesystem │
2* │ single │       │ Tue Sep 15 09:20:38 2026 │ root │ 389.69 MiB │ number  │ Snapshot Update of #1 │
3+ │ single │       │ Wed Sep 16 10:00:00 2026 │ root │ 120.00 MiB │ number  │ snapshot after update │
```

### 2.3. Khởi động lại (Reboot) để kích hoạt OS mới

> [!IMPORTANT]
> Vì đây là node chạy Kubernetes (RKE2), trước khi reboot bạn nên kiểm tra tình trạng dịch vụ. Nếu chạy cụm nhiều node, hãy cordon/drain node trước:
> ```bash
> kubectl drain <node-name> --ignore-daemonsets --delete-emptydir-data
> ```
> Trên cụm Single-Node, bạn chỉ cần đảm bảo các tiến trình quan trọng đã hoàn tất.

Thực hiện reboot máy chủ:
```bash
sudo reboot
```

Sau khi máy khởi động lại, kiểm tra kernel và version mới:
```bash
uname -r
sudo snapper list   # Dấu * sẽ chuyển sang snapshot mới
kubectl get nodes
```

---

## 3. Cài đặt và Quản lý Gói phần mềm (Packages)

> [!WARNING]
> Tuyệt đối **không chạy `zypper in <package>`** trực tiếp trên Leap Micro vì sẽ bị báo lỗi `Read-only file system`.

### 3.1. Cài đặt gói mới
```bash
sudo transactional-update pkg in <tên-gói>
```
*Ví dụ:* Cài thêm `htop` và `tcpdump`:
```bash
sudo transactional-update pkg in htop tcpdump
```
Sau khi cài đặt xong, hệ thống thông báo cần reboot để nạp snapshot mới:
```bash
sudo reboot
```

### 3.2. Gỡ bỏ gói phần mềm
```bash
sudo transactional-update pkg rm <tên-gói>
sudo reboot
```

### 3.3. Dùng Interactive Shell để debug hoặc thao tác phức tạp
Nếu bạn cần thực hiện nhiều lệnh shell trong môi trường writable snapshot:
```bash
sudo transactional-update shell
```
* Hệ thống sẽ mở một sub-shell chroot vào snapshot mới. Tại đây bạn có thể dùng `zypper`, chỉnh sửa file hệ thống.
* Gõ `exit 0` để lưu thay đổi thành snapshot mới (cần reboot để áp dụng).
* Gõ `exit 1` để hủy bỏ toàn bộ thay đổi vừa làm.

---

## 4. Quản lý Tự động Khởi động lại (Reboot Manager)

Leap Micro sử dụng service `rebootmgr` để kiểm soát hành vi khởi động lại sau khi có bản vá từ `transactional-update.timer`.

### 4.1. Kiểm tra trạng thái hiện tại
```bash
rebootmgrctl status
rebootmgrctl get-strategy
```

### 4.2. Các chiến lược (Strategy)
1. **`off` (Khuyên dùng cho Kubernetes):** Hệ thống tải bản vá ngầm vào snapshot nhưng **không bao giờ tự ý reboot**. Quản trị viên hoàn toàn chủ động chọn thời điểm reboot.
   ```bash
   sudo rebootmgrctl set-strategy off
   ```
2. **`maint-window` (Bảo trì theo khung giờ cố định):** Chỉ reboot trong khung giờ cho phép (ví dụ rạng sáng cuối tuần):
   ```bash
   sudo rebootmgrctl set-strategy maint-window
   sudo rebootmgrctl set-window "Sun *-*-* 03:00:00" 02:00
   ```
3. **`best-effort`:** Tự động reboot trong khung giờ mặc định (03:30 - 05:00) nếu không có lock.

Cấu hình này được lưu tĩnh trong file `/etc/rebootmgr.conf`:
```ini
[rebootmgr]
strategy=off
```

---

## 5. Cơ chế Khôi phục Khẩn cấp (Rollback)

Nếu sau khi cập nhật hệ thống bị lỗi, kernel mới không tương thích hoặc dịch vụ không khởi động được, bạn có thể rollback cực kỳ nhanh chóng.

### Cách 1: Rollback qua dòng lệnh CLI (Nếu vẫn SSH được)
1. Liệt kê các snapshot cũ:
   ```bash
   sudo snapper list
   ```
2. Rollback về snapshot ổn định mong muốn (ví dụ snapshot `#2`):
   ```bash
   sudo transactional-update rollback 2
   ```
3. Khởi động lại máy:
   ```bash
   sudo reboot
   ```
   Hệ thống sẽ lập tức quay lại trạng thái hoàn hảo của snapshot `#2`.

### Cách 2: Rollback qua màn hình GRUB Bootloader (Nếu máy không boot được vào OS)
Khi máy khởi động, tại menu GRUB:
1. Chọn menu dòng **`Start bootloader from a read-only snapshot`**.
2. Chọn snapshot ổn định trước khi cập nhật (theo ngày/giờ hiển thị).
3. Đăng nhập vào hệ thống và xác nhận snapshot này làm mặc định vĩnh viễn:
   ```bash
   sudo transactional-update rollback
   sudo reboot
   ```

---

## 6. Hướng dẫn áp dụng các tối ưu cho các Node đã cài trước đó

Nếu bạn có server openSUSE Leap Micro đang chạy từ trước và muốn cập nhật các tinh chỉnh mới (Tắt auto-reboot, sysctl K8s, crictl.yaml, PATH) mà không cần cài lại OS, hãy chạy các lệnh sau qua SSH:

```bash
# 1. Tắt tự động reboot ban đêm
sudo sh -c 'cat <<EOF > /etc/rebootmgr.conf
[rebootmgr]
strategy=off
EOF'
sudo rebootmgrctl set-strategy off || true

# 2. Tối ưu Kernel Sysctl cho Kubernetes & workload nặng
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

# 3. Cấu hình crictl trỏ tới socket của RKE2
sudo sh -c 'cat <<EOF > /etc/crictl.yaml
runtime-endpoint: unix:///run/k3s/containerd/containerd.sock
image-endpoint: unix:///run/k3s/containerd/containerd.sock
timeout: 10
debug: false
EOF'

# 4. Bổ sung /sbin và /usr/sbin vào PATH cho tài khoản homelab
sudo sed -i 's|export PATH=\$PATH:/var/lib/rancher/rke2/bin:/usr/local/bin|export PATH=\$PATH:/var/lib/rancher/rke2/bin:/usr/local/bin:/sbin:/usr/sbin|g' /etc/profile.d/rke2.sh
```
