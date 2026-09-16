import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
    title: 'lab-ipxe-os',
    description: 'Multi-OS iPXE & Cloud-Init Autoinstall Server powered by Bun and TypeScript',
    base: '/lab-ipxe-os/',
    cleanUrls: true,
    lastUpdated: true,

    head: [
      ['link', { rel: 'icon', type: 'image/svg+xml', href: '/lab-ipxe-os/favicon.svg' }],
      ['link', { rel: 'alternate icon', href: '/lab-ipxe-os/favicon.ico' }],
    ],

    locales: {
      en: {
        label: 'English',
        lang: 'en-US',
        link: '/en/',
        themeConfig: {
          nav: [
            { text: 'Home', link: '/en/' },
            { text: 'Architecture & Workflow', link: '/en/HOW_IT_WORKS' },
            { text: 'OS Engines', link: '/en/os-engines' },
            { text: 'Troubleshooting', link: '/en/troubleshooting' },
            {
              text: 'Releases',
              link: 'https://github.com/001123/lab-ipxe-os/releases'
            }
          ],

          sidebar: [
            {
              text: 'Overview & Architecture',
              items: [
                { text: 'How It Works', link: '/en/HOW_IT_WORKS' },
                { text: 'Anti-Boot Loop & State Machine', link: '/en/anti-boot-loop' },
                { text: 'Network Protocols & Router Setup', link: '/en/network-protocols' }
              ]
            },
            {
              text: 'Operating Systems & Provisioning',
              items: [
                { text: 'OS Engines & Subiquity', link: '/en/os-engines' },
                { text: 'Kernel Sync & Netboot Guide', link: '/en/kernel-sync-and-netboot-guide' },
                { text: 'openSUSE Leap Micro & Combustion', link: '/en/suse-micro-update-guide' }
              ]
            },
            {
              text: 'Operations & Support',
              items: [
                { text: 'Troubleshooting & Diagnostics', link: '/en/troubleshooting' }
              ]
            }
          ],

          docFooter: {
            prev: 'Previous page',
            next: 'Next page'
          },

          lastUpdatedText: 'Last updated'
        }
      },

      vi: {
        label: 'Tiếng Việt',
        lang: 'vi-VN',
        link: '/vi/',
        themeConfig: {
          nav: [
            { text: 'Trang chủ', link: '/vi/' },
            { text: 'Kiến trúc & Vận hành', link: '/vi/HOW_IT_WORKS' },
            { text: 'Hệ điều hành', link: '/vi/os-engines' },
            { text: 'Xử lý sự cố', link: '/vi/troubleshooting' },
            {
              text: 'Releases',
              link: 'https://github.com/001123/lab-ipxe-os/releases'
            }
          ],

          sidebar: [
            {
              text: 'Tổng quan & Kiến trúc',
              items: [
                { text: 'Cách thức hoạt động (How it works)', link: '/vi/HOW_IT_WORKS' },
                { text: 'Cơ chế chống Boot Loop (State Machine)', link: '/vi/anti-boot-loop' },
                { text: 'Giao thức mạng & Cấu hình Router', link: '/vi/network-protocols' }
              ]
            },
            {
              text: 'Hệ điều hành & Provisioning',
              items: [
                { text: 'Động cơ cài đặt OS & Subiquity', link: '/vi/os-engines' },
                { text: 'Đồng bộ Kernel & Netboot Assets', link: '/vi/kernel-sync-and-netboot-guide' },
                { text: 'openSUSE Leap Micro & Combustion', link: '/vi/suse-micro-update-guide' }
              ]
            },
            {
              text: 'Vận hành & Hỗ trợ',
              items: [
                { text: 'Sổ tay chẩn đoán & Xử lý sự cố', link: '/vi/troubleshooting' }
              ]
            }
          ],

          docFooter: {
            prev: 'Trang trước',
            next: 'Trang tiếp theo'
          },

          lastUpdatedText: 'Cập nhật lần cuối'
        }
      }
    },

    themeConfig: {
      siteTitle: 'lab-ipxe-os',
      logo: '/favicon.svg',

      search: {
        provider: 'local',
        options: {
          locales: {
            en: {
              translations: {
                button: {
                  buttonText: 'Search documentation',
                  buttonAriaLabel: 'Search documentation'
                },
                modal: {
                  noResultsText: 'No results found',
                  resetButtonTitle: 'Clear search',
                  footer: {
                    selectText: 'select',
                    navigateText: 'navigate',
                    closeText: 'close'
                  }
                }
              }
            },
            vi: {
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
      }
    }
  })
)
