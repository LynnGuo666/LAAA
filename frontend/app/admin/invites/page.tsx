'use client'

import { useCallback, useEffect, useState } from 'react'
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
  AdminFieldGroup,
  AdminFormField,
  AdminLoadingState,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
} from '@/components/admin/admin-ui'
import { AdminPagination } from '@/components/admin/pagination'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { MobileField, MobileList, MobileListCard } from '@/components/ui/mobile-list'
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider'
import { adminApi, groupApi } from '@/lib/api'
import { hasPermission } from '@/lib/authz'
import { formatDateTime } from '@/lib/date'
import { useAuthStore } from '@/lib/store'
import { extractErrorMessage } from '@/lib/errors';

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
  const canManage = hasPermission(user, 'admin.users')

  const [groups, setGroups] = useState<Group[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('active')
  const [page, setPage] = useState(0)
  const limit = 20
  const [createForm, setCreateForm] = useState({
    groupId: 0,
    note: '',
    expiresAtLocal: '',
    maxUses: '',
  })

  const loadGroups = async () => {
    try {
      const response = await groupApi.list()
      setGroups(Array.isArray(response.data) ? response.data : [])
    } catch {
      setGroups([])
    }
  }

  const loadInvites = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const response = await adminApi.listInvites({
        skip: page * limit,
        limit,
        // 状态筛选走服务端（后端支持 active 参数）
        active: filterActive === 'all' ? undefined : filterActive === 'active',
      })
      const data = response.data
      // 后端返回 {items, total}：分页用服务端总数（当页条数不是总数，
      // 否则超过一页时永远翻不到第 2 页）
      setInvites(Array.isArray(data?.items) ? data.items : [])
      setTotal(typeof data?.total === 'number' ? data.total : 0)
    } catch (err: any) {
      setError(extractErrorMessage(err, '加载邀请码失败'))
      setInvites([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, filterActive])

  useEffect(() => {
    if (!canManage) return
    void loadGroups()
  }, [canManage])

  useEffect(() => {
    if (!canManage) return
    void loadInvites()
  }, [canManage, loadInvites])

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
      await adminApi.createInvite({
        group_id: createForm.groupId,
        note: createForm.note.trim() || undefined,
        expires_at: expiresAt,
        max_uses: maxUses,
      })
      // 回到第一页并刷新，保证新邀请码立即可见
      if (page !== 0) {
        setPage(0)
      } else {
        await loadInvites()
      }
      setCreateForm({
        groupId: createForm.groupId,
        note: '',
        expiresAtLocal: '',
        maxUses: '',
      })
      toast('邀请码已生成')
    } catch (err: any) {
      setError(extractErrorMessage(err, '创建邀请码失败'))
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
      // 筛选为「仅有效」时把停用项从当前列表移除
      setInvites((previous) =>
        filterActive === 'active'
          ? previous.filter((item) => item.id !== invite.id)
          : previous.map((item) => (item.id === invite.id ? response.data : item)),
      )
      // 「仅有效」口径下停用一条，服务端总数同步减一
      if (filterActive === 'active') {
        setTotal((previous) => Math.max(0, previous - 1))
      }
      toast('邀请码已停用')
    } catch (err: any) {
      setError(extractErrorMessage(err, '停用邀请码失败'))
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
    return <AdminLoadingState label="正在加载邀请码…" />
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="邀请码"
        description="邀请制注册入口，邀请码决定新用户初始所属用户组。"
        actions={
          <Button variant="secondary" onPress={() => void loadInvites()} isDisabled={loading}>
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

            <AdminFieldGroup label="过期时间" description="留空表示不过期">
              <DateTimePicker
                value={createForm.expiresAtLocal}
                onChange={(value) =>
                  setCreateForm((previous) => ({
                    ...previous,
                    expiresAtLocal: value,
                  }))
                }
                isDisabled={creating}
                ariaLabel="过期时间"
              />
              {createForm.expiresAtLocal ? (
                <Button
                  type="button"
                  variant="tertiary"
                  size="sm"
                  className="w-fit px-0 text-xs text-muted"
                  onPress={() =>
                    setCreateForm((previous) => ({
                      ...previous,
                      expiresAtLocal: '',
                    }))
                  }
                >
                  清除过期时间
                </Button>
              ) : null}
            </AdminFieldGroup>

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
                onSelectionChange={(key) => {
                  setFilterActive(String(key) as 'all' | 'active' | 'inactive')
                  setPage(0)
                }}
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
          {invites.length === 0 ? (
            <AdminEmptyState
              className="border-0"
              title="暂无邀请码"
              description="生成一个邀请码后，这里会显示完整使用记录。"
            />
          ) : (
            <>
              <div className="hidden md:block">
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
                        {invites.map((invite) => {
                          const usedCount = invite.used_count ?? 0
                          const limitText = invite.max_uses
                            ? `${usedCount}/${invite.max_uses}`
                            : `${usedCount}/∞`

                          return (
                            <Table.Row key={invite.id} id={String(invite.id)}>
                              <Table.Cell>
                                <div className="flex items-center gap-2">
                                  <code className="rounded-lg bg-default px-2 py-1 text-xs font-medium">
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
                                    <p className="text-xs text-muted">
                                      到期：{formatDateTime(invite.expires_at)}
                                    </p>
                                  ) : null}
                                </div>
                              </Table.Cell>
                              <Table.Cell>
                                <div className="space-y-1 text-sm">
                                  <p>{limitText}</p>
                                  {invite.used_at ? (
                                    <p className="text-xs text-muted">
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
              </div>

              <MobileList>
                {invites.map((invite) => {
                  const usedCount = invite.used_count ?? 0
                  const limitText = invite.max_uses
                    ? `${usedCount}/${invite.max_uses}`
                    : `${usedCount}/∞`

                  return (
                    <MobileListCard key={invite.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <code className="break-all rounded-lg bg-default px-2 py-1 text-xs font-medium">
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
                        <div className="shrink-0">
                          <Chip
                            color={invite.is_active ? 'success' : 'default'}
                            variant="soft"
                            size="sm"
                          >
                            {invite.is_active ? '有效' : '无效'}
                          </Chip>
                        </div>
                      </div>

                      <div className="mt-4 space-y-1.5">
                        <MobileField label="用户组">
                          {invite.group_name || `#${invite.group_id}`}
                        </MobileField>
                        <MobileField label="使用情况">
                          <p>{limitText}</p>
                          {invite.used_at ? (
                            <p className="text-xs text-muted">
                              最后一次：{formatDateTime(invite.used_at)}
                            </p>
                          ) : null}
                        </MobileField>
                        {invite.expires_at ? (
                          <MobileField label="到期时间">
                            {formatDateTime(invite.expires_at)}
                          </MobileField>
                        ) : null}
                        <MobileField label="备注">{invite.note || '—'}</MobileField>
                      </div>

                      <div className="mt-4">
                        <Button
                          variant="danger"
                          size="sm"
                          className="w-full"
                          isDisabled={!invite.is_active}
                          onPress={() => void handleDeactivate(invite)}
                        >
                          停用
                        </Button>
                      </div>
                    </MobileListCard>
                  )
                })}
              </MobileList>
            </>
          )}
        </Card.Content>

        <Card.Footer className="border-t border-border/70 px-6 py-4">
          <AdminPagination
            page={page}
            total={total}
            limit={limit}
            onPageChange={setPage}
            summary={(page, totalPages, total) =>
              `第 ${page + 1} / ${totalPages} 页，共 ${total} 条`
            }
          />
        </Card.Footer>
      </AdminSection>
    </div>
  )
}
