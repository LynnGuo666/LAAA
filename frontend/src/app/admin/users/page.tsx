'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api';

interface User {
  id: string;
  email: string;
  username: string;
  full_name?: string;
  given_name?: string;
  family_name?: string;
  nickname?: string;
  phone_number?: string;
  website?: string;
  gender?: string;
  birthdate?: string;
  locale?: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
}

export default function UserManagePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');

  // Form state
  const [userForm, setUserForm] = useState({
    email: '',
    username: '',
    password: '',
    full_name: '',
    given_name: '',
    family_name: '',
    nickname: '',
    phone_number: '',
    website: '',
    gender: '',
    birthdate: '',
    locale: '',
    is_admin: false,
    is_active: true
  });

  useEffect(() => {
    checkAdmin();
    loadUsers();
  }, []);

  const checkAdmin = async () => {
    try {
      const response = await fetch('/api/v1/users/me', {
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
      } else {
        router.push('/login');
        return;
      }
    } catch (error) {
      console.error('Failed to check admin status:', error);
      router.push('/login');
      return;
    }
    setLoading(false);
  };

  const loadUsers = async () => {
    try {
      const data = await authApi.getAllUsers();
      setUsers(data);
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  };

  const handleCreate = () => {
    setMode('create');
    setUserForm({
      email: '',
      username: '',
      password: '',
      full_name: '',
      given_name: '',
      family_name: '',
      nickname: '',
      phone_number: '',
      website: '',
      gender: '',
      birthdate: '',
      locale: '',
      is_admin: false,
      is_active: true
    });
  };

  const handleEdit = (user: User) => {
    setMode('edit');
    setSelectedUser(user);
    setUserForm({
      email: user.email,
      username: user.username,
      password: '',
      full_name: user.full_name || '',
      given_name: user.given_name || '',
      family_name: user.family_name || '',
      nickname: user.nickname || '',
      phone_number: user.phone_number || '',
      website: user.website || '',
      gender: user.gender || '',
      birthdate: user.birthdate || '',
      locale: user.locale || '',
      is_admin: user.is_admin,
      is_active: user.is_active
    });
  };

  const handleSubmit = async () => {
    if (!userForm.email || !userForm.username) {
      alert('请填写邮箱和用户名');
      return;
    }

    if (mode === 'create' && !userForm.password) {
      alert('请填写密码');
      return;
    }

    setSaving(true);
    try {
      if (mode === 'create') {
        await authApi.register(userForm);
        alert('用户创建成功！');
      } else if (mode === 'edit' && selectedUser) {
        const updateData = { ...userForm };
        if (!updateData.password) {
          delete updateData.password; // Don't send empty password
        }
        await authApi.updateUser(selectedUser.id, updateData);
        alert('用户更新成功！');
      }
      
      setMode('list');
      loadUsers();
    } catch (error: any) {
      console.error('Failed to save user:', error);
      alert(error.response?.data?.detail || '操作失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (userId: string, username: string) => {
    if (!confirm(`确定要删除用户 "${username}" 吗？此操作不可撤销。`)) {
      return;
    }

    try {
      await authApi.deleteUser(userId);
      alert('用户删除成功！');
      loadUsers();
    } catch (error: any) {
      console.error('Failed to delete user:', error);
      alert(error.response?.data?.detail || '删除失败，请重试');
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
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/admin/dashboard')}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h1 className="text-2xl font-bold text-gray-900">
                {mode === 'list' ? '用户管理' : mode === 'create' ? '创建用户' : '编辑用户'}
              </h1>
            </div>
            {mode === 'list' && (
              <button
                onClick={handleCreate}
                className="btn-primary"
              >
                创建用户
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {mode === 'list' && (
            <div className="bg-white shadow overflow-hidden sm:rounded-md">
              <ul className="divide-y divide-gray-200">
                {users.map((user) => (
                  <li key={user.id}>
                    <div className="px-4 py-4 flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-4">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">
                              {user.full_name || user.username}
                            </p>
                            <p className="text-sm text-gray-500">{user.email}</p>
                            <p className="text-xs text-gray-400">
                              创建时间: {new Date(user.created_at).toLocaleString()}
                            </p>
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
                          onClick={() => handleEdit(user)}
                          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(user.id, user.username)}
                          className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(mode === 'create' || mode === 'edit') && (
            <div className="bg-white shadow sm:rounded-lg">
              <div className="px-4 py-5 sm:p-6">
                <div className="grid grid-cols-1 gap-6">
                  {/* Basic Info */}
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">基本信息</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">邮箱 *</label>
                        <input
                          type="email"
                          value={userForm.email}
                          onChange={(e) => setUserForm({...userForm, email: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">用户名 *</label>
                        <input
                          type="text"
                          value={userForm.username}
                          onChange={(e) => setUserForm({...userForm, username: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      {mode === 'create' && (
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700">密码 *</label>
                          <input
                            type="password"
                            value={userForm.password}
                            onChange={(e) => setUserForm({...userForm, password: e.target.value})}
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          />
                        </div>
                      )}
                      {mode === 'edit' && (
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700">新密码 (留空则不修改)</label>
                          <input
                            type="password"
                            value={userForm.password}
                            onChange={(e) => setUserForm({...userForm, password: e.target.value})}
                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                            placeholder="留空则不修改密码"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Personal Info */}
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">个人信息</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">全名</label>
                        <input
                          type="text"
                          value={userForm.full_name}
                          onChange={(e) => setUserForm({...userForm, full_name: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">昵称</label>
                        <input
                          type="text"
                          value={userForm.nickname}
                          onChange={(e) => setUserForm({...userForm, nickname: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">名字</label>
                        <input
                          type="text"
                          value={userForm.given_name}
                          onChange={(e) => setUserForm({...userForm, given_name: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">姓氏</label>
                        <input
                          type="text"
                          value={userForm.family_name}
                          onChange={(e) => setUserForm({...userForm, family_name: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Contact Info */}
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">联系信息</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">手机号码</label>
                        <input
                          type="tel"
                          value={userForm.phone_number}
                          onChange={(e) => setUserForm({...userForm, phone_number: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">个人网站</label>
                        <input
                          type="url"
                          value={userForm.website}
                          onChange={(e) => setUserForm({...userForm, website: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Personal Details */}
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">个人详情</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">性别</label>
                        <select
                          value={userForm.gender}
                          onChange={(e) => setUserForm({...userForm, gender: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="">选择性别</option>
                          <option value="male">男</option>
                          <option value="female">女</option>
                          <option value="other">其他</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">出生日期</label>
                        <input
                          type="date"
                          value={userForm.birthdate}
                          onChange={(e) => setUserForm({...userForm, birthdate: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">语言</label>
                        <select
                          value={userForm.locale}
                          onChange={(e) => setUserForm({...userForm, locale: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="">选择语言</option>
                          <option value="zh-CN">中文（简体）</option>
                          <option value="zh-TW">中文（繁體）</option>
                          <option value="en-US">English (US)</option>
                          <option value="en-GB">English (UK)</option>
                          <option value="ja-JP">日本語</option>
                          <option value="ko-KR">한국어</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Account Settings */}
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">账户设置</h3>
                    <div className="space-y-4">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id="is_active"
                          checked={userForm.is_active}
                          onChange={(e) => setUserForm({...userForm, is_active: e.target.checked})}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900">
                          启用账户
                        </label>
                      </div>
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id="is_admin"
                          checked={userForm.is_admin}
                          onChange={(e) => setUserForm({...userForm, is_admin: e.target.checked})}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="is_admin" className="ml-2 block text-sm text-gray-900">
                          管理员权限
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-8 flex justify-end space-x-3">
                  <button
                    onClick={() => setMode('list')}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? '保存中...' : (mode === 'create' ? '创建用户' : '更新用户')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}