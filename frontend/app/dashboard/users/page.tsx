'use client';

import { useEffect, useState } from 'react';
import { adminApi, groupApi } from '@/lib/api';

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
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showGroupsModal, setShowGroupsModal] = useState(false);
  const [showRolesModal, setShowRolesModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedUserGroups, setSelectedUserGroups] = useState<number[]>([]);
  const [selectedUserRoles, setSelectedUserRoles] = useState<number[]>([]);

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
    loadUsers();
    loadGroups();
    loadRoles();
  }, []);

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

  const getStatusBadge = (status: string) => {
    const styles = {
      active: 'bg-green-100 text-green-800',
      inactive: 'bg-gray-100 text-gray-800',
      suspended: 'bg-red-100 text-red-800',
    };

    const labels = {
      active: '激活',
      inactive: '未激活',
      suspended: '暂停',
    };

    return (
      <span className={`px-2 py-1 text-xs rounded-full ${styles[status as keyof typeof styles] || styles.inactive}`}>
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

  return (
    <div className="px-4 sm:px-6 lg:px-8">
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

      <div className="mt-8 flow-root">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <div className="overflow-hidden shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
              <table className="min-w-full divide-y divide-gray-300">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                      用户
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      邮箱
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      状态
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      用户组
                    </th>
                    <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                      创建时间
                    </th>
                    <th scope="col" className="relative py-3.5 pl-3 pr-4 sm:pr-6">
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                        <div className="flex items-center">
                          {user.avatar ? (
                            <img
                              src={user.avatar}
                              alt={user.username}
                              className="h-10 w-10 rounded-full mr-3"
                            />
                          ) : (
                            <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center text-white mr-3">
                              {user.username.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="font-medium">{user.username}</div>
                            <div className="text-gray-500 text-xs">ID: {user.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {user.email}
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm">
                        {getStatusBadge(user.status)}
                      </td>
                      <td className="px-3 py-4 text-sm text-gray-500">
                        <div className="flex flex-wrap gap-1">
                          {user.groups.length > 0 ? (
                            user.groups.map((group, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-xs"
                              >
                                {group}
                              </span>
                            ))
                          ) : (
                            <span className="text-gray-400 text-xs">无</span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                        {new Date(user.created_at).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6">
                        <button
                          onClick={() => openEditModal(user)}
                          className="text-blue-600 hover:text-blue-900 mr-4"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => openGroupsModal(user)}
                          className="text-green-600 hover:text-green-900 mr-4"
                        >
                          组
                        </button>
                        <button
                          onClick={() => openRolesModal(user)}
                          className="text-purple-600 hover:text-purple-900 mr-4"
                        >
                          角色
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* 创建用户模态框 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
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
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
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
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              管理用户组: {selectedUser.username}
            </h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {groups.map((group) => (
                <label
                  key={group.id}
                  className="flex items-center p-3 border rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedUserGroups.includes(group.id)}
                    onChange={() => toggleGroup(group.id)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <div className="ml-3">
                    <div className="text-sm font-medium text-gray-900">{group.name}</div>
                    {group.description && (
                      <div className="text-xs text-gray-500">{group.description}</div>
                    )}
                  </div>
                </label>
              ))}
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
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              管理用户角色: {selectedUser.username}
            </h3>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {roles.map((role) => (
                <label
                  key={role.id}
                  className="flex items-center p-3 border rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedUserRoles.includes(role.id)}
                    onChange={() => toggleRole(role.id)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <div className="ml-3">
                    <div className="text-sm font-medium text-gray-900">{role.name}</div>
                    {role.description && (
                      <div className="text-xs text-gray-500">{role.description}</div>
                    )}
                    <div className="text-xs text-gray-400">等级: {role.level}</div>
                  </div>
                </label>
              ))}
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
    </div>
  );
}
