'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Card,
  Checkbox,
  CheckboxGroup,
  Chip,
  Input,
  RadioGroup,
  TextArea,
  toast,
} from '@heroui/react'
import {
  AdminEmptyState,
  AdminFieldGroup,
  AdminFormField,
  AdminLoadingState,
  AdminModalForm,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  EntityAvatar,
} from '@/components/admin/admin-ui'
import SidePanel from '@/components/SidePanel'
import { UICheckbox, UIRadio } from '@/components/ui/primitives'
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider'
import { clientApi, groupApi } from '@/lib/api'
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

interface Group {
  id: number
  name: string
  description?: string
}

const AVAILABLE_SCOPES = [
  { value: 'profile', label: '基本信息 (profile)', description: '用户名、头像等基本信息' },
  { value: 'email', label: '邮箱地址 (email)', description: '用户邮箱地址' },
  { value: 'openid', label: 'OpenID Connect (openid)', description: 'OIDC 标准身份范围' },
  { value: 'read', label: '读取权限 (read)', description: '读取用户数据' },
  { value: 'write', label: '写入权限 (write)', description: '修改用户数据' },
]

export default function AppsPage() {
  const confirmDialog = useConfirmDialog()
  const router = useRouter()
  const user = useAuthStore((state) => state.user)
  const canManageClients = isAdmin(user)

  const [clients, setClients] = useState<Client[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)

  const [creating, setCreating] = useState(false)
  const [resettingClientId, setResettingClientId] = useState<number | null>(null)
  const [deletingClientId, setDeletingClientId] = useState<number | null>(null)
  const [accessControlLoading, setAccessControlLoading] = useState(false)
  const [accessControlSaving, setAccessControlSaving] = useState(false)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showAccessControl, setShowAccessControl] = useState(false)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)

  const [formError, setFormError] = useState<string | null>(null)
  const [accessControlError, setAccessControlError] = useState<string | null>(null)

  const [newClientCredentials, setNewClientCredentials] = useState<{
    client_id: string
    client_secret: string
  } | null>(null)
  const [showNewSecret, setShowNewSecret] = useState(true)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [accessControl, setAccessControl] = useState({
    allowed_group_ids: [] as number[],
    denied_group_ids: [] as number[],
  })
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    logo: '',
    website_url: '',
    redirect_uris: '',
    allowed_scopes: ['profile', 'email'],
    trusted: false,
    default_access: false,
  })

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

  const loadGroups = async () => {
    try {
      const response = await groupApi.list()
      setGroups(response.data)
    } catch {
      setGroups([])
    }
  }

  useEffect(() => {
    if (!canManageClients) return
    setPageError(null)
    void Promise.all([loadClients(), loadGroups()])
  }, [canManageClients])

  const resetForm = () => {
    setFormError(null)
    setFormData({
      name: '',
      description: '',
      logo: '',
      website_url: '',
      redirect_uris: '',
      allowed_scopes: ['profile', 'email'],
      trusted: false,
      default_access: false,
    })
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

  const validateForm = () => {
    if (!formData.name.trim()) {
      return '应用名称不能为空'
    }
    if (formData.allowed_scopes.length === 0) {
      return '请至少选择一个权限范围'
    }
    if (formData.redirect_uris.split('\n').filter((item) => item.trim()).length === 0) {
      return '请至少填写一个回调地址'
    }
    return null
  }

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

  const openAccessControl = async (client: Client) => {
    setSelectedClient(client)
    setShowAccessControl(true)
    setAccessControlError(null)
    setAccessControlLoading(true)

    try {
      const response = await clientApi.getAccessControl(client.id)
      const data = response.data
      setAccessControl({
        allowed_group_ids: Array.isArray(data.allowed_groups)
          ? data.allowed_groups.map((group: Group) => group.id)
          : [],
        denied_group_ids: Array.isArray(data.denied_groups)
          ? data.denied_groups.map((group: Group) => group.id)
          : [],
      })
    } catch (err: any) {
      setAccessControlError(err.response?.data?.detail || '加载访问控制失败')
    } finally {
      setAccessControlLoading(false)
    }
  }

  const closeAccessControl = () => {
    setShowAccessControl(false)
    setSelectedClient(null)
    setAccessControlError(null)
    setAccessControl({ allowed_group_ids: [], denied_group_ids: [] })
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

  const handleAccessControlSave = async () => {
    if (!selectedClient) return

    const overlap = accessControl.allowed_group_ids.filter((id) =>
      accessControl.denied_group_ids.includes(id),
    )
    if (overlap.length > 0) {
      setAccessControlError('同一个用户组不能同时出现在允许和禁止列表中')
      return
    }

    try {
      setAccessControlSaving(true)
      setAccessControlError(null)
      await clientApi.updateAccessControl(selectedClient.id, accessControl)
      toast('访问控制已更新')
      closeAccessControl()
    } catch (err: any) {
      setAccessControlError(err.response?.data?.detail || '更新访问控制失败')
    } finally {
      setAccessControlSaving(false)
    }
  }

  const toggleGroupInList = (groupId: number, listType: 'allowed' | 'denied') => {
    if (listType === 'allowed') {
      setAccessControl((previous) => ({
        ...previous,
        denied_group_ids: previous.denied_group_ids.filter((id) => id !== groupId),
        allowed_group_ids: previous.allowed_group_ids.includes(groupId)
          ? previous.allowed_group_ids.filter((id) => id !== groupId)
          : [...previous.allowed_group_ids, groupId],
      }))
      return
    }

    setAccessControl((previous) => ({
      ...previous,
      allowed_group_ids: previous.allowed_group_ids.filter((id) => id !== groupId),
      denied_group_ids: previous.denied_group_ids.includes(groupId)
        ? previous.denied_group_ids.filter((id) => id !== groupId)
        : [...previous.denied_group_ids, groupId],
    }))
  }

  const renderAppFormFields = () => (
    <>
      {formError ? <AdminNotice tone="danger" description={formError} /> : null}

      <AdminFormField label="应用名称" isRequired>
        <Input
          type="text"
          value={formData.name}
          onChange={(event) =>
            setFormData((previous) => ({ ...previous, name: event.target.value }))
          }
        />
      </AdminFormField>

      <AdminFormField label="应用描述">
        <TextArea
          rows={3}
          value={formData.description}
          onChange={(event) =>
            setFormData((previous) => ({ ...previous, description: event.target.value }))
          }
        />
      </AdminFormField>

      <AdminFormField
        label="应用 Logo URL"
        description="Logo 会显示在授权页面上。"
      >
        <Input
          type="url"
          placeholder="https://example.com/logo.png"
          value={formData.logo}
          onChange={(event) =>
            setFormData((previous) => ({ ...previous, logo: event.target.value }))
          }
        />
      </AdminFormField>

      <AdminFormField label="应用官网">
        <Input
          type="url"
          placeholder="https://example.com"
          value={formData.website_url}
          onChange={(event) =>
            setFormData((previous) => ({ ...previous, website_url: event.target.value }))
          }
        />
      </AdminFormField>

      <AdminFormField
        label="回调地址"
        description="每行一个回调地址。"
        isRequired
      >
        <TextArea
          rows={4}
          className="font-mono text-sm"
          placeholder={`http://localhost:3000/callback\nhttps://myapp.com/callback`}
          value={formData.redirect_uris}
          onChange={(event) =>
            setFormData((previous) => ({ ...previous, redirect_uris: event.target.value }))
          }
        />
      </AdminFormField>

      <AdminFieldGroup
        label="权限范围"
        description={`已选择 ${formData.allowed_scopes.length} 项权限。`}
      >
        <Card>
          <Card.Content className="px-4 py-2">
            <CheckboxGroup
              aria-label="权限范围"
              value={formData.allowed_scopes}
              onChange={(value) =>
                setFormData((previous) => ({
                  ...previous,
                  allowed_scopes: Array.isArray(value) ? value.map(String) : [],
                }))
              }
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

      <AdminFieldGroup label="信任应用">
        <Checkbox
          variant="secondary"
          isSelected={formData.trusted}
          onChange={(isSelected) =>
            setFormData((previous) => ({ ...previous, trusted: isSelected }))
          }
        >
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <Checkbox.Content>信任的应用将跳过授权确认</Checkbox.Content>
        </Checkbox>
      </AdminFieldGroup>

      <AdminFieldGroup
        label="默认访问"
        description="当未配置用户或用户组权限时，将采用这里的默认策略。"
      >
        <RadioGroup
          orientation="vertical"
          value={formData.default_access ? 'allow' : 'deny'}
          onChange={(value) =>
            setFormData((previous) => ({
              ...previous,
              default_access: value === 'allow',
            }))
          }
          className="space-y-2"
        >
          <UIRadio value="allow">允许</UIRadio>
          <UIRadio value="deny">拒绝</UIRadio>
        </RadioGroup>
      </AdminFieldGroup>
    </>
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
        description="统一管理 OAuth 应用、回调地址、授权范围和访问控制策略。"
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
          description="创建一个应用后，就能配置 OAuth 回调和访问控制。"
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
                  variant="secondary"
                  size="sm"
                  isPending={accessControlLoading && selectedClient?.id === client.id}
                  isDisabled={accessControlLoading && selectedClient?.id === client.id}
                  onPress={() => void openAccessControl(client)}
                >
                  访问控制
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

<SidePanel
        title={selectedClient ? `访问控制：${selectedClient.name}` : '访问控制'}
        open={showAccessControl && !!selectedClient}
        onClose={closeAccessControl}
      >
        {!selectedClient ? null : accessControlLoading ? (
          <AdminLoadingState label="正在加载访问控制..." className="border-0 p-0 shadow-none" />
        ) : (
          <div className="space-y-6">
            {accessControlError ? <AdminNotice tone="danger" description={accessControlError} /> : null}

            <AdminNotice
              tone="accent"
              description="允许列表与禁止列表互斥；同一个用户组不会同时出现在两边。"
            />

            <AdminFieldGroup
              label="允许访问（白名单）"
              description="这些用户组的成员可以访问此应用。"
            >
              <Card>
                <Card.Content className="max-h-72 space-y-2 overflow-y-auto px-4 py-2">
                  {groups.map((group) => (
                    <UICheckbox
                      key={group.id}
                      className="m-0 max-w-full border-b border-default-200/70 py-3 last:border-b-0"
                      isSelected={accessControl.allowed_group_ids.includes(group.id)}
                      onChange={() => toggleGroupInList(group.id, 'allowed')}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{group.name}</p>
                        {group.description ? (
                          <p className="mt-1 text-xs text-default-500">{group.description}</p>
                        ) : null}
                      </div>
                    </UICheckbox>
                  ))}
                </Card.Content>
              </Card>
            </AdminFieldGroup>

            <AdminFieldGroup
              label="禁止访问（黑名单）"
              description="这些用户组的成员会被拒绝访问。"
            >
              <Card>
                <Card.Content className="max-h-72 space-y-2 overflow-y-auto px-4 py-2">
                  {groups.map((group) => (
                    <UICheckbox
                      key={group.id}
                      className="m-0 max-w-full border-b border-default-200/70 py-3 last:border-b-0"
                      isSelected={accessControl.denied_group_ids.includes(group.id)}
                      onChange={() => toggleGroupInList(group.id, 'denied')}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{group.name}</p>
                        {group.description ? (
                          <p className="mt-1 text-xs text-default-500">{group.description}</p>
                        ) : null}
                      </div>
                    </UICheckbox>
                  ))}
                </Card.Content>
              </Card>
            </AdminFieldGroup>

            <div className="flex gap-2 pt-2">
              <Button
                variant="primary"
                className="flex-1"
                isPending={accessControlSaving}
                isDisabled={accessControlSaving}
                onPress={() => void handleAccessControlSave()}
              >
                保存
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                isDisabled={accessControlSaving}
                onPress={closeAccessControl}
              >
                取消
              </Button>
            </div>
          </div>
        )}
      </SidePanel>

      <AdminModalForm
        title="创建新应用"
        description="创建后即可生成 Client ID / Secret，并继续配置访问控制。"
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
