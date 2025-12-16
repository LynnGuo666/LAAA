'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { adminApi, groupApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { isAdmin } from '@/lib/authz';

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
    if (!confirm('确定要删除这个用户吗？此操作不可撤销。')) return;
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
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="btn btn-primary"
          >
            创建用户
          </button>
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
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              共 {total} 位用户
            </div>
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="input text-sm max-w-xs"
                placeholder="搜索用户名 / 邮箱 / ID"
              />
              <button type="submit" className="btn btn-secondary text-sm">搜索</button>
              {search && (
                <button
                  type="button"
                  onClick={() => { setSearchInput(''); setSearch(''); setPage(0); }}
                  className="btn btn-secondary text-sm"
                >
                  清除
                </button>
              )}
            </form>
          </div>

          {loading ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            </div>
          ) : users.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-500">
              {search ? '没有匹配的用户' : '暂无用户'}
            </div>
          ) : (
            <ul className="list">
              {users.map((u) => (
                <li key={u.id} className="list-item">
                  <div className="flex items-start justify-between gap-4">
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
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{u.username}</div>
                          {getStatusBadge(u.status)}
                          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">ID: {u.id}</span>
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-300 truncate mt-1">{u.email}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>创建：{new Date(u.created_at).toLocaleDateString('zh-CN')}</span>
                          <span className="opacity-60">·</span>
                          <span>用户组：{u.groups?.length ? u.groups.join(', ') : '无'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2 shrink-0">
                      <button onClick={() => openEditModal(u)} className="btn btn-secondary text-sm">编辑</button>
                      <button onClick={() => openGroupsModal(u)} className="btn btn-secondary text-sm">用户组</button>
                      <button onClick={() => openRolesModal(u)} className="btn btn-secondary text-sm">角色</button>
                      <button
                        onClick={() => router.push(`/admin/users/permissions?id=${u.id}`)}
                        className="btn btn-secondary text-sm"
                      >
                        应用权限
                      </button>
                      <button onClick={() => handleDeleteUser(u.id)} className="btn btn-danger text-sm">删除</button>
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
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="btn btn-secondary text-sm disabled:opacity-50"
                >
                  上一页
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="btn btn-secondary text-sm disabled:opacity-50"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create User Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowCreateModal(false); }}
        >
          <div className="surface max-w-md w-full p-6 animate-slide-up">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">创建新用户</h3>
            <form onSubmit={handleCreateUser}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">用户名</label>
                  <input
                    type="text"
                    required
                    minLength={3}
                    value={createForm.username}
                    onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">邮箱</label>
                  <input
                    type="email"
                    required
                    value={createForm.email}
                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">密码</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={createForm.password}
                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">状态</label>
                  <select
                    value={createForm.status}
                    onChange={(e) => setCreateForm({ ...createForm, status: e.target.value })}
                    className="input"
                  >
                    <option value="active">激活</option>
                    <option value="inactive">未激活</option>
                    <option value="suspended">暂停</option>
                  </select>
                </div>
              </div>
              <div className="mt-6 flex justify-end space-x-3">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-secondary">取消</button>
                <button type="submit" className="btn btn-primary">创建</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowEditModal(false); }}
        >
          <div className="surface max-w-md w-full p-6 animate-slide-up">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
              编辑用户: {selectedUser.username}
            </h3>
            <form onSubmit={handleEditUser}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">邮箱</label>
                  <input
                    type="email"
                    required
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">头像URL</label>
                  <input
                    type="url"
                    value={editForm.avatar}
                    onChange={(e) => setEditForm({ ...editForm, avatar: e.target.value })}
                    className="input"
                    placeholder="https://example.com/avatar.jpg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">状态</label>
                  <select
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    className="input"
                  >
                    <option value="active">激活</option>
                    <option value="inactive">未激活</option>
                    <option value="suspended">暂停</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">新密码（留空则不修改）</label>
                  <input
                    type="password"
                    minLength={6}
                    value={editForm.password}
                    onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                    className="input"
                    placeholder="留空则不修改密码"
                  />
                </div>
              </div>
              <div className="mt-6 flex justify-end space-x-3">
                <button type="button" onClick={() => setShowEditModal(false)} className="btn btn-secondary">取消</button>
                <button type="submit" className="btn btn-primary">保存</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Groups Modal */}
      {showGroupsModal && selectedUser && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowGroupsModal(false); }}
        >
          <div className="surface max-w-md w-full p-6 animate-slide-up">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
              管理用户组: {selectedUser.username}
            </h3>
            <div className="surface overflow-hidden max-h-96 overflow-y-auto">
              <div className="list">
                {groups.map((group) => (
                  <label key={group.id} className="list-item list-item-pressable flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedUserGroups.includes(group.id)}
                      onChange={() => toggleGroup(group.id)}
                      className="h-4 w-4 mt-0.5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{group.name}</div>
                      {group.description && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{group.description}</div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button type="button" onClick={() => setShowGroupsModal(false)} className="btn btn-secondary">取消</button>
              <button type="button" onClick={handleUpdateGroups} className="btn btn-primary">保存</button>
            </div>
          </div>
        </div>
      )}

      {/* Roles Modal */}
      {showRolesModal && selectedUser && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowRolesModal(false); }}
        >
          <div className="surface max-w-md w-full p-6 animate-slide-up">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
              管理用户角色: {selectedUser.username}
            </h3>
            <div className="surface overflow-hidden max-h-96 overflow-y-auto">
              <div className="list">
                {roles.map((role) => (
                  <label key={role.id} className="list-item list-item-pressable flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedUserRoles.includes(role.id)}
                      onChange={() => toggleRole(role.id)}
                      className="h-4 w-4 mt-0.5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{role.name}</div>
                      {role.description && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{role.description}</div>
                      )}
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">等级: {role.level}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button type="button" onClick={() => setShowRolesModal(false)} className="btn btn-secondary">取消</button>
              <button type="button" onClick={handleUpdateRoles} className="btn btn-primary">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
