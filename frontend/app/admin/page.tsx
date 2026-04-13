'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, Card } from '@heroui/react'
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
    title: '管理应用',
    description: '创建、编辑 OAuth 应用，并配置访问控制。',
  },
  {
    href: '/admin/users',
    title: '用户管理',
    description: '查看用户详情、角色、用户组和应用权限。',
  },
  {
    href: '/admin/invites',
    title: '邀请码',
    description: '生成邀请码并查看使用情况。',
  },
  {
    href: '/admin/settings',
    title: '站点设置',
    description: '修改站点名称等管理后台基础配置。',
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

      <div className="grid gap-4 md:grid-cols-2">
        <AdminSection>
          <Card.Header className="pb-2">
            <div>
              <Card.Title>应用总数</Card.Title>
              <Card.Description>当前已注册的 OAuth 应用</Card.Description>
            </div>
          </Card.Header>
          <Card.Content className="flex items-end justify-between gap-4 pt-0">
            <p className="text-4xl font-semibold text-foreground">{stats.apps}</p>
            <Link href="/admin/apps">
              <Button variant="secondary" size="sm">
                查看应用
              </Button>
            </Link>
          </Card.Content>
        </AdminSection>

        <AdminSection>
          <Card.Header className="pb-2">
            <div>
              <Card.Title>用户总数</Card.Title>
              <Card.Description>当前系统中的用户数量</Card.Description>
            </div>
          </Card.Header>
          <Card.Content className="flex items-end justify-between gap-4 pt-0">
            <p className="text-4xl font-semibold text-foreground">{stats.users}</p>
            <Link href="/admin/users">
              <Button variant="secondary" size="sm">
                查看用户
              </Button>
            </Link>
          </Card.Content>
        </AdminSection>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {quickActions.map((action) => (
          <AdminSection key={action.href}>
            <Card.Header>
              <div className="space-y-1">
                <Card.Title>{action.title}</Card.Title>
                <Card.Description>{action.description}</Card.Description>
              </div>
            </Card.Header>
            <Card.Footer>
              <Link href={action.href}>
                <Button variant="primary" size="sm">
                  进入
                </Button>
              </Link>
            </Card.Footer>
          </AdminSection>
        ))}
      </div>

      {quickActions.length === 0 ? (
        <AdminEmptyState title="暂无可用管理入口" description="请稍后再试。" />
      ) : null}
    </div>
  )
}
