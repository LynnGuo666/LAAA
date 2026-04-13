'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Disclosure, buttonVariants, cn } from '@heroui/react'
import { AdminLoadingState, AdminSection } from '@/components/admin/admin-ui'
import { ThemeToggle } from '@/components/ThemeToggle'
import { isAdmin } from '@/lib/authz'
import { authApi, siteApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

type NavItem = {
  href: string
  label: string
}

type NavGroup = {
  label: string
  items: NavItem[]
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
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <AdminLoadingState />
      </div>
    )
  }

  if (!isAdmin(user)) {
    return null
  }

  const adminNavGroups: NavGroup[] = [
    { label: '总览', items: [{ href: '/admin', label: '控制台' }] },
    { label: '应用', items: [{ href: '/admin/apps', label: '应用管理' }] },
    {
      label: '用户与权限',
      items: [
        { href: '/admin/users', label: '用户管理' },
        { href: '/admin/groups', label: '用户组' },
        { href: '/admin/invites', label: '邀请码' },
      ],
    },
    { label: '系统', items: [{ href: '/admin/settings', label: '站点设置' }] },
  ]

  const isActiveHref = (href: string) => {
    if (href === '/admin') return pathname === '/admin'
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  const AdminNavContent = () => (
    <div className="space-y-5">
      {adminNavGroups.map((group) => (
        <div key={group.label} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-default-500">
            {group.label}
          </p>
          <div className="flex flex-col gap-2">
            {group.items.map((item) => {
              const active = isActiveHref(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    buttonVariants({
                      variant: active ? 'primary' : 'secondary',
                      size: 'sm',
                    }),
                    'justify-start',
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <header className="border-b border-default-200/70 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <Link href="/admin" className="text-lg font-semibold text-foreground sm:text-xl">
              {siteName}
              <span className="ml-2 text-xs font-medium uppercase tracking-[0.2em] text-default-500">
                Admin
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Link
              href="/dashboard/my-apps"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              返回用户面板
            </Link>
            <span className="hidden text-sm text-default-600 sm:inline">{user.username}</span>
            <Button variant="secondary" size="sm" onPress={handleLogout}>
              退出登录
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="lg:hidden">
            <AdminSection className="p-4">
              <Disclosure>
                <Disclosure.Heading>
                  <Disclosure.Trigger className="flex w-full items-center justify-between rounded-2xl px-1 py-1 text-left text-sm font-medium text-foreground">
                    管理菜单
                    <Disclosure.Indicator />
                  </Disclosure.Trigger>
                </Disclosure.Heading>
                <Disclosure.Content className="pt-4">
                  <AdminNavContent />
                </Disclosure.Content>
              </Disclosure>
            </AdminSection>
          </div>

          <aside className="hidden w-72 shrink-0 lg:block">
            <AdminSection className="p-4">
              <AdminNavContent />
            </AdminSection>
          </aside>

          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>
    </div>
  )
}
