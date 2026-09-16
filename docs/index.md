---
layout: home

hero:
  name: "lab-ipxe-os"
  text: "Multi-OS iPXE & Cloud-Init Hub"
  tagline: "Máy chủ tự động cài đặt hệ điều hành Bare-metal / Virtual Machine qua mạng mạnh mẽ, siêu nhẹ viết bằng Bun & TypeScript."
  actions:
    - theme: brand
      text: Bắt đầu khám phá
      link: /HOW_IT_WORKS
    - theme: alt
      text: Xem mã nguồn GitHub
      link: https://github.com/001123/lab-ipxe-os
    - theme: alt
      text: Tải bản Release
      link: https://github.com/001123/lab-ipxe-os/releases

features:
  - icon: 🚀
    title: Độc lập 1 File thực thi (Single Binary)
    details: Không cần cài đặt Node.js hay dependencies phức tạp. Đã tích hợp sẵn Web UI, SQLite database và HTTP range static asset server.
  - icon: 🔄
    title: Cơ chế Chống Boot Loop
    details: Hệ thống State Machine thông minh dựa trên MAC address. Khi cài đặt xong, máy tự động boot từ ổ đĩa cứng nội bộ thay vì lặp lại cài đặt.
  - icon: 🐧
    title: Đa Hệ Điều Hành (Multi-OS Engine)
    details: Hỗ trợ tự động Ubuntu (Subiquity/Cloud-Init), Talos Linux (Kubernetes không cần SSH), openSUSE Leap Micro (Combustion/Ignition).
  - icon: 📊
    title: Web UI & WebSocket Live Log
    details: Giao diện quản trị hiện đại, theo dõi trạng thái cài đặt, quản lý nodes qua SQLite và theo dõi log terminal trực tiếp qua WebSocket.
  - icon: 📦
    title: Smart Asset Mirroring
    details: Tự động tải, giải nén và lưu trữ ISO, vmlinuz, initrd cục bộ. Hỗ trợ HTTP Byte-Range requests cho quá trình boot mượt mà.
  - icon: ⚙️
    title: Tích hợp CI/CD & Kubernetes
    details: Sẵn sàng cấu hình tự động K3s/RKE2 single-node, ArgoCD GitOps, sinh file kubeconfig và tích hợp webhook phone-home.
---

## Bắt đầu nhanh (Quick Start)

### 1. Tải bản thực thi độc lập (Standalone Binary)

Tải phiên bản phù hợp với hệ thống của bạn từ [GitHub Releases](https://github.com/001123/lab-ipxe-os/releases):

```bash
# Ví dụ cho Linux x64
tar -xzf lab-ipxe-os-v1.0.0-linux-x64.tar.gz
cd lab-ipxe-os
./lab-ipxe-os
```

### 2. Cấu hình DHCP / iPXE Chain

Trỏ máy chủ DHCP hoặc iPXE client về endpoint:

```ini
chain http://<IP-SERVER>:3000/boot.ipxe?mac=${net0/mac}
```

### 3. Xem hướng dẫn chi tiết

- [Cách thức hoạt động & Vận hành toàn trình (HOW_IT_WORKS)](/HOW_IT_WORKS)
- [Cơ chế Chống Boot Loop](/anti-boot-loop)
- [Cấu hình hệ điều hành & Profiles](/os-engines)
- [Cấu hình DHCP & Network Routing](/network-protocols)
