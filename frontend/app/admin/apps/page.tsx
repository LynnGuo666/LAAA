'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Card,
  Chip,
  toast,
} from '@heroui/react'
import {
  AdminEmptyState,
  AdminFieldGroup,
  AdminLoadingState,
  AdminModalForm,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  EntityAvatar,
} from '@/components/admin/admin-ui'
import {
  AppFormFields,
  EMPTY_APP_FORM,
  type AppFormData,
  validateAppForm,
} from '@/components/admin/app-form-fields'
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider'
import { clientApi } from '@/lib/api'
import { hasPermission } from '@/lib/authz'
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

export default function AppsPage() {
  const confirmDialog = useConfirmDialog()
  const router = useRouter()
  const user = useAuthStore((state) => state.user)
  const canManageClients = hasPermission(user, 'admin.clients')

  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [resettingClientId, setResettingClientId] = useState<number | null>(null)
  const [deletingClientId, setDeletingClientId] = useState<number | null>(null)

  const [showCreateModal, setShowCreateModal] = useState(false)

  const [formError, setFormError] = useState<string | null>(null)

  const [newClientCredentials, setNewClientCredentials] = useState<{
    client_id: string
    client_secret: string
  } | null>(null)
  const [showNewSecret, setShowNewSecret] = useState(true)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [formData, setFormData] = useState<AppFormData>({ ...EMPTY_APP_FORM })

  const loadClients = async () => {
    try {
      const response = await clientApi.list()
      setClients(response.data)
    } catch (err: any) {
      setPageError(err.response?.data?.detail || '加载应用列表失败')
      setClients([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!canManageClients) return
    setPageError(null)
    void loadClients()
  }, [canManageClients])

  const resetForm = () => {
    setFormError(null)
    setFormData({ ...EMPTY_APP_FORM })
  }

  const closeCreateModal = () => {
    setShowCreateModal(false)
    resetForm()
  }

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus(`${label} 已复制`)
      toast(`${label} 已复制`)
      window.setTimeout(() => setCopyStatus(null), 1500)
    } catch {
      setCopyStatus('复制失败，请手动复制')
      toast('复制失败，请手动复制')
      window.setTimeout(() => setCopyStatus(null), 2000)
    }
  }

  const validateForm = () => validateAppForm(formData)

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validationError = validateForm()
    if (validationError) {
      setFormError(validationError)
      return
    }

    try {
      setCreating(true)
      setFormError(null)
      const response = await clientApi.create({
        name: formData.name.trim(),
        description: formData.description || undefined,
        logo: formData.logo || undefined,
        website_url: formData.website_url || undefined,
        redirect_uris: formData.redirect_uris.split('\n').filter((item) => item.trim()),
        allowed_scopes: formData.allowed_scopes,
        trusted: formData.trusted,
        default_access: formData.default_access,
      })
      setNewClientCredentials({
        client_id: response.data.client_id,
        client_secret: response.data.client_secret,
      })
      setShowNewSecret(true)
      setCopyStatus(null)
      closeCreateModal()
      await loadClients()
      toast('应用已创建')
    } catch (err: any) {
      setFormError(err.response?.data?.detail || '创建应用失败')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (client: Client) => {
    const shouldDelete = await confirmDialog({
      title: '确认删除应用',
      description: `确定要删除应用 ${client.name} 吗？`,
      confirmText: '删除应用',
      cancelText: '取消',
      status: 'danger',
      confirmVariant: 'danger',
    })

    if (!shouldDelete) return

    try {
      setDeletingClientId(client.id)
      await clientApi.delete(client.id)
      await loadClients()
      toast('应用已删除')
    } catch (err: any) {
      setPageError(err.response?.data?.detail || '删除应用失败')
    } finally {
      setDeletingClientId(null)
    }
  }

  const handleResetSecret = async (client: Client) => {
    const shouldReset = await confirmDialog({
      title: '确认重置密钥',
      description: `确定要重置 ${client.name} 的 Client Secret 吗？旧密钥会立即失效。`,
      confirmText: '重置密钥',
      cancelText: '取消',
      status: 'warning',
      confirmVariant: 'danger',
    })

    if (!shouldReset) return

    try {
      setResettingClientId(client.id)
      const response = await clientApi.resetSecret(client.id)
      setNewClientCredentials({
        client_id: response.data.client_id,
        client_secret: response.data.client_secret,
      })
      setShowNewSecret(true)
      setCopyStatus(null)
      toast('密钥已重置')
    } catch (err: any) {
      setPageError(err.response?.data?.detail || '重置密钥失败')
    } finally {
      setResettingClientId(null)
    }
  }

  const renderAppFormFields = () => (
    <AppFormFields
      formData={formData}
      setFormData={setFormData}
      formError={formError}
    />
  )

  if (!canManageClients) {
    return (
      <AdminNotice tone="danger" title="无权限" description="该页面仅管理员可访问。" />
    )
  }

  if (loading) {
    return <AdminLoadingState label="正在加载应用..." />
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="应用管理"
        description="统一管理 OAuth 应用、回调地址与授权范围。"
        actions={
          <Button variant="primary" onPress={() => setShowCreateModal(true)}>
            创建应用
          </Button>
        }
      />

      {pageError ? <AdminNotice tone="danger" description={pageError} /> : null}

      {newClientCredentials ? (
        <AdminSection className="border-warning/40">
          <Card.Header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <Card.Title>应用密钥仅本次显示</Card.Title>
              <Card.Description>
                请立即保存 Client Secret。关闭后无法再次查看，但可以在此页面重置。
              </Card.Description>
            </div>
            <Button variant="secondary" onPress={() => setNewClientCredentials(null)}>
              关闭
            </Button>
          </Card.Header>
          <Card.Content className="space-y-4 p-6 pt-0">
            <AdminFieldGroup label="Client ID">
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-xl bg-default-100 px-3 py-2 text-xs font-medium">
                  {newClientCredentials.client_id}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() =>
                    void copyToClipboard(newClientCredentials.client_id, 'Client ID')
                  }
                >
                  复制
                </Button>
              </div>
            </AdminFieldGroup>

            <AdminFieldGroup label="Client Secret">
              <div className="flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 rounded-xl bg-default-100 px-3 py-2 text-xs font-medium break-all">
                  {showNewSecret
                    ? newClientCredentials.client_secret
                    : '••••••••••••••••'}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() => setShowNewSecret((value) => !value)}
                >
                  {showNewSecret ? '隐藏' : '显示'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onPress={() =>
                    void copyToClipboard(newClientCredentials.client_secret, 'Client Secret')
                  }
                >
                  复制
                </Button>
              </div>
              {copyStatus ? <p className="text-xs text-default-500">{copyStatus}</p> : null}
            </AdminFieldGroup>
          </Card.Content>
        </AdminSection>
      ) : null}

      {clients.length === 0 ? (
        <AdminEmptyState
          title="还没有应用"
          description="创建一个应用后，就能配置 OAuth 回调与授权范围。"
          action={
            <Button variant="primary" onPress={() => setShowCreateModal(true)}>
              创建应用
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {clients.map((client) => (
            <AdminSection key={client.id}>
              <Card.Header className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <EntityAvatar src={client.logo} name={client.name} rounded="lg" />
                  <div className="min-w-0">
                    <Card.Title>{client.name}</Card.Title>
                    {client.description ? (
                      <Card.Description className="mt-1">
                        {client.description}
                      </Card.Description>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {client.trusted ? (
                    <Chip color="success" variant="soft" size="sm">
                      信任应用
                    </Chip>
                  ) : null}
                  <Chip
                    color={client.default_access ? 'accent' : 'default'}
                    variant="soft"
                    size="sm"
                  >
                    默认{client.default_access ? '允许' : '拒绝'}
                  </Chip>
                </div>
              </Card.Header>

              <Card.Content className="space-y-3 px-6 pb-0">
                <div className="space-y-1 text-sm text-default-600">
                  <p>
                    Client ID：
                    <code className="ml-2 rounded-lg bg-default-100 px-2 py-1 text-xs font-medium">
                      {client.client_id}
                    </code>
                  </p>
                  <p>权限范围：{client.allowed_scopes.join('、')}</p>
                  {client.website_url ? <p>官网：{client.website_url}</p> : null}
                </div>
              </Card.Content>

              <Card.Footer className="flex flex-wrap gap-2">
                <Button variant="primary" size="sm" onPress={() => router.push(`/admin/apps/edit?id=${client.id}`)}>
                  编辑
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  isPending={resettingClientId === client.id}
                  isDisabled={resettingClientId === client.id}
                  onPress={() => void handleResetSecret(client)}
                >
                  重置密钥
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  isPending={deletingClientId === client.id}
                  isDisabled={deletingClientId === client.id}
                  onPress={() => void handleDelete(client)}
                >
                  删除
                </Button>
              </Card.Footer>
            </AdminSection>
          ))}
        </div>
      )}

      <AdminModalForm
        title="创建新应用"
        description="创建后即可生成 Client ID / Secret。"
        isOpen={showCreateModal}
        onOpenChange={(isOpen) => {
          if (!isOpen) closeCreateModal()
          else setShowCreateModal(true)
        }}
        onSubmit={handleCreate}
        primaryActionLabel="创建应用"
        isPending={creating}
      >
        {renderAppFormFields()}
      </AdminModalForm>
    </div>
  )
}
