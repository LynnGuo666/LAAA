'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AlertDialog, Button, Input, ListBox, ListBoxItem, Select, Spinner } from '@heroui/react';
import { adminApi, groupApi } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { useAuthStore } from '@/lib/store';
import { isAdmin } from '@/lib/authz';
import { UICheckbox } from '@/components/ui/primitives';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';

interface User {
  id: number;
  username: string;
  email: string;
  avatar?: string;
  status: string;
  created_at: string;
  updated_at: string;
  groups: string[];
  roles: string[];
}

interface Group {
  id: number;
  name: string;
  description?: string;
}

interface Role {
  id: number;
  name: string;
  description?: string;
  level: number;
}

export default function UsersPage() {
  const confirmDialog = useConfirmDialog();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const canManageUsers = isAdmin(user);

  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [groups, setGroups] = useState<Group[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Pagination & Search
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const limit = 20;

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showGroupsModal, setShowGroupsModal] = useState(false);
  const [showRolesModal, setShowRolesModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedUserGroups, setSelectedUserGroups] = useState<number[]>([]);
  const [selectedUserRoles, setSelectedUserRoles] = useState<number[]>([]);

  // Forms
  const [createForm, setCreateForm] = useState({
    username: '',
    email: '',
    password: '',
    status: 'active',
  });
  const [editForm, setEditForm] = useState({
    email: '',
    avatar: '',
    status: 'active',
    password: '',
  });

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const response = await adminApi.listUsers({
        skip: page * limit,
        limit,
        search: search || undefined,
      });
      setUsers(response.data.items);
      setTotal(response.data.total);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载用户列表失败');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  const loadGroups = async () => {
    try {
      const response = await groupApi.list();
      setGroups(response.data);
    } catch (err) {
      console.error('加载用户组失败:', err);
    }
  };

  const loadRoles = async () => {
    try {
      const response = await adminApi.listRoles();
      setRoles(response.data);
    } catch (err) {
      console.error('加载角色列表失败:', err);
    }
  };

  useEffect(() => {
    if (!canManageUsers) return;
    loadUsers();
  }, [canManageUsers, loadUsers]);

  useEffect(() => {
    if (!canManageUsers) return;
    loadGroups();
    loadRoles();
  }, [canManageUsers]);

  if (!canManageUsers) {
    return (
      <div className="surface p-6">
        <h1 className="text-xl font-semibold mb-2">无权限</h1>
        <p className="text-gray-600">该页面仅管理员可访问。</p>
      </div>
    );
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminApi.createUser(createForm);
      setShowCreateModal(false);
      setCreateForm({ username: '', email: '', password: '', status: 'active' });
      loadUsers();
    } catch (err: any) {
      setError(err.response?.data?.detail || '创建用户失败');
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    try {
      const data: any = {
        email: editForm.email,
        avatar: editForm.avatar || null,
        status: editForm.status,
      };
      if (editForm.password) {
        data.password = editForm.password;
      }
      await adminApi.updateUser(selectedUser.id, data);
      setShowEditModal(false);
      setSelectedUser(null);
      loadUsers();
    } catch (err: any) {
      setError(err.response?.data?.detail || '更新用户失败');
    }
  };

  const handleDeleteUser = async (userId: number) => {
    const shouldDelete = await confirmDialog({
      title: '确认删除用户',
      description: '确定要删除这个用户吗？此操作不可撤销。',
      confirmText: '删除用户',
      cancelText: '取消',
      status: 'danger',
      confirmVariant: 'danger',
    });
    if (!shouldDelete) return;
    try {
      await adminApi.deleteUser(userId);
      loadUsers();
    } catch (err: any) {
      setError(err.response?.data?.detail || '删除用户失败');
    }
  };

  const openEditModal = (u: User) => {
    setSelectedUser(u);
    setEditForm({
      email: u.email,
      avatar: u.avatar || '',
      status: u.status,
      password: '',
    });
    setShowEditModal(true);
  };

  const openGroupsModal = (u: User) => {
    setSelectedUser(u);
    const userGroupIds = groups.filter(g => u.groups.includes(g.name)).map(g => g.id);
    setSelectedUserGroups(userGroupIds);
    setShowGroupsModal(true);
  };

  const handleUpdateGroups = async () => {
    if (!selectedUser) return;
    try {
      await adminApi.updateUserGroups(selectedUser.id, selectedUserGroups);
      setShowGroupsModal(false);
      setSelectedUser(null);
      loadUsers();
    } catch (err: any) {
      setError(err.response?.data?.detail || '更新用户组失败');
    }
  };

  const toggleGroup = (groupId: number) => {
    setSelectedUserGroups(prev =>
      prev.includes(groupId) ? prev.filter(id => id !== groupId) : [...prev, groupId]
    );
  };

  const openRolesModal = (u: User) => {
    setSelectedUser(u);
    const userRoleIds = roles.filter(r => u.roles.includes(r.name)).map(r => r.id);
    setSelectedUserRoles(userRoleIds);
    setShowRolesModal(true);
  };

  const handleUpdateRoles = async () => {
    if (!selectedUser) return;
    try {
      await adminApi.updateUserRoles(selectedUser.id, selectedUserRoles);
      setShowRolesModal(false);
      setSelectedUser(null);
      loadUsers();
    } catch (err: any) {
      setError(err.response?.data?.detail || '更新用户角色失败');
    }
  };

  const toggleRole = (roleId: number) => {
    setSelectedUserRoles(prev =>
      prev.includes(roleId) ? prev.filter(id => id !== roleId) : [...prev, roleId]
    );
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200 dark:border-green-900',
      inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700',
      suspended: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200 dark:border-red-900',
    };
    const labels: Record<string, string> = {
      active: '激活',
      inactive: '未激活',
      suspended: '暂停',
    };
    return (
      <span className={`px-2 py-1 text-xs rounded-full border ${styles[status] || styles.inactive}`}>
        {labels[status] || status}
      </span>
    );
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="px-4 sm:px-6 lg:px-8 animate-fade-in">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">用户管理</h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            管理系统中的所有用户，包括创建、编辑和删除用户。
          </p>
        </div>
          <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
            <Button type="button" onPress={() => setShowCreateModal(true)} variant="primary">
              创建用户
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md dark:bg-red-950 dark:border-red-900">
            <p className="text-sm text-red-600 dark:text-red-200">{error}</p>
          </div>
        )}

        <div className="mt-6">
          <div className="surface overflow-hidden">
            {/* Search & Stats */}
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-sm text-gray-600 dark:text-gray-300">
                共 {total} 位用户
              </div>
              <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full sm:max-w-xs"
                  placeholder="搜索用户名 / 邮箱 / ID"
                />
                <div className="flex gap-2">
                  <Button type="submit" variant="secondary" className="flex-1 sm:flex-none">搜索</Button>
                  {search && (
                    <Button type="button" onPress={() => { setSearchInput(''); setSearch(''); setPage(0); }} variant="secondary" className="flex-1 sm:flex-none">
                      清除
                    </Button>
                  )}
                </div>
              </form>
            </div>

          {loading ? (
            <div className="flex justify-center items-center h-64">
              <Spinner size="lg" />
            </div>
          ) : users.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-500">
              {search ? '没有匹配的用户' : '暂无用户'}
            </div>
          ) : (
            <ul className="list">
              {users.map((u) => (
                <li key={u.id} className="list-item">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      {u.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={u.avatar}
                          alt={u.username}
                          className="h-10 w-10 rounded-full border border-gray-200 dark:border-gray-800 shrink-0"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center text-white shrink-0">
                          {u.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{u.username}</div>
                          {getStatusBadge(u.status)}
                          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">ID: {u.id}</span>
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-300 truncate mt-1">{u.email}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>创建：{formatDate(u.created_at)}</span>
                          <span className="opacity-60">·</span>
                          <span className="truncate">用户组：{u.groups?.length ? u.groups.join(', ') : '无'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 shrink-0 ml-13 sm:ml-0">
                      <Button  onPress={() => router.push(`/admin/users/detail?id=${u.id}`)} variant="primary"
                      size="sm">
                        详情
                      </Button>
                      <Button  onPress={() => openEditModal(u)} variant="secondary" size="sm">编辑</Button>
                      <Button  onPress={() => openGroupsModal(u)} variant="secondary" size="sm">用户组</Button>
                      <Button  onPress={() => openRolesModal(u)} variant="secondary" size="sm">角色</Button>
                      <Button  onPress={() => router.push(`/admin/users/permissions?id=${u.id}`)} variant="secondary"
                      size="sm">
                        应用权限
                      </Button>
                      <Button  onPress={() => handleDeleteUser(u.id)} variant="danger" size="sm">删除</Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between">
              <div className="text-sm text-gray-500 dark:text-gray-400">
                第 {page + 1} / {totalPages} 页
              </div>
              <div className="flex gap-2">
                <Button onPress={() => setPage(p => Math.max(0, p - 1))} isDisabled={page === 0} variant="secondary">
                  上一页
                </Button>
                <Button onPress={() => setPage(p => Math.min(totalPages - 1, p + 1))} isDisabled={page >= totalPages - 1} variant="secondary">
                  下一页
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <AlertDialog>
        <AlertDialog.Backdrop isOpen={showCreateModal} onOpenChange={setShowCreateModal}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>创建新用户</AlertDialog.Heading>
              </AlertDialog.Header>
              <form onSubmit={handleCreateUser}>
                <AlertDialog.Body>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">用户名</label>
                      <Input
                        type="text"
                        required
                        minLength={3}
                        value={createForm.username}
                        onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">邮箱</label>
                      <Input
                        type="email"
                        required
                        value={createForm.email}
                        onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">密码</label>
                      <Input
                        type="password"
                        required
                        minLength={6}
                        value={createForm.password}
                        onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">状态</label>
                      <Select
                        selectedKey={createForm.status}
                        onSelectionChange={(key) => setCreateForm({ ...createForm, status: String(key ?? 'active') })}
                      >
                        <Select.Trigger>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <SelectItem id="active">激活</SelectItem>
                            <SelectItem id="inactive">未激活</SelectItem>
                            <SelectItem id="suspended">暂停</SelectItem>
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                  </div>
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button type="button" onPress={() => setShowCreateModal(false)} variant="secondary">取消</Button>
                  <Button type="submit" variant="primary">创建</Button>
                </AlertDialog.Footer>
              </form>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog>
        <AlertDialog.Backdrop isOpen={showEditModal && !!selectedUser} onOpenChange={setShowEditModal}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>编辑用户: {selectedUser?.username}</AlertDialog.Heading>
              </AlertDialog.Header>
              <form onSubmit={handleEditUser}>
                <AlertDialog.Body>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">邮箱</label>
                      <Input
                        type="email"
                        required
                        value={editForm.email}
                        onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">头像URL</label>
                      <Input
                        type="url"
                        value={editForm.avatar}
                        onChange={(e) => setEditForm({ ...editForm, avatar: e.target.value })}
                        placeholder="https://example.com/avatar.jpg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">状态</label>
                      <Select
                        selectedKey={editForm.status}
                        onSelectionChange={(key) => setEditForm({ ...editForm, status: String(key ?? 'active') })}
                      >
                        <Select.Trigger>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <SelectItem id="active">激活</SelectItem>
                            <SelectItem id="inactive">未激活</SelectItem>
                            <SelectItem id="suspended">暂停</SelectItem>
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">新密码（留空则不修改）</label>
                      <Input
                        type="password"
                        minLength={6}
                        value={editForm.password}
                        onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                        placeholder="留空则不修改密码"
                      />
                    </div>
                  </div>
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button type="button" onPress={() => setShowEditModal(false)} variant="secondary">取消</Button>
                  <Button type="submit" variant="primary">保存</Button>
                </AlertDialog.Footer>
              </form>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog>
        <AlertDialog.Backdrop isOpen={showGroupsModal && !!selectedUser} onOpenChange={setShowGroupsModal}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>管理用户组: {selectedUser?.username}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <div className="surface overflow-hidden max-h-96 overflow-y-auto">
                  <div className="list">
                    {groups.map((group) => (
                      <UICheckbox key={group.id} isSelected={selectedUserGroups.includes(group.id)} onChange={() => toggleGroup(group.id)}
                      className="list-item list-item-pressable flex items-start gap-3 w-full"><div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{group.name}</div>
                        {group.description && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{group.description}</div>
                        )}
                      </div></UICheckbox>
                    ))}
                  </div>
                </div>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button type="button" onPress={() => setShowGroupsModal(false)} variant="secondary">取消</Button>
                <Button type="button" onPress={handleUpdateGroups} variant="primary">保存</Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog>
        <AlertDialog.Backdrop isOpen={showRolesModal && !!selectedUser} onOpenChange={setShowRolesModal}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>管理用户角色: {selectedUser?.username}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <div className="surface overflow-hidden max-h-96 overflow-y-auto">
                  <div className="list">
                    {roles.map((role) => (
                      <UICheckbox key={role.id} isSelected={selectedUserRoles.includes(role.id)} onChange={() => toggleRole(role.id)}
                      className="list-item list-item-pressable flex items-start gap-3 w-full"><div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{role.name}</div>
                        {role.description && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{role.description}</div>
                        )}
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">等级: {role.level}</div>
                      </div></UICheckbox>
                    ))}
                  </div>
                </div>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button type="button" onPress={() => setShowRolesModal(false)} variant="secondary">取消</Button>
                <Button type="button" onPress={handleUpdateRoles} variant="primary">保存</Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
