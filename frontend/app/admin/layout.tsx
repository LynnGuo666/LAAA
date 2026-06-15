'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Tabs } from '@heroui/react'
import { LogOut, ArrowLeft, ShieldCheck } from 'lucide-react'
import { PageLoadingState } from '@/components/ui/loading'
import { ThemeToggle } from '@/components/ThemeToggle'
import { isAdmin } from '@/lib/authz'
import { authApi, siteApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

type NavItem = {
  href: string
  label: string
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, setUser, logout } = useAuthStore()
  const [siteName, setSiteName] = useState('OAuth 服务器')

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }

    if (!user) {
      authApi
        .getMe()
        .then((response) => {
          setUser(response.data)
        })
        .catch(() => {
          router.push('/login')
        })
    }
  }, [router, setUser, user])

  useEffect(() => {
    siteApi
      .get()
      .then((response) => {
        setSiteName(response.data?.site_name || 'OAuth 服务器')
      })
      .catch(() => {
        // ignore
      })
  }, [])

  useEffect(() => {
    if (user && !isAdmin(user)) {
      router.replace('/dashboard')
    }
  }, [router, user])

  const handleLogout = async () => {
    const refreshToken = localStorage.getItem('refresh_token')
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken)
      } catch {
        // ignore
      }
    }
    logout()
    router.push('/login')
  }

  if (!user) {
    return <PageLoadingState />
  }

  if (!isAdmin(user)) {
    return null
  }

  const navLinks: NavItem[] = [
    { href: '/admin', label: '控制台' },
    { href: '/admin/apps', label: '应用管理' },
    { href: '/admin/users', label: '用户管理' },
    { href: '/admin/groups', label: '用户组' },
    { href: '/admin/invites', label: '邀请码' },
    { href: '/admin/settings', label: '站点设置' },
  ]

  const activeKey = navLinks.find((link) => {
    if (link.href === '/admin') return pathname === '/admin'
    return pathname === link.href || pathname.startsWith(`${link.href}/`)
  })?.href || navLinks[0].href

  return (
    <div className="min-h-screen bg-background">
      <nav className="bg-background shadow-sm border-b border-default-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center min-w-0">
              <Link href="/admin" className="flex items-center gap-2 px-2 py-2 text-xl font-bold whitespace-nowrap">
                <ShieldCheck className="h-5 w-5 text-primary" />
                {siteName}
                <span className="hidden rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary sm:inline">
                  Admin
                </span>
              </Link>

              <div className="hidden sm:ml-6 sm:flex sm:items-center">
                <Tabs
                  className="w-full"
                  selectedKey={activeKey}
                  variant="primary"
                  onSelectionChange={(key) => {
                    router.push(String(key));
                  }}
                >
                  <Tabs.ListContainer>
                    <Tabs.List aria-label="Admin Navigation" className="flex-nowrap">
                      {navLinks.map((link) => (
                        <Tabs.Tab key={link.href} id={link.href} className="whitespace-nowrap">
                          {link.label}
                          <Tabs.Indicator />
                        </Tabs.Tab>
                      ))}
                    </Tabs.List>
                  </Tabs.ListContainer>
                </Tabs>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <ThemeToggle />
              <Link
                href="/dashboard/my-apps"
                className="hidden items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm text-default-600 transition-colors hover:bg-default-100 sm:inline-flex"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                用户面板
              </Link>
              <div className="hidden h-4 w-px bg-default-200 sm:block" />
              <span className="hidden text-sm text-default-600 sm:inline">{user.username}</span>
              <Button variant="secondary" size="sm" onPress={handleLogout}>
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">退出</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="sm:hidden border-t border-default-200">
          <div className="flex overflow-x-auto px-4 py-2 gap-4">
            {navLinks.map((link) => {
              const isActive = link.href === '/admin'
                ? pathname === '/admin'
                : pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm whitespace-nowrap px-2 py-1 rounded ${
                    isActive
                      ? 'text-primary bg-primary/10'
                      : 'text-default-600'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}