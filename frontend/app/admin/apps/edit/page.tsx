'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Button,
  Card,
  Checkbox,
  CheckboxGroup,
  Input,
  RadioGroup,
  TextArea,
  toast,
} from '@heroui/react'
import {
  AdminFieldGroup,
  AdminFormField,
  AdminLoadingState,
  AdminNotice,
  AdminPageHeader,
} from '@/components/admin/admin-ui'
import { UICheckbox, UIRadio } from '@/components/ui/primitives'
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

const AVAILABLE_SCOPES = [
  { value: 'profile', label: '基本信息 (profile)', description: '用户名、头像等基本信息' },
  { value: 'email', label: '邮箱地址 (email)', description: '用户邮箱地址' },
  { value: 'openid', label: 'OpenID Connect (openid)', description: 'OIDC 标准身份范围' },
  { value: 'read', label: '读取权限 (read)', description: '读取用户数据' },
  { value: 'write', label: '写入权限 (write)', description: '修改用户数据' },
]

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

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    logo: '',
    website_url: '',
    redirect_uris: '',
    allowed_scopes: ['profile', 'email'] as string[],
    trusted: false,
    default_access: false,
  })

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

  const validateForm = () => {
    if (!formData.name.trim()) return '应用名称不能为空'
    if (formData.allowed_scopes.length === 0) return '请至少选择一个权限范围'
    if (formData.redirect_uris.split('\n').filter((s) => s.trim()).length === 0) return '请至少填写一个回调地址'
    return null
  }

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
        {formError ? <AdminNotice tone="danger" description={formError} /> : null}

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <AdminFormField label="应用名称" isRequired>
              <Input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              />
            </AdminFormField>

            <AdminFormField label="应用描述">
              <TextArea
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
              />
            </AdminFormField>

            <AdminFormField label="应用 Logo URL" description="Logo 会显示在授权页面上。">
              <Input
                type="url"
                placeholder="https://example.com/logo.png"
                value={formData.logo}
                onChange={(e) => setFormData((p) => ({ ...p, logo: e.target.value }))}
              />
            </AdminFormField>

            <AdminFormField label="应用官网">
              <Input
                type="url"
                placeholder="https://example.com"
                value={formData.website_url}
                onChange={(e) => setFormData((p) => ({ ...p, website_url: e.target.value }))}
              />
            </AdminFormField>
          </div>

          <div className="space-y-6">
            <AdminFormField label="回调地址" description="每行一个回调地址。" isRequired>
              <TextArea
                rows={4}
                className="font-mono text-sm"
                placeholder="http://localhost:3000/callback"
                value={formData.redirect_uris}
                onChange={(e) => setFormData((p) => ({ ...p, redirect_uris: e.target.value }))}
              />
            </AdminFormField>

            <AdminFieldGroup label="信任应用">
              <Checkbox
                variant="secondary"
                isSelected={formData.trusted}
                onChange={(isSelected) => setFormData((p) => ({ ...p, trusted: isSelected }))}
              >
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Checkbox.Content>信任的应用将跳过授权确认</Checkbox.Content>
              </Checkbox>
            </AdminFieldGroup>

            <AdminFieldGroup label="默认访问" description="当未配置用户或用户组权限时，将采用这里的默认策略。">
              <RadioGroup
                orientation="vertical"
                value={formData.default_access ? 'allow' : 'deny'}
                onChange={(value) => setFormData((p) => ({ ...p, default_access: value === 'allow' }))}
                className="space-y-2"
              >
                <UIRadio value="allow">允许</UIRadio>
                <UIRadio value="deny">拒绝</UIRadio>
              </RadioGroup>
            </AdminFieldGroup>
          </div>
        </div>

        <AdminFieldGroup label="权限范围" description={`已选择 ${formData.allowed_scopes.length} 项权限。`}>
          <Card>
            <Card.Content className="px-4 py-2">
              <CheckboxGroup
                aria-label="权限范围"
                value={formData.allowed_scopes}
                onChange={(value) => setFormData((p) => ({ ...p, allowed_scopes: Array.isArray(value) ? value.map(String) : [] }))}
              >
                {AVAILABLE_SCOPES.map((scope) => (
                  <UICheckbox
                    key={scope.value}
                    value={scope.value}
                    className="m-0 max-w-full border-b border-default-200/70 py-3 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{scope.label}</p>
                      <p className="text-xs text-default-500">{scope.description}</p>
                    </div>
                  </UICheckbox>
                ))}
              </CheckboxGroup>
            </Card.Content>
          </Card>
        </AdminFieldGroup>

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
