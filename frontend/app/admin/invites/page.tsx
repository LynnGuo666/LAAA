'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Chip,
  Input,
  ListBox,
  ListBoxItem,
  Select,
  Table,
  toast,
} from '@heroui/react'
import {
  AdminEmptyState,
  AdminFormField,
  AdminLoadingState,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
} from '@/components/admin/admin-ui'
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider'
import { adminApi, groupApi } from '@/lib/api'
import { isAdmin } from '@/lib/authz'
import { formatDateTime } from '@/lib/date'
import { useAuthStore } from '@/lib/store'

interface Group {
  id: number
  name: string
}

interface Invite {
  id: number
  code: string
  note?: string | null
  group_id: number
  group_name: string
  is_active: boolean
  expires_at?: string | null
  max_uses?: number | null
  used_count: number
  created_by_user_id?: number | null
  used_by_user_id?: number | null
  used_at?: string | null
  created_at: string
  updated_at: string
}

export default function InvitesPage() {
  const confirmDialog = useConfirmDialog()
  const user = useAuthStore((state) => state.user)
  const canManage = isAdmin(user)

  const [groups, setGroups] = useState<Group[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('active')
  const [createForm, setCreateForm] = useState({
    groupId: 0,
    note: '',
    expiresAtLocal: '',
    maxUses: '',
  })

  const loadAll = async () => {
    setError(null)
    setLoading(true)
    try {
      const [groupsResponse, invitesResponse] = await Promise.all([
        groupApi.list(),
        adminApi.listInvites({ limit: 200 }),
      ])
      setGroups(Array.isArray(groupsResponse.data) ? groupsResponse.data : [])
      setInvites(Array.isArray(invitesResponse.data) ? invitesResponse.data : [])
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载邀请码失败')
      setGroups([])
      setInvites([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!canManage) return
    void loadAll()
  }, [canManage])

  const filteredInvites = useMemo(() => {
    if (filterActive === 'all') return invites
    const target = filterActive === 'active'
    return invites.filter((invite) => invite.is_active === target)
  }, [filterActive, invites])

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (!createForm.groupId) {
      setError('请选择用户组')
      return
    }

    let maxUses: number | undefined
    if (createForm.maxUses.trim()) {
      maxUses = Number(createForm.maxUses.trim())
      if (!Number.isFinite(maxUses) || maxUses < 1) {
        setError('使用次数必须为正整数，或留空表示不限制')
        return
      }
    }

    setCreating(true)
    try {
      const expiresAt = createForm.expiresAtLocal
        ? new Date(createForm.expiresAtLocal).toISOString()
        : undefined
      const response = await adminApi.createInvite({
        group_id: createForm.groupId,
        note: createForm.note.trim() || undefined,
        expires_at: expiresAt,
        max_uses: maxUses,
      })
      setInvites((previous) => [response.data, ...previous])
      setCreateForm({
        groupId: createForm.groupId,
        note: '',
        expiresAtLocal: '',
        maxUses: '',
      })
      toast('邀请码已生成')
    } catch (err: any) {
      setError(err.response?.data?.detail || '创建邀请码失败')
    } finally {
      setCreating(false)
    }
  }

  const handleDeactivate = async (invite: Invite) => {
    const shouldDeactivate = await confirmDialog({
      title: '确认停用邀请码',
      description: `确定要停用邀请码 ${invite.code} 吗？停用后将无法继续注册。`,
      confirmText: '停用邀请码',
      cancelText: '取消',
      status: 'warning',
      confirmVariant: 'danger',
    })

    if (!shouldDeactivate) return

    setError(null)
    try {
      const response = await adminApi.updateInvite(invite.id, { is_active: false })
      setInvites((previous) =>
        previous.map((item) => (item.id === invite.id ? response.data : item)),
      )
      toast('邀请码已停用')
    } catch (err: any) {
      setError(err.response?.data?.detail || '停用邀请码失败')
    }
  }

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      toast('邀请码已复制')
    } catch {
      toast('复制失败，请手动复制')
    }
  }

  if (!canManage) {
    return (
      <AdminNotice tone="danger" title="无权限" description="该页面仅管理员可访问。" />
    )
  }

  if (loading) {
    return <AdminLoadingState label="正在加载邀请码..." />
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="邀请码"
        description="邀请制注册入口，邀请码决定新用户初始所属用户组。"
        actions={
          <Button variant="secondary" onPress={() => void loadAll()} isDisabled={loading}>
            刷新
          </Button>
        }
      />

      {error ? <AdminNotice tone="danger" description={error} /> : null}

      <AdminSection>
        <Card.Header>
          <div>
            <Card.Title>生成邀请码</Card.Title>
            <Card.Description>创建新的邀请注册链接和使用规则。</Card.Description>
          </div>
        </Card.Header>
        <Card.Content className="p-6 pt-0">
          <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <AdminFormField label="用户组" isRequired isDisabled={creating}>
              <Select
                placeholder="请选择"
                selectedKey={createForm.groupId ? String(createForm.groupId) : undefined}
                onSelectionChange={(key) =>
                  setCreateForm((previous) => ({
                    ...previous,
                    groupId: Number(String(key ?? '')),
                  }))
                }
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {groups.map((group) => (
                      <ListBoxItem key={group.id} id={String(group.id)}>
                        {group.name}
                      </ListBoxItem>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </AdminFormField>

            <AdminFormField label="过期时间" description="留空表示不过期" isDisabled={creating}>
              <Input
                type="datetime-local"
                value={createForm.expiresAtLocal}
                onChange={(event) =>
                  setCreateForm((previous) => ({
                    ...previous,
                    expiresAtLocal: event.target.value,
                  }))
                }
              />
            </AdminFormField>

            <AdminFormField label="使用次数" description="留空表示不限制" isDisabled={creating}>
              <Input
                type="number"
                min={1}
                value={createForm.maxUses}
                onChange={(event) =>
                  setCreateForm((previous) => ({
                    ...previous,
                    maxUses: event.target.value,
                  }))
                }
              />
            </AdminFormField>

            <AdminFormField label="备注" description="例如：发给某位同学" isDisabled={creating}>
              <Input
                value={createForm.note}
                onChange={(event) =>
                  setCreateForm((previous) => ({
                    ...previous,
                    note: event.target.value,
                  }))
                }
              />
            </AdminFormField>

            <div className="md:col-span-2 xl:col-span-4 flex justify-end">
              <Button type="submit" variant="primary" isPending={creating} isDisabled={creating}>
                生成邀请码
              </Button>
            </div>
          </form>
        </Card.Content>
      </AdminSection>

      <AdminSection>
        <Card.Header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Card.Title>邀请码列表</Card.Title>
            <Card.Description>查看当前邀请码状态与使用情况。</Card.Description>
          </div>
          <div className="w-full sm:w-44">
            <AdminFormField label="筛选状态">
              <Select
                selectedKey={filterActive}
                onSelectionChange={(key) =>
                  setFilterActive(String(key) as 'all' | 'active' | 'inactive')
                }
              >
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBoxItem id="active">仅有效</ListBoxItem>
                    <ListBoxItem id="inactive">仅无效</ListBoxItem>
                    <ListBoxItem id="all">全部</ListBoxItem>
                  </ListBox>
                </Select.Popover>
              </Select>
            </AdminFormField>
          </div>
        </Card.Header>

        <Card.Content className="p-0">
          {filteredInvites.length === 0 ? (
            <AdminEmptyState
              className="border-0"
              title="暂无邀请码"
              description="生成一个邀请码后，这里会显示完整使用记录。"
            />
          ) : (
            <Table aria-label="邀请码列表">
              <Table.ScrollContainer>
                <Table.Content>
                  <Table.Header>
                    <Table.Column isRowHeader>邀请码</Table.Column>
                    <Table.Column>用户组</Table.Column>
                    <Table.Column>状态</Table.Column>
                    <Table.Column>使用情况</Table.Column>
                    <Table.Column>备注</Table.Column>
                    <Table.Column>操作</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {filteredInvites.map((invite) => {
                      const usedCount = invite.used_count ?? 0
                      const limitText = invite.max_uses
                        ? `${usedCount}/${invite.max_uses}`
                        : `${usedCount}/∞`

                      return (
                        <Table.Row key={invite.id} id={String(invite.id)}>
                          <Table.Cell>
                            <div className="flex items-center gap-2">
                              <code className="rounded-lg bg-default-100 px-2 py-1 text-xs font-medium">
                                {invite.code}
                              </code>
                              <Button
                                variant="tertiary"
                                size="sm"
                                onPress={() => void handleCopy(invite.code)}
                              >
                                复制
                              </Button>
                            </div>
                          </Table.Cell>
                          <Table.Cell>{invite.group_name || `#${invite.group_id}`}</Table.Cell>
                          <Table.Cell>
                            <div className="space-y-2">
                              <Chip
                                color={invite.is_active ? 'success' : 'default'}
                                variant="soft"
                                size="sm"
                              >
                                {invite.is_active ? '有效' : '无效'}
                              </Chip>
                              {invite.expires_at ? (
                                <p className="text-xs text-default-500">
                                  到期：{formatDateTime(invite.expires_at)}
                                </p>
                              ) : null}
                            </div>
                          </Table.Cell>
                          <Table.Cell>
                            <div className="space-y-1 text-sm">
                              <p>{limitText}</p>
                              {invite.used_at ? (
                                <p className="text-xs text-default-500">
                                  最后一次：{formatDateTime(invite.used_at)}
                                </p>
                              ) : null}
                            </div>
                          </Table.Cell>
                          <Table.Cell>{invite.note || '—'}</Table.Cell>
                          <Table.Cell>
                            <Button
                              variant="danger"
                              size="sm"
                              isDisabled={!invite.is_active}
                              onPress={() => void handleDeactivate(invite)}
                            >
                              停用
                            </Button>
                          </Table.Cell>
                        </Table.Row>
                      )
                    })}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          )}
        </Card.Content>
      </AdminSection>
    </div>
  )
}
