'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button, Description, Disclosure, Header, Label, ListBox, Separator, cn } from '@heroui/react'
import {
  LayoutDashboard,
  AppWindow,
  Users,
  Group,
  TicketCheck,
  Settings2,
  LogOut,
  ArrowLeft,
  ShieldCheck,
} from 'lucide-react'
import { AdminLoadingState } from '@/components/admin/admin-ui'
import { ThemeToggle } from '@/components/ThemeToggle'
import { isAdmin } from '@/lib/authz'
import { authApi, siteApi } from '@/lib/api'
import { useAuthStore } from '@/lib/store'

type NavItem = {
  href: string
  label: string
  icon: React.ElementType
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
    {
      label: '总览',
      items: [
        { href: '/admin', label: '控制台', icon: LayoutDashboard },
      ],
    },
    {
      label: '应用',
      items: [
        { href: '/admin/apps', label: '应用管理', icon: AppWindow },
      ],
    },
    {
      label: '用户与权限',
      items: [
        { href: '/admin/users', label: '用户管理', icon: Users },
        { href: '/admin/groups', label: '用户组', icon: Group },
        { href: '/admin/invites', label: '邀请码', icon: TicketCheck },
      ],
    },
    {
      label: '系统',
      items: [
        { href: '/admin/settings', label: '站点设置', icon: Settings2 },
      ],
    },
  ]

  const isActiveHref = (href: string) => {
    if (href === '/admin') return pathname === '/admin'
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  const activeKey = (() => {
    for (const group of adminNavGroups) {
      for (const item of group.items) {
        if (isActiveHref(item.href)) return item.href
      }
    }
    return ''
  })()

  const AdminNavContent = () => (
    <ListBox
      aria-label="管理导航"
      selectionMode="single"
      selectedKeys={new Set([activeKey])}
      onSelectionChange={(keys) => {
        const selected = keys instanceof Set ? keys.values().next().value : Array.from(keys)[0]
        if (selected) router.push(String(selected))
      }}
      className="w-full"
    >
      {adminNavGroups.map((group, groupIndex) => (
        <ListBox.Section key={group.label}>
          <Header>{group.label}</Header>
          {group.items.map((item) => {
            const Icon = item.icon
            return (
              <ListBox.Item key={item.href} id={item.href} textValue={item.label}>
                <Icon className="size-4 shrink-0 text-inherit" />
                <Label>{item.label}</Label>
              </ListBox.Item>
            )
          })}
          {groupIndex < adminNavGroups.length - 1 ? <Separator /> : null}
        </ListBox.Section>
      ))}
    </ListBox>
  )

  return (
    <div className="min-h-screen bg-default-50">
      <header className="sticky top-0 z-30 border-b border-default-200/70 bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="min-w-0">
            <Link href="/admin" className="flex items-center gap-2 text-base font-semibold text-foreground">
              <ShieldCheck className="h-5 w-5 text-primary" />
              {siteName}
              <span className="hidden rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary sm:inline">
                Admin
              </span>
            </Link>
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
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="lg:hidden">
            <Disclosure>
              <Disclosure.Heading>
                <Disclosure.Trigger className="flex w-full items-center justify-between rounded-xl border border-default-200/70 bg-background px-4 py-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-default-50">
                  管理菜单
                  <Disclosure.Indicator />
                </Disclosure.Trigger>
              </Disclosure.Heading>
              <Disclosure.Content className="pt-4">
                <AdminNavContent />
              </Disclosure.Content>
            </Disclosure>
          </div>

          <aside className="hidden w-60 shrink-0 lg:block lg:sticky lg:top-20">
            <AdminNavContent />
          </aside>

          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>
    </div>
  )
}