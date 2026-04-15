'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Input } from '@heroui/react'
import { Globe } from 'lucide-react'
import {
  AdminFormField,
  AdminLoadingState,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
} from '@/components/admin/admin-ui'
import { siteApi } from '@/lib/api'
import { isAdmin } from '@/lib/authz'
import { useAuthStore } from '@/lib/store'

export default function SiteSettingsPage() {
  const user = useAuthStore((state) => state.user)
  const canManage = isAdmin(user)

  const [siteName, setSiteName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (!canManage) return

    setLoading(true)
    siteApi
      .get()
      .then((response) => {
        setSiteName(response.data?.site_name || '')
      })
      .catch((err) => {
        setError(err.response?.data?.detail || '加载站点配置失败')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [canManage])

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const trimmedName = siteName.trim()
    if (!trimmedName) {
      setError('站点名称不能为空')
      return
    }

    setSaving(true)
    try {
      const response = await siteApi.update(trimmedName)
      setSiteName(response.data?.site_name || trimmedName)
      setSuccess('站点设置已保存')
      window.setTimeout(() => setSuccess(null), 1500)
    } catch (err: any) {
      setError(err.response?.data?.detail || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return (
      <AdminNotice tone="danger" title="无权限" description="该页面仅管理员可访问。" />
    )
  }

  if (loading) {
    return <AdminLoadingState label="正在读取站点设置..." />
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="站点设置"
        description="修改前端显示使用的站点名称和基础配置。"
      />

      {error ? <AdminNotice tone="danger" description={error} /> : null}
      {success ? <AdminNotice tone="success" description={success} /> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <AdminSection>
          <Card.Header>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <Globe className="h-5 w-5 text-primary" />
              </div>
              <div>
                <Card.Title>站点信息</Card.Title>
                <Card.Description>这些设置面向所有用户可见。</Card.Description>
              </div>
            </div>
          </Card.Header>
          <Card.Content className="p-6 pt-0">
            <form onSubmit={handleSave} className="space-y-5">
              <AdminFormField label="网站昵称" isRequired isDisabled={saving} description="显示在页面标题和导航栏中">
                <Input
                  value={siteName}
                  onChange={(event) => setSiteName(event.target.value)}
                  placeholder="例如：LAAA OAuth"
                />
              </AdminFormField>

              <div className="flex justify-end">
                <Button type="submit" variant="primary" isPending={saving} isDisabled={saving}>
                  保存
                </Button>
              </div>
            </form>
          </Card.Content>
        </AdminSection>

        <div className="space-y-4">
          <AdminSection>
            <Card.Content className="p-5">
              <h3 className="text-sm font-medium text-foreground">预览效果</h3>
              <div className="mt-3 rounded-xl border border-default-200/70 bg-default-50 p-4">
                <p className="text-lg font-semibold text-foreground">
                  {siteName || 'OAuth 服务器'}
                </p>
                <p className="mt-1 text-xs text-default-500">
                  该名称将显示在导航栏和页面标题中
                </p>
              </div>
            </Card.Content>
          </AdminSection>
        </div>
      </div>
    </div>
  )
}