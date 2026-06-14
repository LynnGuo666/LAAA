'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, Card } from '@heroui/react'
import {
  AppWindow,
  Users,
  TicketCheck,
  Settings2,
  ArrowRight,
} from 'lucide-react'
import {
  AdminEmptyState,
  AdminLoadingState,
  AdminPageHeader,
  AdminSection,
  AdminNotice,
} from '@/components/admin/admin-ui'
import { adminApi, clientApi } from '@/lib/api'
import { isAdmin } from '@/lib/authz'
import { useAuthStore } from '@/lib/store'

type DashboardStats = {
  apps: number
  users: number
}

const quickActions = [
  {
    href: '/admin/apps',
    title: '应用管理',
    description: '创建、编辑 OAuth 应用，并配置访问控制。',
    icon: AppWindow,
    color: 'text-primary',
    bg: 'bg-primary/10',
  },
  {
    href: '/admin/users',
    title: '用户管理',
    description: '查看用户详情、角色、用户组和应用权限。',
    icon: Users,
    color: 'text-success',
    bg: 'bg-success/10',
  },
  {
    href: '/admin/invites',
    title: '邀请码',
    description: '生成邀请码并查看使用情况。',
    icon: TicketCheck,
    color: 'text-warning',
    bg: 'bg-warning/10',
  },
  {
    href: '/admin/settings',
    title: '站点设置',
    description: '修改站点名称等管理后台基础配置。',
    icon: Settings2,
    color: 'text-secondary',
    bg: 'bg-secondary/10',
  },
]

export default function AdminDashboardPage() {
  const router = useRouter()
  const user = useAuthStore((state) => state.user)
  const [stats, setStats] = useState<DashboardStats>({ apps: 0, users: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    if (!isAdmin(user)) {
      router.replace('/dashboard')
      return
    }

    const loadStats = async () => {
      try {
        setLoading(true)
        setError(null)
        const [appsResponse, usersResponse] = await Promise.all([
          clientApi.list(),
          adminApi.listUsers({ limit: 1 }),
        ])

        setStats({
          apps: appsResponse.data.length,
          users: usersResponse.data.total || 0,
        })
      } catch (err: any) {
        setError(err.response?.data?.detail || '加载管理统计失败')
      } finally {
        setLoading(false)
      }
    }

    void loadStats()
  }, [router, user])

  if (!user || !isAdmin(user)) {
    return null
  }

  if (loading) {
    return <AdminLoadingState label="正在加载管理控制台..." />
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="管理控制台"
        description="这里汇总了管理后台的关键入口和整体数据。"
        actions={
          <Button variant="secondary" onPress={() => window.open('/api/docs', '_blank', 'noopener,noreferrer')}>
            打开 API 文档
          </Button>
        }
      />

      {error ? <AdminNotice tone="danger" description={error} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/apps" className="group">
          <div className="rounded-xl border border-default-200/70 bg-background p-5 shadow-sm transition-shadow group-hover:shadow-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <AppWindow className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-default-600">应用总数</p>
                  <p className="text-3xl font-bold text-foreground">{stats.apps}</p>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-default-300 transition-colors group-hover:text-primary" />
            </div>
          </div>
        </Link>

        <Link href="/admin/users" className="group">
          <div className="rounded-xl border border-default-200/70 bg-background p-5 shadow-sm transition-shadow group-hover:shadow-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                  <Users className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-sm font-medium text-default-600">用户总数</p>
                  <p className="text-3xl font-bold text-foreground">{stats.users}</p>
                </div>
              </div>
              <ArrowRight className="h-5 w-5 text-default-300 transition-colors group-hover:text-primary" />
            </div>
          </div>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {quickActions.map((action) => {
          const Icon = action.icon
          return (
            <Link key={action.href} href={action.href} className="group">
              <div className="flex items-start gap-4 rounded-xl border border-default-200/70 bg-background p-5 shadow-sm transition-shadow group-hover:shadow-md">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${action.bg}`}>
                  <Icon className={`h-5 w-5 ${action.color}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{action.title}</p>
                  <p className="mt-1 text-sm text-default-500">{action.description}</p>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-default-300 transition-colors group-hover:text-primary" />
              </div>
            </Link>
          )
        })}
      </div>

      {quickActions.length === 0 ? (
        <AdminEmptyState title="暂无可用管理入口" description="请稍后再试。" />
      ) : null}
    </div>
  )
}