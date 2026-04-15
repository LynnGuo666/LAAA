'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Card,
  Chip,
  DropdownItem,
  DropdownMenu,
  DropdownPopover,
  DropdownRoot,
  DropdownTrigger,
  Input,
  ListBox,
  ListBoxItem,
  Pagination,
  Select,
  Table,
} from '@heroui/react'
import { MoreHorizontal } from 'lucide-react'
import {
  AdminEmptyState,
  AdminFormField,
  AdminLoadingState,
  AdminModalForm,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  EntityAvatar,
} from '@/components/admin/admin-ui'
import { UICheckbox } from '@/components/ui/primitives'
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider'
import { adminApi, groupApi } from '@/lib/api'
import { renderStatusChip, renderStatusSelect } from '@/lib/admin-utils'
import { isAdmin } from '@/lib/authz'
import { formatDate } from '@/lib/date'
import { useAuthStore } from '@/lib/store'

interface User {
  id: number
  username: string
  email: string
  avatar?: string
  status: string
  created_at: string
  updated_at: string
  groups: string[]
  roles: string[]
}

interface Group {
  id: number
  name: string
  description?: string
}

interface Role {
  id: number
  name: string
  description?: string
  level: number
}

export default function UsersPage() {
  const confirmDialog = useConfirmDialog()
  const router = useRouter()
  const user = useAuthStore((state) => state.user)
  const canManageUsers = isAdmin(user)

  const [users, setUsers] = useState<User[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)

  const [page, setPage] = useState(0)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const limit = 20

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showGroupsModal, setShowGroupsModal] = useState(false)
  const [showRolesModal, setShowRolesModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [selectedUserGroups, setSelectedUserGroups] = useState<number[]>([])
  const [selectedUserRoles, setSelectedUserRoles] = useState<number[]>([])

  const [creatingUser, setCreatingUser] = useState(false)
  const [updatingUser, setUpdatingUser] = useState(false)
  const [savingGroups, setSavingGroups] = useState(false)
  const [savingRoles, setSavingRoles] = useState(false)
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null)

  const [createError, setCreateError] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [groupsError, setGroupsError] = useState<string | null>(null)
  const [rolesError, setRolesError] = useState<string | null>(null)

  const [createForm, setCreateForm] = useState({
    username: '',
    email: '',
    password: '',
    status: 'active',
  })
  const [editForm, setEditForm] = useState({
    email: '',
    avatar: '',
    status: 'active',
    password: '',
  })

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true)
      setPageError(null)
      const response = await adminApi.listUsers({
        skip: page * limit,
        limit,
        search: search || undefined,
      })
      setUsers(response.data.items)
      setTotal(response.data.total)
    } catch (err: any) {
      setUsers([])
      setTotal(0)
      setPageError(err.response?.data?.detail || '加载用户列表失败')
    } finally {
      setLoading(false)
    }
  }, [page, search])

  const loadGroups = useCallback(async () => {
    try {
      const response = await groupApi.list()
      setGroups(response.data)
    } catch {
      setGroups([])
    }
  }, [])

  const loadRoles = useCallback(async () => {
    try {
      const response = await adminApi.listRoles()
      setRoles(response.data)
    } catch {
      setRoles([])
    }
  }, [])

  useEffect(() => {
    if (!canManageUsers) return
    void loadUsers()
  }, [canManageUsers, loadUsers])

  useEffect(() => {
    if (!canManageUsers) return
    void Promise.all([loadGroups(), loadRoles()])
  }, [canManageUsers, loadGroups, loadRoles])

  const resetCreateModal = () => {
    setShowCreateModal(false)
    setCreateError(null)
    setCreateForm({
      username: '',
      email: '',
      password: '',
      status: 'active',
    })
  }

  const resetEditModal = () => {
    setShowEditModal(false)
    setEditError(null)
    setSelectedUser(null)
  }

  const resetGroupsModal = () => {
    setShowGroupsModal(false)
    setGroupsError(null)
    setSelectedUser(null)
    setSelectedUserGroups([])
  }

  const resetRolesModal = () => {
    setShowRolesModal(false)
    setRolesError(null)
    setSelectedUser(null)
    setSelectedUserRoles([])
  }

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPage(0)
    setSearch(searchInput.trim())
  }

  const handleCreateUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCreateError(null)
    setCreatingUser(true)

    try {
      await adminApi.createUser(createForm)
      resetCreateModal()
      await loadUsers()
    } catch (err: any) {
      setCreateError(err.response?.data?.detail || '创建用户失败')
    } finally {
      setCreatingUser(false)
    }
  }

  const handleEditUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedUser) return

    setEditError(null)
    setUpdatingUser(true)

    try {
      const data: {
        email: string
        avatar?: string
        status: string
        password?: string
      } = {
        email: editForm.email,
        status: editForm.status,
      }

      if (editForm.avatar) {
        data.avatar = editForm.avatar
      }

      if (editForm.password) {
        data.password = editForm.password
      }

      await adminApi.updateUser(selectedUser.id, data)
      resetEditModal()
      await loadUsers()
    } catch (err: any) {
      setEditError(err.response?.data?.detail || '更新用户失败')
    } finally {
      setUpdatingUser(false)
    }
  }

  const handleDeleteUser = async (targetUser: User) => {
    const shouldDelete = await confirmDialog({
      title: '确认删除用户',
      description: `确定要删除用户 ${targetUser.username} 吗？此操作不可撤销。`,
      confirmText: '删除用户',
      cancelText: '取消',
      status: 'danger',
      confirmVariant: 'danger',
    })

    if (!shouldDelete) return

    try {
      setDeletingUserId(targetUser.id)
      await adminApi.deleteUser(targetUser.id)
      await loadUsers()
    } catch (err: any) {
      setPageError(err.response?.data?.detail || '删除用户失败')
    } finally {
      setDeletingUserId(null)
    }
  }

  const openEditModal = (targetUser: User) => {
    setSelectedUser(targetUser)
    setEditError(null)
    setEditForm({
      email: targetUser.email,
      avatar: targetUser.avatar || '',
      status: targetUser.status,
      password: '',
    })
    setShowEditModal(true)
  }

  const openGroupsModal = (targetUser: User) => {
    const groupIds = groups
      .filter((group) => targetUser.groups.includes(group.name))
      .map((group) => group.id)

    setSelectedUser(targetUser)
    setSelectedUserGroups(groupIds)
    setGroupsError(null)
    setShowGroupsModal(true)
  }

  const openRolesModal = (targetUser: User) => {
    const roleIds = roles
      .filter((role) => targetUser.roles.includes(role.name))
      .map((role) => role.id)

    setSelectedUser(targetUser)
    setSelectedUserRoles(roleIds)
    setRolesError(null)
    setShowRolesModal(true)
  }

  const handleUpdateGroups = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedUser) return

    setGroupsError(null)
    setSavingGroups(true)
    try {
      await adminApi.updateUserGroups(selectedUser.id, selectedUserGroups)
      resetGroupsModal()
      await loadUsers()
    } catch (err: any) {
      setGroupsError(err.response?.data?.detail || '更新用户组失败')
    } finally {
      setSavingGroups(false)
    }
  }

  const handleUpdateRoles = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedUser) return

    setRolesError(null)
    setSavingRoles(true)
    try {
      await adminApi.updateUserRoles(selectedUser.id, selectedUserRoles)
      resetRolesModal()
      await loadUsers()
    } catch (err: any) {
      setRolesError(err.response?.data?.detail || '更新用户角色失败')
    } finally {
      setSavingRoles(false)
    }
  }

  const toggleGroup = (groupId: number) => {
    setSelectedUserGroups((previous) =>
      previous.includes(groupId)
        ? previous.filter((id) => id !== groupId)
        : [...previous, groupId],
    )
  }

  const toggleRole = (roleId: number) => {
    setSelectedUserRoles((previous) =>
      previous.includes(roleId)
        ? previous.filter((id) => id !== roleId)
        : [...previous, roleId],
    )
  }

  const totalPages = Math.ceil(total / limit)

  if (!canManageUsers) {
    return (
      <AdminNotice tone="danger" title="无权限" description="该页面仅管理员可访问。" />
    )
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="用户管理"
        description="管理系统用户，处理资料、角色、用户组和应用访问权限。"
        actions={
          <Button variant="primary" onPress={() => setShowCreateModal(true)}>
            创建用户
          </Button>
        }
      />

      {pageError ? <AdminNotice tone="danger" description={pageError} /> : null}

      <AdminSection>
        <Card.Content className="space-y-4 p-6">
          <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full sm:max-w-sm">
              <AdminFormField label="搜索用户">
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="用户名 / 邮箱 / ID"
                />
              </AdminFormField>
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="primary">
                搜索
              </Button>
              <Button
                type="button"
                variant="secondary"
                onPress={() => {
                  setSearchInput('')
                  setSearch('')
                  setPage(0)
                }}
              >
                清除
              </Button>
            </div>
          </form>

          {loading ? (
            <AdminLoadingState label="正在加载用户列表..." className="border-0 p-0 shadow-none" />
          ) : users.length === 0 ? (
            <AdminEmptyState
              title={search ? '没有匹配的用户' : '暂无用户'}
              description={search ? '试试更换搜索关键词。' : '点击右上角创建第一位用户。'}
              action={
                !search ? (
                  <Button variant="primary" onPress={() => setShowCreateModal(true)}>
                    创建用户
                  </Button>
                ) : null
              }
            />
          ) : (
            <Table aria-label="用户列表">
              <Table.ScrollContainer>
                <Table.Content>
                  <Table.Header>
                    <Table.Column>用户</Table.Column>
                    <Table.Column>状态</Table.Column>
                    <Table.Column>用户组 / 角色</Table.Column>
                    <Table.Column>创建时间</Table.Column>
                    <Table.Column>操作</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {users.map((item) => (
                      <Table.Row key={item.id} id={String(item.id)}>
                        <Table.Cell>
                          <div className="flex items-start gap-3">
                            <EntityAvatar src={item.avatar} name={item.username} rounded="full" />
                            <div className="min-w-0">
                              <p className="font-medium text-foreground">{item.username}</p>
                              <p className="text-sm text-default-600">{item.email}</p>
                              <p className="text-xs text-default-500">ID: {item.id}</p>
                            </div>
                          </div>
                        </Table.Cell>
                        <Table.Cell>{renderStatusChip(item.status)}</Table.Cell>
                        <Table.Cell>
                          <div className="space-y-1 text-sm">
                            <p className="text-default-700">
                              用户组：{item.groups.length ? item.groups.join('、') : '无'}
                            </p>
                            <p className="text-default-500">
                              角色：{item.roles.length ? item.roles.join('、') : '无'}
                            </p>
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="space-y-1 text-sm text-default-600">
                            <p>{formatDate(item.created_at)}</p>
                            <p>更新：{formatDate(item.updated_at)}</p>
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onPress={() => router.push(`/admin/users/detail?id=${item.id}`)}
                            >
                              详情
                            </Button>
                            <DropdownRoot>
                              <DropdownTrigger>
                                <Button variant="secondary" size="sm" isIconOnly>
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownTrigger>
                              <DropdownPopover placement="bottom end">
                                <DropdownMenu
                                  onAction={(key) => {
                                    if (key === 'edit') openEditModal(item)
                                    else if (key === 'groups') openGroupsModal(item)
                                    else if (key === 'roles') openRolesModal(item)
                                    else if (key === 'permissions') router.push(`/admin/users/permissions?id=${item.id}`)
                                    else if (key === 'delete') void handleDeleteUser(item)
                                  }}
                                >
                                  <DropdownItem id="edit">编辑</DropdownItem>
                                  <DropdownItem id="groups">用户组</DropdownItem>
                                  <DropdownItem id="roles">角色</DropdownItem>
                                  <DropdownItem id="permissions">应用权限</DropdownItem>
                                  <DropdownItem id="delete" className="text-danger">删除</DropdownItem>
                                </DropdownMenu>
                              </DropdownPopover>
                            </DropdownRoot>
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          )}
        </Card.Content>

        {totalPages > 1 ? (
          <Card.Footer className="border-t border-default-200/70 px-6 py-4">
            <Pagination>
              <Pagination.Summary>
                第 {page + 1} / {totalPages} 页，共 {total} 位用户
              </Pagination.Summary>
              <Pagination.Content>
                <Pagination.Item>
                  <Pagination.Previous
                    isDisabled={page === 0}
                    onPress={() => setPage((current) => Math.max(0, current - 1))}
                  >
                    上一页
                  </Pagination.Previous>
                </Pagination.Item>
                {Array.from({ length: totalPages }, (_, index) => (
                  <Pagination.Item key={index}>
                    <Pagination.Link
                      isActive={page === index}
                      onPress={() => setPage(index)}
                    >
                      {index + 1}
                    </Pagination.Link>
                  </Pagination.Item>
                ))}
                <Pagination.Item>
                  <Pagination.Next
                    isDisabled={page >= totalPages - 1}
                    onPress={() =>
                      setPage((current) => Math.min(totalPages - 1, current + 1))
                    }
                  >
                    下一页
                  </Pagination.Next>
                </Pagination.Item>
              </Pagination.Content>
            </Pagination>
          </Card.Footer>
        ) : null}
      </AdminSection>

      <AdminModalForm
        title="创建新用户"
        description="创建后可继续配置角色、用户组和应用权限。"
        isOpen={showCreateModal}
        onOpenChange={(isOpen) => {
          if (!isOpen) resetCreateModal()
          else setShowCreateModal(true)
        }}
        onSubmit={handleCreateUser}
        primaryActionLabel="创建用户"
        isPending={creatingUser}
      >
        {createError ? <AdminNotice tone="danger" description={createError} /> : null}
        <AdminFormField label="用户名" isRequired>
          <Input
            type="text"
            minLength={3}
            value={createForm.username}
            onChange={(event) =>
              setCreateForm((previous) => ({
                ...previous,
                username: event.target.value,
              }))
            }
          />
        </AdminFormField>
        <AdminFormField label="邮箱" isRequired>
          <Input
            type="email"
            value={createForm.email}
            onChange={(event) =>
              setCreateForm((previous) => ({
                ...previous,
                email: event.target.value,
              }))
            }
          />
        </AdminFormField>
        <AdminFormField label="密码" isRequired>
          <Input
            type="password"
            minLength={6}
            value={createForm.password}
            onChange={(event) =>
              setCreateForm((previous) => ({
                ...previous,
                password: event.target.value,
              }))
            }
          />
        </AdminFormField>
        <AdminFormField label="状态">
          {renderStatusSelect(createForm.status, (value) =>
            setCreateForm((previous) => ({ ...previous, status: value })),
          )}
        </AdminFormField>
      </AdminModalForm>

      <AdminModalForm
        title={selectedUser ? `编辑用户：${selectedUser.username}` : '编辑用户'}
        isOpen={showEditModal}
        onOpenChange={(isOpen) => {
          if (!isOpen) resetEditModal()
          else setShowEditModal(true)
        }}
        onSubmit={handleEditUser}
        primaryActionLabel="保存"
        isPending={updatingUser}
      >
        {editError ? <AdminNotice tone="danger" description={editError} /> : null}
        <AdminFormField label="邮箱" isRequired>
          <Input
            type="email"
            value={editForm.email}
            onChange={(event) =>
              setEditForm((previous) => ({
                ...previous,
                email: event.target.value,
              }))
            }
          />
        </AdminFormField>
        <AdminFormField label="头像 URL">
          <Input
            type="url"
            value={editForm.avatar}
            placeholder="https://example.com/avatar.jpg"
            onChange={(event) =>
              setEditForm((previous) => ({
                ...previous,
                avatar: event.target.value,
              }))
            }
          />
        </AdminFormField>
        <AdminFormField label="状态">
          {renderStatusSelect(editForm.status, (value) =>
            setEditForm((previous) => ({ ...previous, status: value })),
          )}
        </AdminFormField>
        <AdminFormField label="新密码" description="留空表示不修改">
          <Input
            type="password"
            minLength={6}
            value={editForm.password}
            onChange={(event) =>
              setEditForm((previous) => ({
                ...previous,
                password: event.target.value,
              }))
            }
          />
        </AdminFormField>
      </AdminModalForm>

      <AdminModalForm
        title={selectedUser ? `管理用户组：${selectedUser.username}` : '管理用户组'}
        isOpen={showGroupsModal}
        onOpenChange={(isOpen) => {
          if (!isOpen) resetGroupsModal()
          else setShowGroupsModal(true)
        }}
        onSubmit={handleUpdateGroups}
        primaryActionLabel="保存用户组"
        isPending={savingGroups}
      >
        {groupsError ? <AdminNotice tone="danger" description={groupsError} /> : null}
        <AdminSection className="border-dashed">
          <Card.Content className="max-h-96 space-y-2 overflow-y-auto p-4">
            {groups.map((group) => (
              <UICheckbox
                key={group.id}
                className="m-0 max-w-full rounded-2xl border border-default-200/70 px-3 py-3"
                isSelected={selectedUserGroups.includes(group.id)}
                onChange={() => toggleGroup(group.id)}
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
        </AdminSection>
      </AdminModalForm>

      <AdminModalForm
        title={selectedUser ? `管理角色：${selectedUser.username}` : '管理角色'}
        isOpen={showRolesModal}
        onOpenChange={(isOpen) => {
          if (!isOpen) resetRolesModal()
          else setShowRolesModal(true)
        }}
        onSubmit={handleUpdateRoles}
        primaryActionLabel="保存角色"
        isPending={savingRoles}
      >
        {rolesError ? <AdminNotice tone="danger" description={rolesError} /> : null}
        <AdminSection className="border-dashed">
          <Card.Content className="max-h-96 space-y-2 overflow-y-auto p-4">
            {roles.map((role) => (
              <UICheckbox
                key={role.id}
                className="m-0 max-w-full rounded-2xl border border-default-200/70 px-3 py-3"
                isSelected={selectedUserRoles.includes(role.id)}
                onChange={() => toggleRole(role.id)}
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{role.name}</p>
                  {role.description ? (
                    <p className="mt-1 text-xs text-default-500">{role.description}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-default-400">等级：{role.level}</p>
                </div>
              </UICheckbox>
            ))}
          </Card.Content>
        </AdminSection>
      </AdminModalForm>
    </div>
  )
}
