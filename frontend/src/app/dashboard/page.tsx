'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  email: string;
  username: string;
  full_name?: string;
  given_name?: string;
  family_name?: string;
  nickname?: string;
  profile?: string;
  picture?: string;
  website?: string;
  phone_number?: string;
  gender?: string;
  birthdate?: string;
  zoneinfo?: string;
  locale?: string;
  is_admin: boolean;
  created_at: string;
  updated_at?: string;
}

interface LoginLog {
  id: string;
  login_time: string;
  ip_address: string;
  user_agent: string;
  login_method: string;
  success: boolean;
  client_name?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
  const [activeTab, setActiveTab] = useState('profile');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Profile form states
  const [profileForm, setProfileForm] = useState({
    full_name: '',
    given_name: '',
    family_name: '',
    nickname: '',
    profile: '',
    picture: '',
    website: '',
    phone_number: '',
    gender: '',
    birthdate: '',
    zoneinfo: '',
    locale: ''
  });

  // Password form states
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });

  useEffect(() => {
    loadProfile();
    loadLoginLogs();
  }, []);

  const loadProfile = async () => {
    try {
      const response = await fetch('/api/v1/dashboard/profile', {
        headers: {
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        }
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        setProfileForm({
          full_name: userData.full_name || '',
          given_name: userData.given_name || '',
          family_name: userData.family_name || '',
          nickname: userData.nickname || '',
          profile: userData.profile || '',
          picture: userData.picture || '',
          website: userData.website || '',
          phone_number: userData.phone_number || '',
          gender: userData.gender || '',
          birthdate: userData.birthdate || '',
          zoneinfo: userData.zoneinfo || '',
          locale: userData.locale || ''
        });
      } else if (response.status === 401) {
        router.push('/login');
      }
    } catch (error) {
      console.error('Failed to load profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadLoginLogs = async () => {
    try {
      const response = await fetch('/api/v1/dashboard/logs/my', {
        headers: {
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        }
      });

      if (response.ok) {
        const logs = await response.json();
        setLoginLogs(logs);
      }
    } catch (error) {
      console.error('Failed to load login logs:', error);
    }
  };

  const updateProfile = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/v1/dashboard/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        },
        body: JSON.stringify(profileForm)
      });

      if (response.ok) {
        alert('资料更新成功！');
        loadProfile();
      } else {
        const error = await response.json();
        alert(error.detail || '更新失败');
      }
    } catch (error) {
      console.error('Failed to update profile:', error);
      alert('更新失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      alert('新密码与确认密码不一致');
      return;
    }

    if (passwordForm.new_password.length < 8) {
      alert('新密码至少需要8个字符');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/v1/dashboard/profile/password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        },
        body: JSON.stringify({
          current_password: passwordForm.current_password,
          new_password: passwordForm.new_password
        })
      });

      if (response.ok) {
        alert('密码修改成功！');
        setPasswordForm({
          current_password: '',
          new_password: '',
          confirm_password: ''
        });
      } else {
        const error = await response.json();
        alert(error.detail || '密码修改失败');
      }
    } catch (error) {
      console.error('Failed to change password:', error);
      alert('密码修改失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const logout = () => {
    document.cookie = 'access_token=; Max-Age=0; path=/';
    router.push('/login');
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

  if (!user) {
    return (
      <div className="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">加载失败</h2>
          <button 
            onClick={() => router.push('/login')}
            className="mt-4 btn-primary"
          >
            重新登录
          </button>
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
              <h1 className="text-2xl font-bold text-gray-900">
                欢迎，{user.full_name || user.username}
              </h1>
              <p className="text-sm text-gray-600">
                {user.is_admin && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 mr-2">
                    管理员
                  </span>
                )}
                上次登录: {loginLogs[0] ? new Date(loginLogs[0].login_time).toLocaleString() : '暂无记录'}
              </p>
            </div>
            <div className="flex space-x-3">
              {user.is_admin && (
                <button
                  onClick={() => router.push('/admin/permissions')}
                  className="btn-secondary"
                >
                  管理后台
                </button>
              )}
              <button onClick={logout} className="btn-primary">
                退出登录
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
              <button
                onClick={() => setActiveTab('profile')}
                className={`${
                  activeTab === 'profile'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm`}
              >
                个人资料
              </button>
              <button
                onClick={() => setActiveTab('password')}
                className={`${
                  activeTab === 'password'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm`}
              >
                修改密码
              </button>
              <button
                onClick={() => setActiveTab('logs')}
                className={`${
                  activeTab === 'logs'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm`}
              >
                登录记录
              </button>
            </nav>
          </div>

          {/* Tab Content */}
          <div className="mt-6">
            {activeTab === 'profile' && (
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-6">个人资料</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">全名</label>
                    <input
                      type="text"
                      value={profileForm.full_name}
                      onChange={(e) => setProfileForm({...profileForm, full_name: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">昵称</label>
                    <input
                      type="text"
                      value={profileForm.nickname}
                      onChange={(e) => setProfileForm({...profileForm, nickname: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">名字</label>
                    <input
                      type="text"
                      value={profileForm.given_name}
                      onChange={(e) => setProfileForm({...profileForm, given_name: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">姓氏</label>
                    <input
                      type="text"
                      value={profileForm.family_name}
                      onChange={(e) => setProfileForm({...profileForm, family_name: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">手机号码</label>
                    <input
                      type="tel"
                      value={profileForm.phone_number}
                      onChange={(e) => setProfileForm({...profileForm, phone_number: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">性别</label>
                    <select
                      value={profileForm.gender}
                      onChange={(e) => setProfileForm({...profileForm, gender: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">请选择</option>
                      <option value="male">男</option>
                      <option value="female">女</option>
                      <option value="other">其他</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">生日</label>
                    <input
                      type="date"
                      value={profileForm.birthdate}
                      onChange={(e) => setProfileForm({...profileForm, birthdate: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">网站</label>
                    <input
                      type="url"
                      value={profileForm.website}
                      onChange={(e) => setProfileForm({...profileForm, website: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">头像URL</label>
                    <input
                      type="url"
                      value={profileForm.picture}
                      onChange={(e) => setProfileForm({...profileForm, picture: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">个人简介</label>
                    <textarea
                      rows={3}
                      value={profileForm.profile}
                      onChange={(e) => setProfileForm({...profileForm, profile: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="mt-6">
                  <button
                    onClick={updateProfile}
                    disabled={saving}
                    className="btn-primary disabled:opacity-50"
                  >
                    {saving ? '保存中...' : '保存更改'}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'password' && (
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-6">修改密码</h2>
                <div className="max-w-md space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">当前密码</label>
                    <input
                      type="password"
                      value={passwordForm.current_password}
                      onChange={(e) => setPasswordForm({...passwordForm, current_password: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">新密码</label>
                    <input
                      type="password"
                      value={passwordForm.new_password}
                      onChange={(e) => setPasswordForm({...passwordForm, new_password: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">确认新密码</label>
                    <input
                      type="password"
                      value={passwordForm.confirm_password}
                      onChange={(e) => setPasswordForm({...passwordForm, confirm_password: e.target.value})}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <button
                    onClick={changePassword}
                    disabled={saving || !passwordForm.current_password || !passwordForm.new_password || !passwordForm.confirm_password}
                    className="btn-primary disabled:opacity-50"
                  >
                    {saving ? '修改中...' : '修改密码'}
                  </button>
                </div>
              </div>
            )}

            {activeTab === 'logs' && (
              <div className="bg-white shadow rounded-lg p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-6">登录记录</h2>
                {loginLogs.length === 0 ? (
                  <p className="text-gray-500 text-center py-4">暂无登录记录</p>
                ) : (
                  <div className="space-y-4">
                    {loginLogs.map((log) => (
                      <div key={log.id} className="border rounded-lg p-4">
                        <div className="flex justify-between items-start">
                          <div className="space-y-1">
                            <div className="flex items-center space-x-2">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                log.success 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {log.success ? '成功' : '失败'}
                              </span>
                              <span className="text-sm text-gray-600">{log.login_method}</span>
                              {log.client_name && (
                                <span className="text-xs text-gray-500">通过 {log.client_name}</span>
                              )}
                            </div>
                            <div className="text-sm text-gray-900">
                              {new Date(log.login_time).toLocaleString()}
                            </div>
                            <div className="text-xs text-gray-500">
                              IP: {log.ip_address}
                            </div>
                            <div className="text-xs text-gray-500">
                              {log.user_agent}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}