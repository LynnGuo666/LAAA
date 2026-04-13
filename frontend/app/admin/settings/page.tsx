'use client'

import { useEffect, useState } from 'react'
import { Button, Card, Input } from '@heroui/react'
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
        description="修改前端显示使用的站点名称。"
      />

      {error ? <AdminNotice tone="danger" description={error} /> : null}
      {success ? <AdminNotice tone="success" description={success} /> : null}

      <AdminSection className="max-w-2xl">
        <Card.Content className="p-6">
          <form onSubmit={handleSave} className="space-y-5">
            <AdminFormField label="网站昵称" isRequired isDisabled={saving}>
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
    </div>
  )
}
