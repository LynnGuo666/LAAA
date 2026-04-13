'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button, Input, ListBox, ListBoxItem, Select, Spinner } from '@heroui/react';
import { adminApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { isAdmin } from '@/lib/authz';

interface ComputedAppPermission {
  app_id: number;
  client_id: string;
  app_name: string;
  app_logo?: string;
  can_access: boolean;
  source: string;
  source_detail?: string;
  user_permission?: string;
}

interface PermissionsData {
  user_id: number;
  username: string;
  groups: string[];
  total: number;
  items: ComputedAppPermission[];
}

export default function UserPermissionsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const userId = Number(searchParams.get('id'));

  const user = useAuthStore((s) => s.user);
  const canManageUsers = isAdmin(user);

  const [data, setData] = useState<PermissionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [updating, setUpdating] = useState<number | null>(null);
  const limit = 20;

  const loadPermissions = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const response = await adminApi.getUserComputedAppPermissions(userId, {
        skip: page * limit,
        limit,
        search: search || undefined,
      });
      setData(response.data);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载权限信息失败');
    } finally {
      setLoading(false);
    }
  }, [userId, page, search]);

  useEffect(() => {
    if (!canManageUsers || !userId) return;
    loadPermissions();
  }, [canManageUsers, userId, loadPermissions]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput);
  };

  const handlePermissionChange = async (appId: number, permission: string | null) => {
    setUpdating(appId);
    try {
      await adminApi.updateUserSingleAppPermission(userId, appId, permission);
      await loadPermissions();
    } catch (err: any) {
      setError(err.response?.data?.detail || '更新权限失败');
    } finally {
      setUpdating(null);
    }
  };

  if (!canManageUsers) {
    return (
      <div className="surface p-6">
        <h1 className="text-xl font-semibold mb-2">无权限</h1>
        <p className="text-gray-600">该页面仅管理员可访问。</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="surface p-6">
        <h1 className="text-xl font-semibold mb-2">参数错误</h1>
        <p className="text-gray-600">缺少用户 ID 参数。</p>
        <Button onPress={() => router.push('/admin/users')} variant="primary" className="mt-4">
          返回用户列表
        </Button>
      </div>
    );
  }

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  const getSourceBadge = (item: ComputedAppPermission) => {
    const badges: Record<string, string> = {
      user_denied: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
      user_allowed: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
      group_denied: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
      group_allowed: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
      default: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
    };

    return (
      <span className={`px-2 py-1 text-xs rounded-full ${badges[item.source] || badges.default}`}>
        {item.source_detail}
      </span>
    );
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 animate-fade-in">
      {/* Header */}
      <div className="mb-6">
        <Button onPress={() => router.push('/admin/users')} className="mb-2 flex items-center gap-1 h-auto p-0 text-sm font-normal text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100" variant="tertiary" size="sm"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        返回用户列表
                </Button>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
          用户权限详情
          {data && <span className="text-gray-500 dark:text-gray-400 ml-2">- {data.username}</span>}
        </h1>
        {data && data.groups.length > 0 && (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            所属用户组: {data.groups.join(', ')}
          </p>
        )}
      </div>

      {/* Priority explanation */}
      <div className="surface p-4 mb-6">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">权限优先级（从高到低）</div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">用户拒绝</span>
          <span className="text-gray-400">&gt;</span>
          <span className="px-2 py-1 rounded bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200">用户允许</span>
          <span className="text-gray-400">&gt;</span>
          <span className="px-2 py-1 rounded bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200">用户组拒绝</span>
          <span className="text-gray-400">&gt;</span>
          <span className="px-2 py-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200">用户组允许</span>
          <span className="text-gray-400">&gt;</span>
          <span className="px-2 py-1 rounded bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200">应用默认</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md dark:bg-red-950 dark:border-red-900">
          <p className="text-sm text-red-600 dark:text-red-200">{error}</p>
        </div>
      )}

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-4 flex gap-2">
        <Input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="搜索应用名称..."
          className="flex-1 max-w-xs"
        />
        <Button type="submit" variant="secondary" >
          搜索
        </Button>
        {search && (
          <Button type="button" onPress={() => {
            setSearchInput('');
            setSearch('');
            setPage(0);
          }} variant="secondary" >
            清除
          </Button>
        )}
      </form>

      {/* Permissions table */}
      <div className="surface overflow-hidden">
        {loading ? (
          <div className="flex justify-center p-8">
            <Spinner size="md" />
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            {search ? '没有匹配的应用' : '暂无应用'}
          </div>
        ) : (
          <>
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    应用
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    最终结果
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    权限来源
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    用户级别设置
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {data.items.map((item) => (
                  <tr key={item.app_id} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        {item.app_logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.app_logo}
                            alt={item.app_name}
                            className="h-8 w-8 rounded border border-gray-200 dark:border-gray-700"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 text-xs">
                            {item.app_name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {item.app_name}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {item.client_id}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {item.can_access ? (
                        <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                          可访问
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                          </svg>
                          拒绝
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      {getSourceBadge(item)}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <Select
                          selectedKey={item.user_permission || ''}
                          onSelectionChange={(key) => {
                            const nextValue = key ? String(key) : null;
                            handlePermissionChange(item.app_id, nextValue);
                          }}
                          isDisabled={updating === item.app_id}
                          className="w-24 min-w-[6rem]"
                        >
                          <Select.Trigger>
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              <SelectItem id="">默认</SelectItem>
                              <SelectItem id="allowed">允许</SelectItem>
                              <SelectItem id="denied">拒绝</SelectItem>
                            </ListBox>
                          </Select.Popover>
                        </Select>
                        {updating === item.app_id && (
                          <Spinner size="sm" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  共 {data.total} 个应用，第 {page + 1} / {totalPages} 页
                </div>
                <div className="flex gap-2">
                  <Button onPress={() => setPage(p => Math.max(0, p - 1))} isDisabled={page === 0} variant="secondary" className="disabled:opacity-50">
                    上一页
                  </Button>
                  <Button onPress={() => setPage(p => Math.min(totalPages - 1, p + 1))} isDisabled={page >= totalPages - 1} variant="secondary" className="disabled:opacity-50">
                    下一页
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
