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
  Spinner,
  Table,
} from '@heroui/react'
import {
  AdminEmptyState,
  AdminFormField,
  AdminLoadingState,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
  EntityAvatar,
} from '@/components/admin/admin-ui'
import { AdminSimplePagination } from '@/components/admin/pagination'
import { adminApi } from '@/lib/api'
import { isAdmin } from '@/lib/authz'
import { useAuthStore } from '@/lib/store'

interface ComputedAppPermission {
  app_id: number
  client_id: string
  app_name: string
  app_logo?: string
  can_access: boolean
  source: string
  source_detail?: string
  user_permission?: string
}

interface PermissionsData {
  user_id: number
  username: string
  groups: string[]
  total: number
  items: ComputedAppPermission[]
}

export default function UserPermissionsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const userId = Number(searchParams.get('id'))

  const currentUser = useAuthStore((state) => state.user)
  const canManageUsers = isAdmin(currentUser)

  const [data, setData] = useState<PermissionsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(0)
  const [updating, setUpdating] = useState<number | null>(null)
  const limit = 20

  const loadPermissions = useCallback(async () => {
    if (!userId) return

    try {
      setLoading(true)
      setError(null)
      const response = await adminApi.getUserComputedAppPermissions(userId, {
        skip: page * limit,
        limit,
        search: search || undefined,
      })
      setData(response.data)
    } catch (err: any) {
      setData(null)
      setError(err.response?.data?.detail || '加载权限信息失败')
    } finally {
      setLoading(false)
    }
  }, [page, search, userId])

  useEffect(() => {
    if (!canManageUsers || !userId) return
    void loadPermissions()
  }, [canManageUsers, loadPermissions, userId])

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPage(0)
    setSearch(searchInput.trim())
  }

  const handlePermissionChange = async (appId: number, permission: string | null) => {
    setUpdating(appId)
    try {
      await adminApi.updateUserSingleAppPermission(
        userId,
        appId,
        permission === 'default' ? null : permission,
      )
      await loadPermissions()
    } catch (err: any) {
      setError(err.response?.data?.detail || '更新权限失败')
    } finally {
      setUpdating(null)
    }
  }

  const totalPages = data ? Math.ceil(data.total / limit) : 0

  const renderSourceChip = (item: ComputedAppPermission) => {
    const sourceLabelMap: Record<string, string> = {
      user_denied: item.source_detail || '用户拒绝',
      user_allowed: item.source_detail || '用户允许',
      group_denied: item.source_detail || '用户组拒绝',
      group_allowed: item.source_detail || '用户组允许',
      default: item.source_detail || '应用默认',
    }

    const sourceColorMap: Record<string, 'danger' | 'success' | 'warning' | 'accent' | 'default'> = {
      user_denied: 'danger',
      user_allowed: 'success',
      group_denied: 'warning',
      group_allowed: 'accent',
      default: 'default',
    }

    return (
      <Chip color={sourceColorMap[item.source] ?? 'default'} variant="soft" size="sm">
        {sourceLabelMap[item.source] ?? item.source}
      </Chip>
    )
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

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={data ? `应用权限：${data.username}` : '应用权限详情'}
        description={
          data && data.groups.length > 0
            ? `所属用户组：${data.groups.join('、')}`
            : '查看单个用户对每个应用的最终访问结果和权限来源。'
        }
        actions={
          <Button variant="secondary" onPress={() => router.push('/admin/users')}>
            返回用户列表
          </Button>
        }
      />

      <AdminNotice
        tone="accent"
        title="权限优先级"
        description="用户拒绝 > 用户允许 > 用户组拒绝 > 用户组允许 > 应用默认"
      />

      {error ? <AdminNotice tone="danger" description={error} /> : null}

      <AdminSection>
        <Card.Content className="space-y-4 p-6">
          <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full sm:max-w-sm">
              <AdminFormField label="搜索应用">
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="搜索应用名称"
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
            <AdminLoadingState label="正在加载权限详情..." variant="inline" className="p-0" />
          ) : !data || data.items.length === 0 ? (
            <AdminEmptyState
              title={search ? '没有匹配的应用' : '暂无应用权限数据'}
              description={search ? '试试更换搜索关键词。' : '当前用户还没有可展示的应用权限。'}
            />
          ) : (
            <Table aria-label="用户应用权限列表">
              <Table.ScrollContainer>
                <Table.Content>
                  <Table.Header>
                    <Table.Column isRowHeader>应用</Table.Column>
                    <Table.Column>最终结果</Table.Column>
                    <Table.Column>权限来源</Table.Column>
                    <Table.Column>用户级设置</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {data.items.map((item) => (
                      <Table.Row key={item.app_id} id={String(item.app_id)}>
                        <Table.Cell>
                          <div className="flex items-center gap-3">
                            <EntityAvatar src={item.app_logo} name={item.app_name} size="sm" />
                            <div className="min-w-0">
                              <p className="font-medium text-foreground">{item.app_name}</p>
                              <p className="text-xs text-default-500">{item.client_id}</p>
                            </div>
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <Chip
                            color={item.can_access ? 'success' : 'danger'}
                            variant="soft"
                            size="sm"
                          >
                            {item.can_access ? '可访问' : '拒绝'}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell>{renderSourceChip(item)}</Table.Cell>
                        <Table.Cell>
                          <div className="flex items-center gap-2">
                            <Select
                              placeholder="默认"
                              selectedKey={item.user_permission || undefined}
                              onSelectionChange={(key) => {
                                const nextValue = key ? String(key) : null
                                void handlePermissionChange(
                                  item.app_id,
                                  nextValue === null ? 'default' : nextValue,
                                )
                              }}
                              isDisabled={updating === item.app_id}
                              className="w-28"
                            >
                              <Select.Trigger>
                                <Select.Value />
                                <Select.Indicator />
                              </Select.Trigger>
                              <Select.Popover>
                                <ListBox>
                                  <ListBoxItem id="default">默认</ListBoxItem>
                                  <ListBoxItem id="allowed">允许</ListBoxItem>
                                  <ListBoxItem id="denied">拒绝</ListBoxItem>
                                </ListBox>
                              </Select.Popover>
                            </Select>
                            {updating === item.app_id ? <Spinner size="sm" /> : null}
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
            <AdminSimplePagination
              page={page}
              total={data?.total ?? 0}
              limit={limit}
              onPageChange={setPage}
              summary={(page, totalPages, total) =>
                `共 ${total} 个应用，第 ${page + 1} / ${totalPages} 页`
              }
            />
          </Card.Footer>
        ) : null}
      </AdminSection>
    </div>
  )
}
