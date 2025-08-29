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
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);

  useEffect(() => {
    checkAdmin();
  }, []);

  useEffect(() => {
    if (activeTab === 'overview') {
      loadStats();
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
                onClick={() => router.push('/admin/users')}
                className="btn-secondary"
              >
                用户管理
              </button>
              <button
                onClick={() => router.push('/admin/applications')}
                className="btn-secondary"
              >
                应用管理
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