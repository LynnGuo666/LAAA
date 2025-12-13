'use client';

import { useEffect, useState } from 'react';
import { adminApi, groupApi, clientApi } from '@/lib/api';
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

interface AppItem {
  id: number;
  client_id: string;
  name: string;
  logo?: string;
}

export default function UsersPage() {
  const user = useAuthStore((s) => s.user);
  const canManageUsers = isAdmin(user);
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showGroupsModal, setShowGroupsModal] = useState(false);
  const [showRolesModal, setShowRolesModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedUserGroups, setSelectedUserGroups] = useState<number[]>([]);
  const [selectedUserRoles, setSelectedUserRoles] = useState<number[]>([]);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [showAppsModal, setShowAppsModal] = useState(false);
  const [selectedUserAllowedApps, setSelectedUserAllowedApps] = useState<number[]>([]);
  const [selectedUserDeniedApps, setSelectedUserDeniedApps] = useState<number[]>([]);

  // 创建用户表单
  const [createForm, setCreateForm] = useState({
    username: '',
    email: '',
    password: '',
    status: 'active',
  });

  // 编辑用户表单
  const [editForm, setEditForm] = useState({
    email: '',
    avatar: '',
    status: 'active',
    password: '',
  });

  useEffect(() => {
    if (!canManageUsers) return;
    loadUsers();
    loadGroups();
    loadRoles();
    loadApps();
  }, [canManageUsers]);

  if (!canManageUsers) {
    return (
      <div className="surface p-6">
        <h1 className="text-xl font-semibold mb-2">无权限</h1>
        <p className="text-gray-600">该页面仅管理员可访问。</p>
      </div>
    );
  }

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await adminApi.listUsers();
      setUsers(response.data);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载用户列表失败');
    } finally {
      setLoading(false);
    }
  };

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

  const loadApps = async () => {
    try {
      const response = await clientApi.list();
      setApps(response.data);
    } catch (err) {
      console.error('加载应用列表失败:', err);
    }
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
    if (!confirm('确定要删除这个用户吗？此操作不可撤销。')) {
      return;
    }

    try {
      await adminApi.deleteUser(userId);
      loadUsers();
    } catch (err: any) {
      setError(err.response?.data?.detail || '删除用户失败');
    }
  };

  const openEditModal = (user: User) => {
    setSelectedUser(user);
    setEditForm({
      email: user.email,
      avatar: user.avatar || '',
      status: user.status,
      password: '',
    });
    setShowEditModal(true);
  };

  const openGroupsModal = async (user: User) => {
    setSelectedUser(user);

    // 根据用户的组名称找到对应的组ID
    const userGroupIds = groups
      .filter(g => user.groups.includes(g.name))
      .map(g => g.id);

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
      prev.includes(groupId)
        ? prev.filter(id => id !== groupId)
        : [...prev, groupId]
    );
  };

  const openRolesModal = async (user: User) => {
    setSelectedUser(user);

    // 根据用户的角色名称找到对应的角色ID
    const userRoleIds = roles
      .filter(r => user.roles.includes(r.name))
      .map(r => r.id);

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
      prev.includes(roleId)
        ? prev.filter(id => id !== roleId)
        : [...prev, roleId]
    );
  };

  const openAppsModal = async (user: User) => {
    setSelectedUser(user);
    try {
      const response = await adminApi.getUserAppPermissions(user.id);
      setSelectedUserAllowedApps(response.data.allowed_apps.map((app: AppItem) => app.id));
      setSelectedUserDeniedApps(response.data.denied_apps.map((app: AppItem) => app.id));
      setShowAppsModal(true);
    } catch (err: any) {
      setError(err.response?.data?.detail || '获取用户应用权限失败');
    }
  };

  const handleUpdateAppPermissions = async () => {
    if (!selectedUser) return;

    try {
      await adminApi.updateUserAppPermissions(selectedUser.id, {
        allowed_app_ids: selectedUserAllowedApps,
        denied_app_ids: selectedUserDeniedApps,
      });
      setShowAppsModal(false);
      setSelectedUser(null);
    } catch (err: any) {
      setError(err.response?.data?.detail || '更新用户应用权限失败');
    }
  };

  const toggleAllowedApp = (appId: number) => {
    // 如果在拒绝列表中，先移除
    if (selectedUserDeniedApps.includes(appId)) {
      setSelectedUserDeniedApps(prev => prev.filter(id => id !== appId));
    }
    setSelectedUserAllowedApps(prev =>
      prev.includes(appId)
        ? prev.filter(id => id !== appId)
        : [...prev, appId]
    );
  };

  const toggleDeniedApp = (appId: number) => {
    // 如果在允许列表中，先移除
    if (selectedUserAllowedApps.includes(appId)) {
      setSelectedUserAllowedApps(prev => prev.filter(id => id !== appId));
    }
    setSelectedUserDeniedApps(prev =>
      prev.includes(appId)
        ? prev.filter(id => id !== appId)
        : [...prev, appId]
    );
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      active: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200 dark:border-green-900',
      inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700',
      suspended: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200 dark:border-red-900',
    };

    const labels = {
      active: '激活',
      inactive: '未激活',
      suspended: '暂停',
    };

    return (
      <span className={`px-2 py-1 text-xs rounded-full border ${styles[status as keyof typeof styles] || styles.inactive}`}>
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const filteredUsers = users.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      String(u.id).includes(q)
    );
  });

  return (
    <div className="px-4 sm:px-6 lg:px-8 animate-fade-in">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900">用户管理</h1>
          <p className="mt-2 text-sm text-gray-700">
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
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="mt-6">
        <div className="surface overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-3">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              共 {filteredUsers.length} 位用户
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input text-sm max-w-xs"
              placeholder="搜索用户名 / 邮箱 / ID"
            />
          </div>

          {filteredUsers.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-500">没有匹配的用户</div>
          ) : (
            <ul className="list">
              {filteredUsers.map((u) => (
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
                          <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                            {u.username}
                          </div>
                          {getStatusBadge(u.status)}
                          <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                            ID: {u.id}
                          </span>
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-300 truncate mt-1">
                          {u.email}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>
                            创建：{new Date(u.created_at).toLocaleDateString('zh-CN')}
                          </span>
                          <span className="opacity-60">·</span>
                          <span>
                            用户组：{u.groups?.length ? u.groups.join(', ') : '无'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2 shrink-0">
                      <button
                        onClick={() => openEditModal(u)}
                        className="btn btn-secondary text-sm"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => openGroupsModal(u)}
                        className="btn btn-secondary text-sm"
                      >
                        用户组
                      </button>
                      <button
                        onClick={() => openRolesModal(u)}
                        className="btn btn-secondary text-sm"
                      >
                        角色
                      </button>
                      <button
                        onClick={() => openAppsModal(u)}
                        className="btn btn-secondary text-sm"
                      >
                        应用权限
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u.id)}
                        className="btn btn-danger text-sm"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 创建用户模态框 */}
      {showCreateModal && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowCreateModal(false);
          }}
        >
          <div className="surface max-w-md w-full p-6 animate-slide-up">
            <h3 className="text-lg font-medium text-gray-900 mb-4">创建新用户</h3>
            <form onSubmit={handleCreateUser}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    用户名
                  </label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    邮箱
                  </label>
                  <input
                    type="email"
                    required
                    value={createForm.email}
                    onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    密码
                  </label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    状态
                  </label>
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
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="btn btn-secondary"
                >
                  取消
                </button>
                <button type="submit" className="btn btn-primary">
                  创建
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 编辑用户模态框 */}
      {showEditModal && selectedUser && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowEditModal(false);
          }}
        >
          <div className="surface max-w-md w-full p-6 animate-slide-up">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              编辑用户: {selectedUser.username}
            </h3>
            <form onSubmit={handleEditUser}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    邮箱
                  </label>
                  <input
                    type="email"
                    required
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    头像URL
                  </label>
                  <input
                    type="url"
                    value={editForm.avatar}
                    onChange={(e) => setEditForm({ ...editForm, avatar: e.target.value })}
                    className="input"
                    placeholder="https://example.com/avatar.jpg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    状态
                  </label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    新密码（留空则不修改）
                  </label>
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
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="btn btn-secondary"
                >
                  取消
                </button>
                <button type="submit" className="btn btn-primary">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 管理用户组模态框 */}
      {showGroupsModal && selectedUser && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowGroupsModal(false);
          }}
        >
          <div className="surface max-w-md w-full p-6 animate-slide-up">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
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
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                          {group.description}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowGroupsModal(false)}
                className="btn btn-secondary"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleUpdateGroups}
                className="btn btn-primary"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 管理用户角色模态框 */}
      {showRolesModal && selectedUser && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowRolesModal(false);
          }}
        >
          <div className="surface max-w-md w-full p-6 animate-slide-up">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
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
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                          {role.description}
                        </div>
                      )}
                      <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">等级: {role.level}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowRolesModal(false)}
                className="btn btn-secondary"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleUpdateRoles}
                className="btn btn-primary"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 管理用户应用权限模态框 */}
      {showAppsModal && selectedUser && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowAppsModal(false);
          }}
        >
          <div className="surface max-w-lg w-full p-6 animate-slide-up">
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
              管理应用权限: {selectedUser.username}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              优先级：用户拒绝 &gt; 用户允许 &gt; 用户组拒绝 &gt; 用户组允许 &gt; 应用默认
            </p>
            <div className="surface overflow-hidden max-h-96 overflow-y-auto">
              <div className="list">
                {apps.map((app) => (
                  <div key={app.id} className="list-item flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {app.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={app.logo}
                          alt={app.name}
                          className="h-8 w-8 rounded border border-gray-200 dark:border-gray-700"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 text-xs">
                          {app.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{app.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{app.client_id}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedUserAllowedApps.includes(app.id)}
                          onChange={() => toggleAllowedApp(app.id)}
                          className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                        />
                        <span className="text-xs text-green-600 dark:text-green-400">允许</span>
                      </label>
                      <label className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedUserDeniedApps.includes(app.id)}
                          onChange={() => toggleDeniedApp(app.id)}
                          className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                        />
                        <span className="text-xs text-red-600 dark:text-red-400">拒绝</span>
                      </label>
                    </div>
                  </div>
                ))}
                {apps.length === 0 && (
                  <div className="p-4 text-center text-sm text-gray-500">暂无应用</div>
                )}
              </div>
            </div>
            <div className="mt-6 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowAppsModal(false)}
                className="btn btn-secondary"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleUpdateAppPermissions}
                className="btn btn-primary"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
