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
  Tabs,
  toast,
} from '@heroui/react'
import {
  AdminFieldGroup,
  AdminFormField,
  AdminLoadingState,
  AdminModalForm,
  AdminNotice,
  AdminSection,
  EntityAvatar,
} from '@/components/admin/admin-ui'
import { UICheckbox } from '@/components/ui/primitives'
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider'
import { adminApi, clientApi, groupApi, groupAppApi } from '@/lib/api'
import { isAdmin } from '@/lib/authz'
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
  const [panelError, setPanelError] = useState<string | null>(null)

  const [searchMembers, setSearchMembers] = useState('')
  const [appSearch, setAppSearch] = useState('')
  const [pendingAddIds, setPendingAddIds] = useState<number[]>([])
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [savingMeta, setSavingMeta] = useState(false)
  const [savingMembers, setSavingMembers] = useState(false)
  const [savingApps, setSavingApps] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState(false)
  const [activeTab, setActiveTab] = useState('info')
  const [showAddMemberModal, setShowAddMemberModal] = useState(false)

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
      setSelectedGroup(null)
      setPanelError(null)
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">用户组</h1>
          <p className="mt-1 text-sm text-default-500">管理用户组、成员归属和应用访问权限。</p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            selectedKey={selectedGroup ? String(selectedGroup.id) : undefined}
            onSelectionChange={(key) => {
              if (key) {
                const targetGroup = groups.find((g) => String(g.id) === String(key))
                if (targetGroup) void openPanel(targetGroup)
              }
            }}
            className="w-56"
          >
            <Select.Trigger>
              <Select.Value placeholder="选择用户组" />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {groups.map((group) => (
                  <ListBoxItem key={group.id} id={String(group.id)} textValue={group.name}>
                    <div className="flex items-center gap-2">
                      <span>{group.name}</span>
                      {group.is_default ? <Chip color="accent" variant="soft" size="sm">默认</Chip> : null}
                    </div>
                  </ListBoxItem>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          <Button variant="primary" onPress={() => setShowCreateModal(true)}>创建用户组</Button>
        </div>
      </div>

      {pageError ? <AdminNotice tone="danger" description={pageError} /> : null}

      {selectedGroup ? (
        <div className="space-y-6">
          {panelError ? <AdminNotice tone="danger" description={panelError} /> : null}

          <Card>
            <Card.Content className="p-6">
              <Tabs selectedKey={activeTab} onSelectionChange={(key) => setActiveTab(String(key))} variant="primary">
                <Tabs.ListContainer>
                  <Tabs.List aria-label="用户组管理">
                    <Tabs.Tab id="info">基本信息<Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="members">成员 ({members.length})<Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="apps">应用权限<Tabs.Indicator /></Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>

                <div className="mt-6">
                  <Tabs.Panel id="info">
                    <form onSubmit={handleUpdateMeta} className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <AdminFormField label="组名称" isRequired>
                          <Input required value={metaForm.name} onChange={(e) => setMetaForm((p) => ({ ...p, name: e.target.value }))} />
                        </AdminFormField>
                        <AdminFormField label="描述">
                          <Input value={metaForm.description} onChange={(e) => setMetaForm((p) => ({ ...p, description: e.target.value }))} />
                        </AdminFormField>
                      </div>
                      <AdminFieldGroup label="默认组" className="mb-0">
                        <UICheckbox isSelected={metaForm.is_default} onChange={(isSelected) => setMetaForm((p) => ({ ...p, is_default: isSelected }))}>
                          新用户自动加入该用户组
                        </UICheckbox>
                      </AdminFieldGroup>
                      <div className="flex items-center justify-between border-t border-default-200/70 pt-4">
                        <Button variant="danger" size="sm" isPending={deletingGroup} isDisabled={deletingGroup} onPress={() => void handleDelete()}>删除用户组</Button>
                        <Button type="submit" variant="primary" isPending={savingMeta} isDisabled={savingMeta}>保存信息</Button>
                      </div>
                    </form>
                  </Tabs.Panel>

                  <Tabs.Panel id="members">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-default-500">共 {members.length} 位成员</span>
                        <Button variant="primary" size="sm" onPress={() => { setSearchMembers(''); setPendingAddIds([]); setShowAddMemberModal(true) }}>添加成员</Button>
                      </div>
                      {members.length === 0 ? (
                        <p className="py-6 text-center text-sm text-default-500">暂无成员，点击上方按钮添加</p>
                      ) : (
                        <Table aria-label="用户组成员列表">
                          <Table.ScrollContainer>
                            <Table.Content>
                              <Table.Header>
                                <Table.Column isRowHeader>用户</Table.Column>
                                <Table.Column>操作</Table.Column>
                              </Table.Header>
                              <Table.Body>
                                {members.map((member) => (
                                  <Table.Row key={member.id} id={String(member.id)}>
                                    <Table.Cell>
                                      <div className="flex items-center gap-3">
                                        <EntityAvatar src={member.avatar} name={member.username} size="sm" rounded="full" />
                                        <div>
                                          <p className="font-medium text-foreground">{member.username}</p>
                                          <p className="text-xs text-default-500">{member.email}</p>
                                        </div>
                                      </div>
                                    </Table.Cell>
                                    <Table.Cell>
                                      <Button variant="danger" size="sm" onPress={() => void handleRemoveMember(member.id)}>移除</Button>
                                    </Table.Cell>
                                  </Table.Row>
                                ))}
                              </Table.Body>
                            </Table.Content>
                          </Table.ScrollContainer>
                        </Table>
                      )}
                    </div>
                  </Tabs.Panel>

                  <Tabs.Panel id="apps">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Input value={appSearch} onChange={(e) => setAppSearch(e.target.value)} placeholder="搜索应用名称" size="sm" className="max-w-xs" />
                        <Button variant="primary" size="sm" isPending={savingApps} isDisabled={savingApps} onPress={() => void handleUpdateAppPermissions()}>保存权限</Button>
                      </div>
                      <p className="text-xs text-default-500">优先级：用户拒绝 {'>'} 用户允许 {'>'} 用户组拒绝 {'>'} 用户组允许 {'>'} 应用默认</p>
                      {filteredApps.length === 0 ? (
                        <p className="py-6 text-center text-sm text-default-500">暂无应用</p>
                      ) : (
                        <Table aria-label="用户组应用权限">
                          <Table.ScrollContainer>
                            <Table.Content>
                              <Table.Header>
                                <Table.Column isRowHeader>应用</Table.Column>
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
                                      <UICheckbox isSelected={selectedGroupAllowedApps.includes(app.id)} onChange={() => toggleAllowedApp(app.id)}>允许</UICheckbox>
                                    </Table.Cell>
                                    <Table.Cell>
                                      <UICheckbox isSelected={selectedGroupDeniedApps.includes(app.id)} onChange={() => toggleDeniedApp(app.id)}>拒绝</UICheckbox>
                                    </Table.Cell>
                                  </Table.Row>
                                ))}
                              </Table.Body>
                            </Table.Content>
                          </Table.ScrollContainer>
                        </Table>
                      )}
                    </div>
                  </Tabs.Panel>
                </div>
              </Tabs>
            </Card.Content>
          </Card>
        </div>
      ) : (
        <AdminSection className="flex items-center justify-center border-dashed">
          <Card.Content className="p-10 text-center">
            <p className="text-base font-medium text-foreground">请选择用户组</p>
            <p className="mt-2 text-sm text-default-500">从上方下拉选择用户组，查看和编辑详情。</p>
          </Card.Content>
        </AdminSection>
      )}

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

      <AdminModalForm
        title="添加成员"
        description={selectedGroup ? `向「${selectedGroup.name}」添加成员` : '添加成员'}
        isOpen={showAddMemberModal}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setShowAddMemberModal(false)
            setPendingAddIds([])
            setSearchMembers('')
          } else {
            setShowAddMemberModal(true)
          }
        }}
        onSubmit={async (e) => {
          e.preventDefault()
          await handleAddMembers()
          if (pendingAddIds.length > 0) setShowAddMemberModal(false)
        }}
        primaryActionLabel={`添加选中用户 (${pendingAddIds.length})`}
        isPending={savingMembers}
        isDisabled={pendingAddIds.length === 0}
        size="lg"
      >
        <Input value={searchMembers} onChange={(e) => setSearchMembers(e.target.value)} placeholder="搜索用户名或邮箱" />
        <div className="max-h-80 space-y-1 overflow-y-auto rounded-xl border border-default-200/70 p-3">
          {filteredAvailableUsers.length === 0 ? (
            <p className="py-6 text-center text-sm text-default-500">没有可添加的用户</p>
          ) : (
            filteredAvailableUsers.map((member) => (
              <UICheckbox
                key={member.id}
                className="m-0 max-w-full border-b border-default-200/70 py-2 last:border-b-0"
                isSelected={pendingAddIds.includes(member.id)}
                onChange={() => togglePendingAdd(member.id)}
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{member.username}</p>
                  <p className="text-xs text-default-500">{member.email}</p>
                </div>
              </UICheckbox>
            ))
          )}
        </div>
      </AdminModalForm>
    </div>
  )
}
