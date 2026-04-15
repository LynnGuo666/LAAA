'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Chip,
  Input,
  ListBox,
  Table,
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
  AdminSeparator,
  EntityAvatar,
} from '@/components/admin/admin-ui'
import SidePanel from '@/components/SidePanel'
import { UICheckbox } from '@/components/ui/primitives'
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider'
import { adminApi, clientApi, groupApi, groupAppApi } from '@/lib/api'
import { isAdmin } from '@/lib/authz'
import { formatDate } from '@/lib/date'
import { useAuthStore } from '@/lib/store'

interface Group {
  id: number
  name: string
  description?: string
  is_default: boolean
  member_count?: number
  created_at: string
  updated_at: string
}

interface User {
  id: number
  username: string
  email: string
  avatar?: string
  status: string
  groups: string[]
}

interface AppItem {
  id: number
  client_id: string
  name: string
  logo?: string
}

export default function GroupsPage() {
  const confirmDialog = useConfirmDialog()
  const user = useAuthStore((state) => state.user)
  const canManageGroups = isAdmin(user)

  const [groups, setGroups] = useState<Group[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [apps, setApps] = useState<AppItem[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)

  const [searchMembers, setSearchMembers] = useState('')
  const [appSearch, setAppSearch] = useState('')
  const [pendingAddIds, setPendingAddIds] = useState<number[]>([])
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [savingMeta, setSavingMeta] = useState(false)
  const [savingMembers, setSavingMembers] = useState(false)
  const [savingApps, setSavingApps] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState(false)

  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    is_default: false,
  })
  const [metaForm, setMetaForm] = useState({
    name: '',
    description: '',
    is_default: false,
  })
  const [selectedGroupAllowedApps, setSelectedGroupAllowedApps] = useState<number[]>([])
  const [selectedGroupDeniedApps, setSelectedGroupDeniedApps] = useState<number[]>([])

  const loadGroups = async () => {
    try {
      const response = await groupApi.list()
      setGroups(Array.isArray(response.data) ? response.data : [])
    } catch (err: any) {
      setPageError(err.response?.data?.detail || '加载用户组失败')
      setGroups([])
    } finally {
      setLoading(false)
    }
  }

  const loadUsers = async () => {
    try {
      const response = await adminApi.listUsers({ limit: 1000 })
      setUsers(Array.isArray(response.data.items) ? response.data.items : [])
    } catch {
      setUsers([])
    }
  }

  const loadApps = async () => {
    try {
      const response = await clientApi.list()
      setApps(Array.isArray(response.data) ? response.data : [])
    } catch {
      setApps([])
    }
  }

  useEffect(() => {
    if (!canManageGroups) return
    setPageError(null)
    void Promise.all([loadGroups(), loadUsers(), loadApps()])
  }, [canManageGroups])

  const openPanel = async (group: Group) => {
    setSelectedGroup(group)
    setPanelOpen(true)
    setPanelError(null)
    setSearchMembers('')
    setPendingAddIds([])
    setAppSearch('')
    setMetaForm({
      name: group.name,
      description: group.description || '',
      is_default: group.is_default,
    })

    try {
      const response = await groupAppApi.getAppPermissions(group.id)
      setSelectedGroupAllowedApps(response.data.allowed_apps.map((app: AppItem) => app.id))
      setSelectedGroupDeniedApps(response.data.denied_apps.map((app: AppItem) => app.id))
    } catch {
      setSelectedGroupAllowedApps([])
      setSelectedGroupDeniedApps([])
    }
  }

  const closePanel = () => {
    setPanelOpen(false)
    setSelectedGroup(null)
    setPanelError(null)
    setPendingAddIds([])
    setSearchMembers('')
    setAppSearch('')
  }

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPageError(null)
    setCreatingGroup(true)

    try {
      await groupApi.create({
        name: createForm.name.trim(),
        description: createForm.description.trim() || undefined,
        is_default: createForm.is_default,
      })
      setShowCreateModal(false)
      setCreateForm({ name: '', description: '', is_default: false })
      await Promise.all([loadGroups(), loadUsers()])
      toast('用户组已创建')
    } catch (err: any) {
      setPageError(err.response?.data?.detail || '创建用户组失败')
    } finally {
      setCreatingGroup(false)
    }
  }

  const handleUpdateMeta = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedGroup) return

    setPanelError(null)
    setSavingMeta(true)
    try {
      const response = await groupApi.update(selectedGroup.id, {
        name: metaForm.name.trim(),
        description: metaForm.description.trim() || undefined,
        is_default: metaForm.is_default,
      })
      setSelectedGroup(response.data)
      await Promise.all([loadGroups(), loadUsers()])
      toast('用户组信息已保存')
    } catch (err: any) {
      setPanelError(err.response?.data?.detail || '更新用户组失败')
    } finally {
      setSavingMeta(false)
    }
  }

  const members = selectedGroup
    ? users.filter((item) => item.groups?.includes(selectedGroup.name))
    : []

  const availableUsers = selectedGroup
    ? users.filter((item) => !item.groups?.includes(selectedGroup.name))
    : []

  const filteredAvailableUsers = useMemo(
    () =>
      availableUsers.filter(
        (item) =>
          item.username.toLowerCase().includes(searchMembers.toLowerCase()) ||
          item.email.toLowerCase().includes(searchMembers.toLowerCase()),
      ),
    [availableUsers, searchMembers],
  )

  const togglePendingAdd = (userId: number) => {
    setPendingAddIds((previous) =>
      previous.includes(userId)
        ? previous.filter((id) => id !== userId)
        : [...previous, userId],
    )
  }

  const handleAddMembers = async () => {
    if (!selectedGroup || pendingAddIds.length === 0) return

    setPanelError(null)
    setSavingMembers(true)
    try {
      await groupApi.addMembers(selectedGroup.id, pendingAddIds)
      setPendingAddIds([])
      await Promise.all([loadUsers(), loadGroups()])
      toast('成员已添加')
    } catch (err: any) {
      setPanelError(err.response?.data?.detail || '添加成员失败')
    } finally {
      setSavingMembers(false)
    }
  }

  const handleRemoveMember = async (userId: number) => {
    if (!selectedGroup) return

    setPanelError(null)
    try {
      await groupApi.removeMembers(selectedGroup.id, [userId])
      await Promise.all([loadUsers(), loadGroups()])
      toast('成员已移除')
    } catch (err: any) {
      setPanelError(err.response?.data?.detail || '移除成员失败')
    }
  }

  const toggleAllowedApp = (appId: number) => {
    if (selectedGroupDeniedApps.includes(appId)) {
      setSelectedGroupDeniedApps((previous) => previous.filter((id) => id !== appId))
    }
    setSelectedGroupAllowedApps((previous) =>
      previous.includes(appId)
        ? previous.filter((id) => id !== appId)
        : [...previous, appId],
    )
  }

  const toggleDeniedApp = (appId: number) => {
    if (selectedGroupAllowedApps.includes(appId)) {
      setSelectedGroupAllowedApps((previous) => previous.filter((id) => id !== appId))
    }
    setSelectedGroupDeniedApps((previous) =>
      previous.includes(appId)
        ? previous.filter((id) => id !== appId)
        : [...previous, appId],
    )
  }

  const filteredApps = useMemo(
    () =>
      apps.filter((app) =>
        !appSearch ? true : app.name.toLowerCase().includes(appSearch.toLowerCase()),
      ),
    [appSearch, apps],
  )

  const handleUpdateAppPermissions = async () => {
    if (!selectedGroup) return

    setPanelError(null)
    setSavingApps(true)
    try {
      await groupAppApi.updateAppPermissions(selectedGroup.id, {
        allowed_app_ids: selectedGroupAllowedApps,
        denied_app_ids: selectedGroupDeniedApps,
      })
      toast('应用权限已保存')
    } catch (err: any) {
      setPanelError(err.response?.data?.detail || '更新应用权限失败')
    } finally {
      setSavingApps(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedGroup) return

    const shouldDelete = await confirmDialog({
      title: '确认删除用户组',
      description: `确定要删除用户组 ${selectedGroup.name} 吗？`,
      confirmText: '删除用户组',
      cancelText: '取消',
      status: 'danger',
      confirmVariant: 'danger',
    })

    if (!shouldDelete) return

    setDeletingGroup(true)
    try {
      await groupApi.delete(selectedGroup.id)
      closePanel()
      await Promise.all([loadGroups(), loadUsers()])
      toast('用户组已删除')
    } catch (err: any) {
      setPanelError(err.response?.data?.detail || '删除用户组失败')
    } finally {
      setDeletingGroup(false)
    }
  }

  if (!canManageGroups) {
    return (
      <AdminNotice tone="danger" title="无权限" description="该页面仅管理员可访问。" />
    )
  }

  if (loading) {
    return <AdminLoadingState label="正在加载用户组..." />
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="用户组"
        description="管理用户组、默认组、成员归属，以及按组配置的应用访问权限。"
        actions={
          <Button variant="primary" onPress={() => setShowCreateModal(true)}>
            创建用户组
          </Button>
        }
      />

      {pageError ? <AdminNotice tone="danger" description={pageError} /> : null}

      <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <AdminSection>
          <Card.Header>
            <div>
              <Card.Title>用户组列表</Card.Title>
              <Card.Description>点击左侧用户组，在右侧查看详情与权限。</Card.Description>
            </div>
          </Card.Header>
          <Card.Content className="p-4 pt-0">
            {groups.length === 0 ? (
              <AdminEmptyState
                title="暂无用户组"
                description="创建一个用户组后，这里会显示成员和权限信息。"
              />
            ) : (
              <ListBox
                aria-label="用户组列表"
                selectionMode="single"
                selectedKeys={selectedGroup ? new Set([String(selectedGroup.id)]) : new Set()}
                onAction={(key) => {
                  const targetGroup = groups.find((item) => String(item.id) === String(key))
                  if (targetGroup) {
                    void openPanel(targetGroup)
                  }
                }}
              >
                {groups.map((group) => (
                  <ListBox.Item key={group.id} id={String(group.id)} textValue={group.name}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-foreground">{group.name}</span>
                          {group.is_default ? (
                            <Chip color="accent" variant="soft" size="sm">
                              默认
                            </Chip>
                          ) : null}
                        </div>
                        {group.description ? (
                          <p className="mt-1 text-sm text-default-500">{group.description}</p>
                        ) : null}
                      </div>
                      <span className="text-sm text-default-500">{group.member_count || 0} 人</span>
                    </div>
                  </ListBox.Item>
                ))}
              </ListBox>
            )}
          </Card.Content>
        </AdminSection>

        <AdminSection className="flex min-h-[320px] items-center justify-center border-dashed">
          {selectedGroup && panelOpen ? (
            <Card.Content className="w-full p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-foreground">{selectedGroup.name}</h3>
                    {selectedGroup.is_default ? (
                      <Chip color="accent" variant="soft" size="sm">默认</Chip>
                    ) : null}
                  </div>
                  {selectedGroup.description ? (
                    <p className="mt-1 text-sm text-default-500">{selectedGroup.description}</p>
                  ) : null}
                </div>
                <Button variant="secondary" size="sm" onPress={() => setPanelOpen(true)}>
                  编辑详情
                </Button>
              </div>
              <div className="mt-4 flex gap-4 text-sm text-default-600">
                <span>{selectedGroup.member_count || 0} 位成员</span>
                <span>创建于 {formatDate(selectedGroup.created_at)}</span>
              </div>
            </Card.Content>
          ) : (
            <Card.Content className="p-10 text-center">
              <p className="text-base font-medium text-foreground">选择一个用户组</p>
              <p className="mt-2 text-sm text-default-500">
                从左侧选择用户组，查看成员和权限详情。
              </p>
            </Card.Content>
          )}
        </AdminSection>
      </div>

      <SidePanel
        title={selectedGroup ? `用户组：${selectedGroup.name}` : '用户组详情'}
        open={panelOpen && !!selectedGroup}
        onClose={closePanel}
      >
        {!selectedGroup ? null : (
          <div className="space-y-6">
            {panelError ? <AdminNotice tone="danger" description={panelError} /> : null}

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-foreground">用户组信息</h3>
                <p className="text-xs text-default-500">修改名称、描述和默认组设置。</p>
              </div>
              <form onSubmit={handleUpdateMeta} className="space-y-4">
                <AdminFormField label="组名称" isRequired>
                  <Input
                    required
                    value={metaForm.name}
                    onChange={(event) =>
                      setMetaForm((previous) => ({
                        ...previous,
                        name: event.target.value,
                      }))
                    }
                  />
                </AdminFormField>

                <AdminFormField label="描述">
                  <Input
                    value={metaForm.description}
                    onChange={(event) =>
                      setMetaForm((previous) => ({
                        ...previous,
                        description: event.target.value,
                      }))
                    }
                  />
                </AdminFormField>

                <AdminFieldGroup label="默认组">
                  <UICheckbox
                    isSelected={metaForm.is_default}
                    onChange={(isSelected) =>
                      setMetaForm((previous) => ({
                        ...previous,
                        is_default: isSelected,
                      }))
                    }
                  >
                    新用户自动加入该用户组
                  </UICheckbox>
                </AdminFieldGroup>

                <div className="flex justify-end">
                  <Button
                    type="submit"
                    variant="primary"
                    isPending={savingMeta}
                    isDisabled={savingMeta}
                  >
                    保存信息
                  </Button>
                </div>
              </form>
            </div>

            <AdminSeparator />

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">成员</h3>
                  <p className="text-xs text-default-500">当前属于该用户组的用户。</p>
                </div>
                <Chip variant="soft" size="sm">
                  {members.length} 人
                </Chip>
              </div>
              {members.length === 0 ? (
                <AdminEmptyState title="暂无成员" description="从下方选择用户加入该组。" className="border-0 shadow-none" />
              ) : (
                <Table aria-label="用户组成员列表">
                  <Table.ScrollContainer>
                    <Table.Content>
                      <Table.Header>
                        <Table.Column>用户</Table.Column>
                        <Table.Column>邮箱</Table.Column>
                        <Table.Column>操作</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {members.map((member) => (
                          <Table.Row key={member.id} id={String(member.id)}>
                            <Table.Cell>
                              <div className="flex items-center gap-3">
                                <EntityAvatar
                                  src={member.avatar}
                                  name={member.username}
                                  size="sm"
                                  rounded="full"
                                />
                                <span className="font-medium text-foreground">
                                  {member.username}
                                </span>
                              </div>
                            </Table.Cell>
                            <Table.Cell>{member.email}</Table.Cell>
                            <Table.Cell>
                              <Button
                                variant="danger"
                                size="sm"
                                onPress={() => void handleRemoveMember(member.id)}
                              >
                                移除
                              </Button>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              )}
            </div>

            <AdminSeparator />

            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-foreground">添加成员</h3>
                <p className="text-xs text-default-500">搜索并批量添加用户到当前用户组。</p>
              </div>
              <AdminFormField label="搜索用户">
                <Input
                  value={searchMembers}
                  onChange={(event) => setSearchMembers(event.target.value)}
                  placeholder="用户名或邮箱"
                />
              </AdminFormField>

              <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-dashed border-default-200/70 p-3">
                {filteredAvailableUsers.length === 0 ? (
                  <p className="py-2 text-center text-sm text-default-500">没有可添加的用户</p>
                ) : (
                  filteredAvailableUsers.map((member) => (
                    <UICheckbox
                      key={member.id}
                      className="m-0 max-w-full rounded-xl border border-default-200/70 px-3 py-3"
                      isSelected={pendingAddIds.includes(member.id)}
                      onChange={() => togglePendingAdd(member.id)}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{member.username}</p>
                        <p className="mt-1 text-xs text-default-500">{member.email}</p>
                      </div>
                    </UICheckbox>
                  ))
                )}
              </div>

              <div className="flex justify-end">
                <Button
                  variant="primary"
                  isPending={savingMembers}
                  isDisabled={pendingAddIds.length === 0 || savingMembers}
                  onPress={() => void handleAddMembers()}
                >
                  添加到用户组
                </Button>
              </div>
            </div>

            <AdminSeparator />

            <div className="space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">应用权限</h3>
                  <p className="text-xs text-default-500">配置当前用户组对各应用的允许或拒绝策略。</p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  isPending={savingApps}
                  isDisabled={savingApps}
                  onPress={() => void handleUpdateAppPermissions()}
                >
                  保存权限
                </Button>
              </div>
              <AdminNotice
                tone="accent"
                description="优先级：用户拒绝 > 用户允许 > 用户组拒绝 > 用户组允许 > 应用默认"
              />

              <AdminFormField label="搜索应用">
                <Input
                  value={appSearch}
                  onChange={(event) => setAppSearch(event.target.value)}
                  placeholder="搜索应用名称"
                />
              </AdminFormField>

              {filteredApps.length === 0 ? (
                <p className="py-4 text-center text-sm text-default-500">暂无应用</p>
              ) : (
                <Table aria-label="用户组应用权限">
                  <Table.ScrollContainer>
                    <Table.Content>
                      <Table.Header>
                        <Table.Column>应用</Table.Column>
                        <Table.Column>允许</Table.Column>
                        <Table.Column>拒绝</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {filteredApps.map((app) => (
                          <Table.Row key={app.id} id={String(app.id)}>
                            <Table.Cell>
                              <div className="flex items-center gap-3">
                                <EntityAvatar src={app.logo} name={app.name} size="sm" />
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground">{app.name}</p>
                                  <p className="text-xs text-default-500">{app.client_id}</p>
                                </div>
                              </div>
                            </Table.Cell>
                            <Table.Cell>
                              <UICheckbox
                                isSelected={selectedGroupAllowedApps.includes(app.id)}
                                onChange={() => toggleAllowedApp(app.id)}
                              >
                                允许
                              </UICheckbox>
                            </Table.Cell>
                            <Table.Cell>
                              <UICheckbox
                                isSelected={selectedGroupDeniedApps.includes(app.id)}
                                onChange={() => toggleDeniedApp(app.id)}
                              >
                                拒绝
                              </UICheckbox>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              )}
            </div>

            <AdminSeparator />

            <div className="pt-2">
              <Button
                variant="danger"
                isPending={deletingGroup}
                isDisabled={deletingGroup}
                onPress={() => void handleDelete()}
              >
                删除用户组
              </Button>
            </div>
          </div>
        )}
      </SidePanel>

      <AdminModalForm
        title="创建用户组"
        description="新建用户组后，可以继续添加成员并配置应用访问权限。"
        isOpen={showCreateModal}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setShowCreateModal(false)
            setCreateForm({ name: '', description: '', is_default: false })
          } else {
            setShowCreateModal(true)
          }
        }}
        onSubmit={handleCreate}
        primaryActionLabel="创建用户组"
        isPending={creatingGroup}
      >
        <AdminFormField label="组名称" isRequired>
          <Input
            required
            value={createForm.name}
            onChange={(event) =>
              setCreateForm((previous) => ({ ...previous, name: event.target.value }))
            }
          />
        </AdminFormField>

        <AdminFormField label="描述">
          <Input
            value={createForm.description}
            onChange={(event) =>
              setCreateForm((previous) => ({
                ...previous,
                description: event.target.value,
              }))
            }
          />
        </AdminFormField>

        <AdminFieldGroup label="默认组">
          <UICheckbox
            isSelected={createForm.is_default}
            onChange={(isSelected) =>
              setCreateForm((previous) => ({ ...previous, is_default: isSelected }))
            }
          >
            新用户自动加入该组
          </UICheckbox>
        </AdminFieldGroup>
      </AdminModalForm>
    </div>
  )
}
