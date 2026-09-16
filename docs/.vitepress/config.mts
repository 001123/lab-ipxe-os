import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'lab-ipxe-os',
  description: 'Multi-OS iPXE & Cloud-Init Autoinstall Server powered by Bun and TypeScript',
  base: '/lab-ipxe-os/',
  cleanUrls: true,
  lastUpdated: true,

  themeConfig: {
    siteTitle: 'lab-ipxe-os',

    nav: [
      { text: 'Trang chủ', link: '/' },
      { text: 'Kiến trúc & Vận hành', link: '/HOW_IT_WORKS' },
      { text: 'Hệ điều hành', link: '/os-engines' },
      { text: 'Xử lý sự cố', link: '/troubleshooting' },
      {
        text: 'Releases',
        link: 'https://github.com/001123/lab-ipxe-os/releases'
      }
    ],

    sidebar: [
      {
        text: 'Tổng quan & Kiến trúc',
        items: [
          { text: 'Cách thức hoạt động (How it works)', link: '/HOW_IT_WORKS' },
          { text: 'Cơ chế chống Boot Loop (State Machine)', link: '/anti-boot-loop' },
          { text: 'Giao thức mạng & Cấu hình Router', link: '/network-protocols' }
        ]
      },
      {
        text: 'Hệ điều hành & Provisioning',
        items: [
          { text: 'Động cơ cài đặt OS & Subiquity', link: '/os-engines' },
          { text: 'Đồng bộ Kernel & Netboot Assets', link: '/kernel-sync-and-netboot-guide' },
          { text: 'openSUSE Leap Micro & Combustion', link: '/suse-micro-update-guide' }
        ]
      },
      {
        text: 'Vận hành & Hỗ trợ',
        items: [
          { text: 'Sổ tay chẩn đoán & Xử lý sự cố', link: '/troubleshooting' }
        ]
      }
    ],

    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: 'Tìm kiếm tài liệu',
                buttonAriaLabel: 'Tìm kiếm tài liệu'
              },
              modal: {
                noResultsText: 'Không tìm thấy kết quả',
                resetButtonTitle: 'Xóa tìm kiếm',
                footer: {
                  selectText: 'chọn',
                  navigateText: 'chuyển dòng',
                  closeText: 'đóng'
                }
              }
            }
          }
        }
      }
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/001123/lab-ipxe-os' }
    ],

    footer: {
      message: 'Multi-OS iPXE & Cloud-Init Autoinstall Hub',
      copyright: 'Copyright © 2026 lab-ipxe-os. Open source under MIT License.'
    },

    docFooter: {
      prev: 'Trang trước',
      next: 'Trang tiếp theo'
    }
  }
})
