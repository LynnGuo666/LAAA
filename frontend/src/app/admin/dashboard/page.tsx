'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface DashboardStats {
  total_users: number;
  total_clients: number;
  total_logins_today: number;
  active_users_today: number;
}

interface User {
  id: string;
  email: string;
  username: string;
  full_name?: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
}

interface ClientApplication {
  id: string;
  client_id: string;
  client_name: string;
  client_description?: string;
  is_active: boolean;
  owner_id: string;
  created_at: string;
  owner?: {
    username: string;
    email: string;
  };
}

interface LoginLog {
  id: string;
  username: string;
  login_time: string;
  ip_address: string;
  user_agent: string;
  login_method: string;
  success: boolean;
  client_name?: string;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<ClientApplication[]>([]);
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);

  // User management
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userForm, setUserForm] = useState({
    email: '',
    username: '',
    password: '',
    full_name: '',
    is_admin: false,
    is_active: true
  });

  // Client management
  const [editingClient, setEditingClient] = useState<ClientApplication | null>(null);
  const [clientForm, setClientForm] = useState({
    client_name: '',
    client_description: '',
    client_uri: '',
    logo_uri: '',
    is_active: true
  });

  useEffect(() => {
    checkAdmin();
  }, []);

  useEffect(() => {
    if (activeTab === 'overview') {
      loadStats();
    } else if (activeTab === 'users') {
      loadUsers();
    } else if (activeTab === 'clients') {
      loadClients();
    } else if (activeTab === 'logs') {
      loadLoginLogs();
    }
  }, [activeTab]);

  const checkAdmin = async () => {
    try {
      const response = await fetch('/api/v1/dashboard/profile', {
        headers: {
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        }
      });

      if (response.ok) {
        const user = await response.json();
        if (!user.is_admin) {
          router.push('/dashboard');
          return;
        }
        setLoading(false);
      } else {
        router.push('/login');
      }
    } catch (error) {
      console.error('Failed to check admin status:', error);
      router.push('/login');
    }
  };

  const loadStats = async () => {
    try {
      const response = await fetch('/api/v1/dashboard/admin/stats', {
        headers: {
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        }
      });

      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await fetch('/api/v1/users', {
        headers: {
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        }
      });

      if (response.ok) {
        const data = await response.json();
        setUsers(data);
      }
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  };

  const loadClients = async () => {
    try {
      const response = await fetch('/api/v1/clients', {
        headers: {
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        }
      });

      if (response.ok) {
        const data = await response.json();
        setClients(data);
      }
    } catch (error) {
      console.error('Failed to load clients:', error);
    }
  };

  const loadLoginLogs = async () => {
    try {
      const response = await fetch('/api/v1/dashboard/admin/logs/login', {
        headers: {
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        }
      });

      if (response.ok) {
        const data = await response.json();
        setLoginLogs(data);
      }
    } catch (error) {
      console.error('Failed to load login logs:', error);
    }
  };

  const createUser = async () => {
    if (!userForm.email || !userForm.username || !userForm.password) {
      alert('请填写必填字段');
      return;
    }

    try {
      const response = await fetch('/api/v1/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        },
        body: JSON.stringify(userForm)
      });

      if (response.ok) {
        alert('用户创建成功！');
        setShowUserForm(false);
        setUserForm({
          email: '',
          username: '',
          password: '',
          full_name: '',
          is_admin: false,
          is_active: true
        });
        loadUsers();
      } else {
        const error = await response.json();
        alert(error.detail || '创建失败');
      }
    } catch (error) {
      console.error('Failed to create user:', error);
      alert('创建失败，请重试');
    }
  };

  const updateUser = async (userId: string) => {
    if (!editingUser) return;

    try {
      const response = await fetch(`/api/v1/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        },
        body: JSON.stringify({
          email: editingUser.email,
          username: editingUser.username,
          full_name: editingUser.full_name,
          is_active: editingUser.is_active,
          is_admin: editingUser.is_admin
        })
      });

      if (response.ok) {
        alert('用户更新成功！');
        setEditingUser(null);
        loadUsers();
      } else {
        const error = await response.json();
        alert(error.detail || '更新失败');
      }
    } catch (error) {
      console.error('Failed to update user:', error);
      alert('更新失败，请重试');
    }
  };

  const deleteUser = async (userId: string) => {
    if (!confirm('确定要删除该用户吗？此操作不可撤销。')) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        }
      });

      if (response.ok) {
        alert('用户删除成功！');
        loadUsers();
      } else {
        const error = await response.json();
        alert(error.detail || '删除失败');
      }
    } catch (error) {
      console.error('Failed to delete user:', error);
      alert('删除失败，请重试');
    }
  };

  const updateClient = async (clientId: string) => {
    if (!editingClient) return;

    try {
      const response = await fetch(`/api/v1/clients/${clientId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        },
        body: JSON.stringify({
          client_name: editingClient.client_name,
          client_description: editingClient.client_description,
          is_active: editingClient.is_active
        })
      });

      if (response.ok) {
        alert('应用更新成功！');
        setEditingClient(null);
        loadClients();
      } else {
        const error = await response.json();
        alert(error.detail || '更新失败');
      }
    } catch (error) {
      console.error('Failed to update client:', error);
      alert('更新失败，请重试');
    }
  };

  const deleteClient = async (clientId: string) => {
    if (!confirm('确定要删除该应用吗？此操作不可撤销。')) {
      return;
    }

    try {
      const response = await fetch(`/api/v1/clients/${clientId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        }
      });

      if (response.ok) {
        alert('应用删除成功！');
        loadClients();
      } else {
        const error = await response.json();
        alert(error.detail || '删除失败');
      }
    } catch (error) {
      console.error('Failed to delete client:', error);
      alert('删除失败，请重试');
    }
  };

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">管理员仪表盘</h1>
              <p className="text-sm text-gray-600">系统管理与监控</p>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => router.push('/dashboard')}
                className="btn-secondary"
              >
                用户仪表盘
              </button>
              <button
                onClick={() => router.push('/admin/permissions')}
                className="btn-secondary"
              >
                权限管理
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {/* Tabs */}
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              {[
                { key: 'overview', label: '总览' },
                { key: 'users', label: '用户管理' },
                { key: 'clients', label: '应用管理' },
                { key: 'logs', label: '登录日志' }
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`${
                    activeTab === tab.key
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  } whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="mt-6">
            {activeTab === 'overview' && (
              <div>
                {stats && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <div className="bg-white overflow-hidden shadow rounded-lg">
                      <div className="p-5">
                        <div className="flex items-center">
                          <div className="flex-shrink-0">
                            <div className="w-8 h-8 bg-blue-500 rounded-md flex items-center justify-center">
                              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                          </div>
                          <div className="ml-5 w-0 flex-1">
                            <dl>
                              <dt className="text-sm font-medium text-gray-500 truncate">总用户数</dt>
                              <dd className="text-lg font-medium text-gray-900">{stats.total_users}</dd>
                            </dl>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white overflow-hidden shadow rounded-lg">
                      <div className="p-5">
                        <div className="flex items-center">
                          <div className="flex-shrink-0">
                            <div className="w-8 h-8 bg-green-500 rounded-md flex items-center justify-center">
                              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                              </svg>
                            </div>
                          </div>
                          <div className="ml-5 w-0 flex-1">
                            <dl>
                              <dt className="text-sm font-medium text-gray-500 truncate">总应用数</dt>
                              <dd className="text-lg font-medium text-gray-900">{stats.total_clients}</dd>
                            </dl>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white overflow-hidden shadow rounded-lg">
                      <div className="p-5">
                        <div className="flex items-center">
                          <div className="flex-shrink-0">
                            <div className="w-8 h-8 bg-yellow-500 rounded-md flex items-center justify-center">
                              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 2L3 7v11a1 1 0 001 1h12a1 1 0 001-1V7l-7-5zM8 15v-3h4v3H8z" />
                              </svg>
                            </div>
                          </div>
                          <div className="ml-5 w-0 flex-1">
                            <dl>
                              <dt className="text-sm font-medium text-gray-500 truncate">今日登录</dt>
                              <dd className="text-lg font-medium text-gray-900">{stats.total_logins_today}</dd>
                            </dl>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bg-white overflow-hidden shadow rounded-lg">
                      <div className="p-5">
                        <div className="flex items-center">
                          <div className="flex-shrink-0">
                            <div className="w-8 h-8 bg-purple-500 rounded-md flex items-center justify-center">
                              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                          </div>
                          <div className="ml-5 w-0 flex-1">
                            <dl>
                              <dt className="text-sm font-medium text-gray-500 truncate">今日活跃</dt>
                              <dd className="text-lg font-medium text-gray-900">{stats.active_users_today}</dd>
                            </dl>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'users' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-lg font-medium text-gray-900">用户管理</h2>
                  <button
                    onClick={() => setShowUserForm(true)}
                    className="btn-primary"
                  >
                    创建用户
                  </button>
                </div>

                <div className="bg-white shadow overflow-hidden sm:rounded-md">
                  <ul className="divide-y divide-gray-200">
                    {users.map((user) => (
                      <li key={user.id}>
                        <div className="px-4 py-4 flex items-center justify-between">
                          {editingUser?.id === user.id ? (
                            <div className="flex-1 grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                              <input
                                type="email"
                                value={editingUser.email}
                                onChange={(e) => setEditingUser({...editingUser, email: e.target.value})}
                                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                                placeholder="邮箱"
                              />
                              <input
                                type="text"
                                value={editingUser.username}
                                onChange={(e) => setEditingUser({...editingUser, username: e.target.value})}
                                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                                placeholder="用户名"
                              />
                              <input
                                type="text"
                                value={editingUser.full_name || ''}
                                onChange={(e) => setEditingUser({...editingUser, full_name: e.target.value})}
                                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                                placeholder="全名"
                              />
                              <div className="flex space-x-2">
                                <label className="flex items-center text-sm">
                                  <input
                                    type="checkbox"
                                    checked={editingUser.is_active}
                                    onChange={(e) => setEditingUser({...editingUser, is_active: e.target.checked})}
                                    className="mr-1"
                                  />
                                  活跃
                                </label>
                                <label className="flex items-center text-sm">
                                  <input
                                    type="checkbox"
                                    checked={editingUser.is_admin}
                                    onChange={(e) => setEditingUser({...editingUser, is_admin: e.target.checked})}
                                    className="mr-1"
                                  />
                                  管理员
                                </label>
                              </div>
                              <div className="flex space-x-2">
                                <button
                                  onClick={() => updateUser(user.id)}
                                  className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                                >
                                  保存
                                </button>
                                <button
                                  onClick={() => setEditingUser(null)}
                                  className="px-3 py-1 bg-gray-300 text-gray-700 text-sm rounded hover:bg-gray-400"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex-1">
                                <div className="flex items-center space-x-4">
                                  <div>
                                    <p className="text-sm font-medium text-gray-900">
                                      {user.full_name || user.username}
                                    </p>
                                    <p className="text-sm text-gray-500">{user.email}</p>
                                  </div>
                                  <div className="flex space-x-2">
                                    {user.is_admin && (
                                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                        管理员
                                      </span>
                                    )}
                                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                      user.is_active 
                                        ? 'bg-green-100 text-green-800' 
                                        : 'bg-red-100 text-red-800'
                                    }`}>
                                      {user.is_active ? '活跃' : '禁用'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex space-x-2">
                                <button
                                  onClick={() => setEditingUser(user)}
                                  className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                                >
                                  编辑
                                </button>
                                <button
                                  onClick={() => deleteUser(user.id)}
                                  className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                                >
                                  删除
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Create User Modal */}
                {showUserForm && (
                  <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
                    <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
                      <div className="mt-3">
                        <h3 className="text-lg font-medium text-gray-900 mb-4">创建新用户</h3>
                        
                        <div className="space-y-4">
                          <input
                            type="email"
                            placeholder="邮箱"
                            value={userForm.email}
                            onChange={(e) => setUserForm({...userForm, email: e.target.value})}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          />
                          <input
                            type="text"
                            placeholder="用户名"
                            value={userForm.username}
                            onChange={(e) => setUserForm({...userForm, username: e.target.value})}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          />
                          <input
                            type="password"
                            placeholder="密码"
                            value={userForm.password}
                            onChange={(e) => setUserForm({...userForm, password: e.target.value})}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          />
                          <input
                            type="text"
                            placeholder="全名（可选）"
                            value={userForm.full_name}
                            onChange={(e) => setUserForm({...userForm, full_name: e.target.value})}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                          />
                          <div className="flex space-x-4">
                            <label className="flex items-center">
                              <input
                                type="checkbox"
                                checked={userForm.is_active}
                                onChange={(e) => setUserForm({...userForm, is_active: e.target.checked})}
                                className="mr-2"
                              />
                              活跃用户
                            </label>
                            <label className="flex items-center">
                              <input
                                type="checkbox"
                                checked={userForm.is_admin}
                                onChange={(e) => setUserForm({...userForm, is_admin: e.target.checked})}
                                className="mr-2"
                              />
                              管理员
                            </label>
                          </div>
                        </div>

                        <div className="flex justify-end space-x-3 mt-6">
                          <button
                            onClick={() => setShowUserForm(false)}
                            className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                          >
                            取消
                          </button>
                          <button
                            onClick={createUser}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                          >
                            创建
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'clients' && (
              <div className="space-y-6">
                <h2 className="text-lg font-medium text-gray-900">应用管理</h2>

                <div className="bg-white shadow overflow-hidden sm:rounded-md">
                  <ul className="divide-y divide-gray-200">
                    {clients.map((client) => (
                      <li key={client.id}>
                        <div className="px-4 py-4 flex items-center justify-between">
                          {editingClient?.id === client.id ? (
                            <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
                              <input
                                type="text"
                                value={editingClient.client_name}
                                onChange={(e) => setEditingClient({...editingClient, client_name: e.target.value})}
                                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                                placeholder="应用名称"
                              />
                              <input
                                type="text"
                                value={editingClient.client_description || ''}
                                onChange={(e) => setEditingClient({...editingClient, client_description: e.target.value})}
                                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                                placeholder="应用描述"
                              />
                              <label className="flex items-center text-sm">
                                <input
                                  type="checkbox"
                                  checked={editingClient.is_active}
                                  onChange={(e) => setEditingClient({...editingClient, is_active: e.target.checked})}
                                  className="mr-2"
                                />
                                活跃状态
                              </label>
                              <div className="flex space-x-2">
                                <button
                                  onClick={() => updateClient(client.id)}
                                  className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                                >
                                  保存
                                </button>
                                <button
                                  onClick={() => setEditingClient(null)}
                                  className="px-3 py-1 bg-gray-300 text-gray-700 text-sm rounded hover:bg-gray-400"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex-1">
                                <div className="flex items-center space-x-4">
                                  <div>
                                    <p className="text-sm font-medium text-gray-900">
                                      {client.client_name}
                                    </p>
                                    <p className="text-sm text-gray-500">{client.client_description}</p>
                                    <p className="text-xs text-gray-400">
                                      所有者: {client.owner?.username} | ID: {client.client_id}
                                    </p>
                                  </div>
                                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                    client.is_active 
                                      ? 'bg-green-100 text-green-800' 
                                      : 'bg-red-100 text-red-800'
                                  }`}>
                                    {client.is_active ? '活跃' : '禁用'}
                                  </span>
                                </div>
                              </div>
                              <div className="flex space-x-2">
                                <button
                                  onClick={() => setEditingClient(client)}
                                  className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                                >
                                  编辑
                                </button>
                                <button
                                  onClick={() => deleteClient(client.id)}
                                  className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                                >
                                  删除
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {activeTab === 'logs' && (
              <div className="space-y-6">
                <h2 className="text-lg font-medium text-gray-900">登录日志</h2>

                <div className="bg-white shadow overflow-hidden sm:rounded-md">
                  {loginLogs.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">暂无登录日志</p>
                  ) : (
                    <ul className="divide-y divide-gray-200">
                      {loginLogs.map((log) => (
                        <li key={log.id} className="px-4 py-4">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center space-x-4">
                                <div>
                                  <p className="text-sm font-medium text-gray-900">
                                    {log.username}
                                  </p>
                                  <p className="text-sm text-gray-500">
                                    {new Date(log.login_time).toLocaleString()}
                                  </p>
                                  <p className="text-xs text-gray-400">
                                    {log.ip_address} | {log.login_method}
                                    {log.client_name && ` | 通过 ${log.client_name}`}
                                  </p>
                                </div>
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  log.success 
                                    ? 'bg-green-100 text-green-800' 
                                    : 'bg-red-100 text-red-800'
                                }`}>
                                  {log.success ? '成功' : '失败'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}