'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { isAdmin } from '@/lib/authz'
import { formatDateTime } from '@/lib/date'
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

interface LoginLog {
  id: number
  username: string
  success: boolean
  failure_reason?: string
  ip_address?: string
  device_type?: string
  country?: string
  city?: string
  login_method?: string
  is_suspicious: boolean
  created_at: string
}

interface Session {
  id: number
  device_id: string
  device_name?: string
  device_type?: string
  ip_address?: string
  country?: string
  city?: string
  last_active: string
  expires_at: string
  created_at: string
  is_trusted: boolean
}

interface Passkey {
  id: number
  name: string
  credential_id: string
  created_at: string
  last_used_at?: string
  backup_eligible: boolean
  aaguid?: string
}

interface Authorization {
  id: number
  client_id: string
  client_name: string
  client_logo?: string
  scope: string
  created_at: string
  updated_at: string
}

interface SecurityMethods {
  totp_enabled: boolean
  totp_created_at?: string
  passkey_count: number
  email_verified: boolean
  email_verified_at?: string
}

type Tab = 'info' | 'logs' | 'sessions' | 'passkeys' | 'authorizations'

const USER_STATUS_OPTIONS = [
  { id: 'active', label: '激活' },
  { id: 'inactive', label: '未激活' },
  { id: 'suspended', label: '暂停' },
]

export default function UserDetailPage() {
  const confirmDialog = useConfirmDialog()
  const searchParams = useSearchParams()
  const router = useRouter()
  const userId = Number(searchParams.get('id'))
  const currentUser = useAuthStore((state) => state.user)
  const canManageUsers = isAdmin(currentUser)

  const [user, setUser] = useState<User | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('info')
  const [tabLoading, setTabLoading] = useState(false)

  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([])
  const [logsTotal, setLogsTotal] = useState(0)
  const [logsPage, setLogsPage] = useState(0)
  const [sessions, setSessions] = useState<Session[]>([])
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [authorizations, setAuthorizations] = useState<Authorization[]>([])
  const [securityMethods, setSecurityMethods] = useState<SecurityMethods | null>(null)

  const [editForm, setEditForm] = useState({
    email: '',
    avatar: '',
    status: 'active',
    password: '',
  })
  const [selectedGroups, setSelectedGroups] = useState<number[]>([])
  const [selectedRoles, setSelectedRoles] = useState<number[]>([])
  const [showEditModal, setShowEditModal] = useState(false)
  const [showGroupsModal, setShowGroupsModal] = useState(false)
  const [showRolesModal, setShowRolesModal] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [savingGroups, setSavingGroups] = useState(false)
  const [savingRoles, setSavingRoles] = useState(false)

  const loadUser = useCallback(async () => {
    if (!userId) return

    try {
      setLoading(true)
      setError(null)
      const response = await adminApi.getUser(userId)
      setUser(response.data)
      setEditForm({
        email: response.data.email,
        avatar: response.data.avatar || '',
        status: response.data.status,
        password: '',
      })
    } catch (err: any) {
      setUser(null)
      setError(err.response?.data?.detail || '加载用户失败')
    } finally {
      setLoading(false)
    }
  }, [userId])

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

  const loadLoginLogs = useCallback(async () => {
    if (!userId) return
    setTabLoading(true)
    try {
      const response = await adminApi.getUserLoginLogs(userId, {
        skip: logsPage * 20,
        limit: 20,
      })
      setLoginLogs(response.data.items)
      setLogsTotal(response.data.total)
    } finally {
      setTabLoading(false)
    }
  }, [logsPage, userId])

  const loadSessions = useCallback(async () => {
    if (!userId) return
    setTabLoading(true)
    try {
      const response = await adminApi.getUserSessions(userId)
      setSessions(response.data)
    } finally {
      setTabLoading(false)
    }
  }, [userId])

  const loadPasskeys = useCallback(async () => {
    if (!userId) return
    setTabLoading(true)
    try {
      const response = await adminApi.getUserPasskeys(userId)
      setPasskeys(response.data)
    } finally {
      setTabLoading(false)
    }
  }, [userId])

  const loadAuthorizations = useCallback(async () => {
    if (!userId) return
    setTabLoading(true)
    try {
      const response = await adminApi.getUserAuthorizations(userId)
      setAuthorizations(response.data)
    } finally {
      setTabLoading(false)
    }
  }, [userId])

  const loadSecurityMethods = useCallback(async () => {
    if (!userId) return
    try {
      const response = await adminApi.getUserSecurityMethods(userId)
      setSecurityMethods(response.data)
    } catch {
      setSecurityMethods(null)
    }
  }, [userId])

  useEffect(() => {
    if (!canManageUsers || !userId) return
    void Promise.all([loadUser(), loadGroups(), loadRoles(), loadSecurityMethods()])
  }, [canManageUsers, userId, loadGroups, loadRoles, loadSecurityMethods, loadUser])

  useEffect(() => {
    if (!canManageUsers || !user) return
    if (activeTab === 'logs') {
      void loadLoginLogs()
    } else if (activeTab === 'sessions') {
      void loadSessions()
    } else if (activeTab === 'passkeys') {
      void loadPasskeys()
    } else if (activeTab === 'authorizations') {
      void loadAuthorizations()
    }
  }, [
    activeTab,
    canManageUsers,
    loadAuthorizations,
    loadLoginLogs,
    loadPasskeys,
    loadSessions,
    user,
  ])

  const renderStatusChip = (status: string) => {
    const colorMap: Record<string, 'success' | 'default' | 'danger'> = {
      active: 'success',
      inactive: 'default',
      suspended: 'danger',
    }
    const labelMap: Record<string, string> = {
      active: '激活',
      inactive: '未激活',
      suspended: '暂停',
    }

    return (
      <Chip color={colorMap[status] ?? 'default'} variant="soft" size="sm">
        {labelMap[status] ?? status}
      </Chip>
    )
  }

  const renderStatusSelect = (value: string, onChange: (nextValue: string) => void) => (
    <Select
      selectedKey={value}
      onSelectionChange={(key) => onChange(String(key ?? 'active'))}
    >
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {USER_STATUS_OPTIONS.map((option) => (
            <ListBoxItem key={option.id} id={option.id}>
              {option.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  )

  const resetModalState = () => {
    setModalError(null)
    setSelectedGroups([])
    setSelectedRoles([])
  }

  const handleEditUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setModalError(null)
    setSavingEdit(true)

    try {
      const data: {
        email: string
        status: string
        avatar?: string
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

      await adminApi.updateUser(userId, data)
      setShowEditModal(false)
      resetModalState()
      await loadUser()
      toast('用户信息已更新')
    } catch (err: any) {
      setModalError(err.response?.data?.detail || '更新失败')
    } finally {
      setSavingEdit(false)
    }
  }

  const openGroupsModal = () => {
    if (!user) return
    const groupIds = groups
      .filter((group) => user.groups.includes(group.name))
      .map((group) => group.id)
    setSelectedGroups(groupIds)
    setModalError(null)
    setShowGroupsModal(true)
  }

  const handleUpdateGroups = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setModalError(null)
    setSavingGroups(true)

    try {
      await adminApi.updateUserGroups(userId, selectedGroups)
      setShowGroupsModal(false)
      resetModalState()
      await loadUser()
      toast('用户组已更新')
    } catch (err: any) {
      setModalError(err.response?.data?.detail || '更新用户组失败')
    } finally {
      setSavingGroups(false)
    }
  }

  const openRolesModal = () => {
    if (!user) return
    const roleIds = roles
      .filter((role) => user.roles.includes(role.name))
      .map((role) => role.id)
    setSelectedRoles(roleIds)
    setModalError(null)
    setShowRolesModal(true)
  }

  const handleUpdateRoles = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setModalError(null)
    setSavingRoles(true)

    try {
      await adminApi.updateUserRoles(userId, selectedRoles)
      setShowRolesModal(false)
      resetModalState()
      await loadUser()
      toast('角色已更新')
    } catch (err: any) {
      setModalError(err.response?.data?.detail || '更新角色失败')
    } finally {
      setSavingRoles(false)
    }
  }

  const handleRevokeSession = async (sessionId: number) => {
    const shouldRevoke = await confirmDialog({
      title: '确认强制登出',
      description: '确定要强制登出此会话吗？',
      confirmText: '确认登出',
      cancelText: '取消',
      status: 'warning',
      confirmVariant: 'danger',
    })
    if (!shouldRevoke) return

    try {
      await adminApi.revokeUserSession(userId, sessionId)
      await loadSessions()
      toast('会话已登出')
    } catch (err: any) {
      setError(err.response?.data?.detail || '操作失败')
    }
  }

  const handleRevokeAllSessions = async () => {
    const shouldRevokeAll = await confirmDialog({
      title: '确认登出所有会话',
      description: '确定要登出该用户的所有会话吗？',
      confirmText: '全部登出',
      cancelText: '取消',
      status: 'danger',
      confirmVariant: 'danger',
    })
    if (!shouldRevokeAll) return

    try {
      const response = await adminApi.revokeAllUserSessions(userId)
      toast(response.data.message)
      await loadSessions()
    } catch (err: any) {
      setError(err.response?.data?.detail || '操作失败')
    }
  }

  if (!canManageUsers) {
    return (
      <AdminNotice tone="danger" title="无权限" description="该页面仅管理员可访问。" />
    )
  }

  if (!userId) {
    return (
      <AdminNotice tone="danger" title="参数错误" description="缺少用户 ID 参数。" />
    )
  }

  if (loading) {
    return <AdminLoadingState label="正在加载用户详情..." />
  }

  if (error || !user) {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="用户详情"
          actions={
            <Button variant="secondary" onPress={() => router.push('/admin/users')}>
              返回用户列表
            </Button>
          }
        />
        <AdminNotice tone="danger" description={error || '用户不存在'} />
      </div>
    )
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'info', label: '基本信息' },
    { key: 'logs', label: '登录日志' },
    { key: 'sessions', label: '活跃会话' },
    { key: 'passkeys', label: '通行密钥' },
    { key: 'authorizations', label: '应用授权' },
  ]

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={user.username}
        description={`ID: ${user.id} · 创建于 ${formatDateTime(user.created_at)}`}
        actions={
          <>
            <Button variant="secondary" onPress={() => router.push('/admin/users')}>
              返回用户列表
            </Button>
            <Button
              variant="secondary"
              onPress={() => router.push(`/admin/users/permissions?id=${userId}`)}
            >
              应用权限
            </Button>
          </>
        }
      />

      {error ? <AdminNotice tone="danger" description={error} /> : null}

      <AdminSection>
        <Card.Content className="space-y-6 p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-4">
              <EntityAvatar src={user.avatar} name={user.username} size="lg" rounded="full" />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-foreground">{user.username}</h2>
                  {renderStatusChip(user.status)}
                </div>
                <p className="text-default-600">{user.email}</p>
                <p className="text-sm text-default-500">
                  更新时间：{formatDateTime(user.updated_at)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onPress={() => setShowEditModal(true)}>
                编辑信息
              </Button>
              <Button variant="secondary" onPress={openGroupsModal}>
                管理用户组
              </Button>
              <Button variant="secondary" onPress={openRolesModal}>
                管理角色
              </Button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="border border-default-200/70 bg-white shadow-none dark:bg-gray-900">
              <Card.Header>
                <Card.Title>用户组</Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-wrap gap-2 px-6 pb-6">
                {user.groups.length === 0 ? (
                  <p className="text-sm text-default-500">无</p>
                ) : (
                  user.groups.map((group) => (
                    <Chip key={group} variant="soft" size="sm">
                      {group}
                    </Chip>
                  ))
                )}
              </Card.Content>
            </Card>

            <Card className="border border-default-200/70 bg-white shadow-none dark:bg-gray-900">
              <Card.Header>
                <Card.Title>角色</Card.Title>
              </Card.Header>
              <Card.Content className="flex flex-wrap gap-2 px-6 pb-6">
                {user.roles.length === 0 ? (
                  <p className="text-sm text-default-500">无</p>
                ) : (
                  user.roles.map((role) => (
                    <Chip key={role} variant="soft" size="sm" color="accent">
                      {role}
                    </Chip>
                  ))
                )}
              </Card.Content>
            </Card>

            <Card className="border border-default-200/70 bg-white shadow-none dark:bg-gray-900">
              <Card.Header>
                <Card.Title>安全验证方式</Card.Title>
              </Card.Header>
              <Card.Content className="space-y-3 px-6 pb-6 text-sm">
                <div className="flex items-center justify-between">
                  <span>邮箱验证</span>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={securityMethods?.email_verified ? 'success' : 'default'}
                  >
                    {securityMethods?.email_verified ? '已验证' : '未验证'}
                  </Chip>
                </div>
                <div className="flex items-center justify-between">
                  <span>身份验证器</span>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={securityMethods?.totp_enabled ? 'success' : 'default'}
                  >
                    {securityMethods?.totp_enabled ? '已启用' : '未启用'}
                  </Chip>
                </div>
                <div className="flex items-center justify-between">
                  <span>通行密钥</span>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={securityMethods?.passkey_count ? 'accent' : 'default'}
                  >
                    {securityMethods?.passkey_count || 0} 个
                  </Chip>
                </div>
              </Card.Content>
            </Card>
          </div>
        </Card.Content>
      </AdminSection>

      <AdminSection>
        <Card.Content className="p-6">
          <Tabs
            aria-label="用户详情标签"
            selectedKey={activeTab}
            onSelectionChange={(key) => setActiveTab(String(key) as Tab)}
            variant="primary"
          >
            <Tabs.List>
              {tabs.map((tab) => (
                <Tabs.Tab key={tab.key} id={tab.key}>
                  {tab.label}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>

          <div className="mt-6">
            {activeTab === 'info' ? (
              <AdminNotice
                tone="accent"
                description="从上方按钮可以继续修改用户资料、用户组和角色。"
              />
            ) : null}

            {tabLoading ? (
              <AdminLoadingState label="正在加载标签页数据..." className="mt-4 border-0 p-0 shadow-none" />
            ) : null}

            {!tabLoading && activeTab === 'logs' ? (
              loginLogs.length === 0 ? (
                <AdminEmptyState title="暂无登录记录" description="该用户还没有可展示的登录历史。" />
              ) : (
                <Table aria-label="登录日志列表">
                  <Table.ScrollContainer>
                    <Table.Content>
                      <Table.Header>
                        <Table.Column>结果</Table.Column>
                        <Table.Column>来源</Table.Column>
                        <Table.Column>时间</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {loginLogs.map((log) => (
                          <Table.Row key={log.id} id={String(log.id)}>
                            <Table.Cell>
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Chip
                                    size="sm"
                                    variant="soft"
                                    color={log.success ? 'success' : 'danger'}
                                  >
                                    {log.success ? '成功' : '失败'}
                                  </Chip>
                                  {log.is_suspicious ? (
                                    <Chip size="sm" variant="soft" color="warning">
                                      可疑
                                    </Chip>
                                  ) : null}
                                  {log.login_method ? (
                                    <Chip size="sm" variant="soft">
                                      {log.login_method}
                                    </Chip>
                                  ) : null}
                                </div>
                                {!log.success && log.failure_reason ? (
                                  <p className="text-xs text-danger">原因：{log.failure_reason}</p>
                                ) : null}
                              </div>
                            </Table.Cell>
                            <Table.Cell>
                              <div className="space-y-1 text-sm text-default-600">
                                {log.ip_address ? <p>{log.ip_address}</p> : null}
                                <p>{[log.city, log.country].filter(Boolean).join(' / ') || '未知地区'}</p>
                                <p>{log.device_type || '未知设备'}</p>
                              </div>
                            </Table.Cell>
                            <Table.Cell>{formatDateTime(log.created_at)}</Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                  {logsTotal > 20 ? (
                    <Table.Footer>
                      <div className="flex w-full items-center justify-between gap-4 px-6 py-4 text-sm text-default-500">
                        <span>
                          第 {logsPage + 1} / {Math.ceil(logsTotal / 20)} 页
                        </span>
                        <div className="flex gap-2">
                          <Button
                            variant="secondary"
                            isDisabled={logsPage === 0}
                            onPress={() => setLogsPage((value) => Math.max(0, value - 1))}
                          >
                            上一页
                          </Button>
                          <Button
                            variant="secondary"
                            isDisabled={(logsPage + 1) * 20 >= logsTotal}
                            onPress={() => setLogsPage((value) => value + 1)}
                          >
                            下一页
                          </Button>
                        </div>
                      </div>
                    </Table.Footer>
                  ) : null}
                </Table>
              )
            ) : null}

            {!tabLoading && activeTab === 'sessions' ? (
              sessions.length === 0 ? (
                <AdminEmptyState title="暂无活跃会话" description="该用户当前没有已登录设备。" />
              ) : (
                <div className="space-y-4">
                  <div className="flex justify-end">
                    <Button variant="danger" onPress={() => void handleRevokeAllSessions()}>
                      登出全部
                    </Button>
                  </div>
                  <Table aria-label="活跃会话列表">
                    <Table.ScrollContainer>
                      <Table.Content>
                        <Table.Header>
                          <Table.Column>设备</Table.Column>
                          <Table.Column>活跃信息</Table.Column>
                          <Table.Column>操作</Table.Column>
                        </Table.Header>
                        <Table.Body>
                          {sessions.map((session) => (
                            <Table.Row key={session.id} id={String(session.id)}>
                              <Table.Cell>
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-foreground">
                                      {session.device_name || '未知设备'}
                                    </span>
                                    {session.is_trusted ? (
                                      <Chip size="sm" variant="soft" color="accent">
                                        可信
                                      </Chip>
                                    ) : null}
                                  </div>
                                  <p className="text-sm text-default-500">
                                    {session.device_type || '未知类型'} · {session.ip_address || '未知 IP'}
                                  </p>
                                </div>
                              </Table.Cell>
                              <Table.Cell>
                                <div className="space-y-1 text-sm text-default-600">
                                  <p>最后活跃：{formatDateTime(session.last_active)}</p>
                                  <p>过期时间：{formatDateTime(session.expires_at)}</p>
                                  <p>{[session.city, session.country].filter(Boolean).join(' / ') || '未知地区'}</p>
                                </div>
                              </Table.Cell>
                              <Table.Cell>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onPress={() => void handleRevokeSession(session.id)}
                                >
                                  登出
                                </Button>
                              </Table.Cell>
                            </Table.Row>
                          ))}
                        </Table.Body>
                      </Table.Content>
                    </Table.ScrollContainer>
                  </Table>
                </div>
              )
            ) : null}

            {!tabLoading && activeTab === 'passkeys' ? (
              passkeys.length === 0 ? (
                <AdminEmptyState title="暂无通行密钥" description="该用户尚未绑定任何通行密钥。" />
              ) : (
                <Table aria-label="通行密钥列表">
                  <Table.ScrollContainer>
                    <Table.Content>
                      <Table.Header>
                        <Table.Column>名称</Table.Column>
                        <Table.Column>创建与使用</Table.Column>
                        <Table.Column>状态</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {passkeys.map((passkey) => (
                          <Table.Row key={passkey.id} id={String(passkey.id)}>
                            <Table.Cell>
                              <div className="space-y-1">
                                <p className="font-medium text-foreground">{passkey.name}</p>
                                <p className="text-xs text-default-500">{passkey.credential_id}</p>
                              </div>
                            </Table.Cell>
                            <Table.Cell>
                              <div className="space-y-1 text-sm text-default-600">
                                <p>创建：{formatDateTime(passkey.created_at)}</p>
                                <p>
                                  最后使用：
                                  {passkey.last_used_at ? formatDateTime(passkey.last_used_at) : '从未'}
                                </p>
                              </div>
                            </Table.Cell>
                            <Table.Cell>
                              <Chip
                                size="sm"
                                variant="soft"
                                color={passkey.backup_eligible ? 'accent' : 'default'}
                              >
                                {passkey.backup_eligible ? '可同步' : '本地设备'}
                              </Chip>
                            </Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              )
            ) : null}

            {!tabLoading && activeTab === 'authorizations' ? (
              authorizations.length === 0 ? (
                <AdminEmptyState title="暂无应用授权" description="该用户还没有授权任何应用。" />
              ) : (
                <Table aria-label="应用授权列表">
                  <Table.ScrollContainer>
                    <Table.Content>
                      <Table.Header>
                        <Table.Column>应用</Table.Column>
                        <Table.Column>权限范围</Table.Column>
                        <Table.Column>授权时间</Table.Column>
                      </Table.Header>
                      <Table.Body>
                        {authorizations.map((authorization) => (
                          <Table.Row key={authorization.id} id={String(authorization.id)}>
                            <Table.Cell>
                              <div className="flex items-center gap-3">
                                <EntityAvatar
                                  src={authorization.client_logo}
                                  name={authorization.client_name}
                                  size="sm"
                                />
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground">
                                    {authorization.client_name}
                                  </p>
                                  <p className="text-xs text-default-500">{authorization.client_id}</p>
                                </div>
                              </div>
                            </Table.Cell>
                            <Table.Cell>{authorization.scope}</Table.Cell>
                            <Table.Cell>{formatDateTime(authorization.created_at)}</Table.Cell>
                          </Table.Row>
                        ))}
                      </Table.Body>
                    </Table.Content>
                  </Table.ScrollContainer>
                </Table>
              )
            ) : null}
          </div>
        </Card.Content>
      </AdminSection>

      <AdminModalForm
        title="编辑用户"
        isOpen={showEditModal}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setShowEditModal(false)
            setModalError(null)
          } else {
            setShowEditModal(true)
          }
        }}
        onSubmit={handleEditUser}
        primaryActionLabel="保存"
        isPending={savingEdit}
      >
        {modalError ? <AdminNotice tone="danger" description={modalError} /> : null}
        <AdminFormField label="邮箱" isRequired>
          <Input
            type="email"
            value={editForm.email}
            onChange={(event) =>
              setEditForm((previous) => ({ ...previous, email: event.target.value }))
            }
          />
        </AdminFormField>
        <AdminFormField label="头像 URL">
          <Input
            type="url"
            value={editForm.avatar}
            onChange={(event) =>
              setEditForm((previous) => ({ ...previous, avatar: event.target.value }))
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
              setEditForm((previous) => ({ ...previous, password: event.target.value }))
            }
          />
        </AdminFormField>
      </AdminModalForm>

      <AdminModalForm
        title="管理用户组"
        isOpen={showGroupsModal}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setShowGroupsModal(false)
            resetModalState()
          } else {
            setShowGroupsModal(true)
          }
        }}
        onSubmit={handleUpdateGroups}
        primaryActionLabel="保存用户组"
        isPending={savingGroups}
      >
        {modalError ? <AdminNotice tone="danger" description={modalError} /> : null}
        <AdminSection className="border-dashed">
          <Card.Content className="max-h-96 space-y-2 overflow-y-auto p-4">
            {groups.map((group) => (
              <UICheckbox
                key={group.id}
                className="m-0 max-w-full rounded-2xl border border-default-200/70 px-3 py-3"
                isSelected={selectedGroups.includes(group.id)}
                onChange={() =>
                  setSelectedGroups((previous) =>
                    previous.includes(group.id)
                      ? previous.filter((id) => id !== group.id)
                      : [...previous, group.id],
                  )
                }
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
        title="管理角色"
        isOpen={showRolesModal}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setShowRolesModal(false)
            resetModalState()
          } else {
            setShowRolesModal(true)
          }
        }}
        onSubmit={handleUpdateRoles}
        primaryActionLabel="保存角色"
        isPending={savingRoles}
      >
        {modalError ? <AdminNotice tone="danger" description={modalError} /> : null}
        <AdminSection className="border-dashed">
          <Card.Content className="max-h-96 space-y-2 overflow-y-auto p-4">
            {roles.map((role) => (
              <UICheckbox
                key={role.id}
                className="m-0 max-w-full rounded-2xl border border-default-200/70 px-3 py-3"
                isSelected={selectedRoles.includes(role.id)}
                onChange={() =>
                  setSelectedRoles((previous) =>
                    previous.includes(role.id)
                      ? previous.filter((id) => id !== role.id)
                      : [...previous, role.id],
                  )
                }
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
