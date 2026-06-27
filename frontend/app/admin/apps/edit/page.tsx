'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button, toast } from '@heroui/react'
import {
  AdminLoadingState,
  AdminNotice,
  AdminPageHeader,
} from '@/components/admin/admin-ui'
import {
  AppFormFields,
  EMPTY_APP_FORM,
  type AppFormData,
  validateAppForm,
} from '@/components/admin/app-form-fields'
import { clientApi } from '@/lib/api'
import { isAdmin } from '@/lib/authz'
import { useAuthStore } from '@/lib/store'

interface Client {
  id: number
  client_id: string
  name: string
  description?: string
  logo?: string
  website_url?: string
  redirect_uris: string[]
  allowed_scopes: string[]
  trusted: boolean
  default_access: boolean
  created_at: string
}

export default function AppEditPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const clientId = Number(searchParams.get('id'))
  const currentUser = useAuthStore((state) => state.user)
  const canManage = isAdmin(currentUser)

  const [client, setClient] = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const [formData, setFormData] = useState<AppFormData>({ ...EMPTY_APP_FORM })

  const loadClient = useCallback(async () => {
    if (!clientId) return
    try {
      setLoading(true)
      setError(null)
      const response = await clientApi.get(clientId)
      const data = response.data
      setClient(data)
      setFormData({
        name: data.name,
        description: data.description || '',
        logo: data.logo || '',
        website_url: data.website_url || '',
        redirect_uris: data.redirect_uris.join('\n'),
        allowed_scopes: data.allowed_scopes,
        trusted: data.trusted,
        default_access: data.default_access,
      })
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载应用失败')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    if (!canManage || !clientId) return
    void loadClient()
  }, [canManage, clientId, loadClient])

  const validateForm = () => validateAppForm(formData)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!client) return

    const validationError = validateForm()
    if (validationError) {
      setFormError(validationError)
      return
    }

    try {
      setSaving(true)
      setFormError(null)
      await clientApi.update(client.id, {
        name: formData.name.trim(),
        description: formData.description || undefined,
        logo: formData.logo || undefined,
        website_url: formData.website_url || undefined,
        redirect_uris: formData.redirect_uris.split('\n').filter((s) => s.trim()),
        allowed_scopes: formData.allowed_scopes,
        trusted: formData.trusted,
        default_access: formData.default_access,
      })
      toast('应用已更新')
      router.push('/admin/apps')
    } catch (err: any) {
      setFormError(err.response?.data?.detail || '更新应用失败')
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return <AdminNotice tone="danger" title="无权限" description="该页面仅管理员可访问。" />
  }

  if (!clientId) {
    return <AdminNotice tone="danger" title="参数错误" description="缺少应用 ID。" />
  }

  if (loading) {
    return <AdminLoadingState label="正在加载应用..." />
  }

  if (error || !client) {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="编辑应用"
          actions={
            <Button variant="secondary" onPress={() => router.push('/admin/apps')}>
              返回应用列表
            </Button>
          }
        />
        <AdminNotice tone="danger" description={error || '应用不存在'} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={`编辑：${client.name}`}
        description={`Client ID: ${client.client_id}`}
        actions={
          <Button variant="secondary" onPress={() => router.push('/admin/apps')}>
            返回应用列表
          </Button>
        }
      />

      <form onSubmit={void handleSave} className="space-y-6">
        <AppFormFields
          formData={formData}
          setFormData={setFormData}
          formError={formError}
          layout="two-column"
        />

        <div className="flex gap-3 pt-2">
          <Button type="submit" variant="primary" isPending={saving} isDisabled={saving}>
            保存
          </Button>
          <Button type="button" variant="secondary" onPress={() => router.push('/admin/apps')}>
            取消
          </Button>
        </div>
      </form>
    </div>
  )
}
