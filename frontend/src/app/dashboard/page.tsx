'use client';

import { useAuth } from '../../lib/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function DashboardPage() {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/auth/login');
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const getSecurityLevelText = (level: number) => {
    const levels = { 1: '低级', 2: '中级', 3: '高级', 4: '管理员级' };
    return levels[level as keyof typeof levels] || '未知';
  };

  const getSecurityLevelColor = (level: number) => {
    const colors = {
      1: 'bg-gray-100 text-gray-800',
      2: 'bg-blue-100 text-blue-800',
      3: 'bg-yellow-100 text-yellow-800',
      4: 'bg-red-100 text-red-800'
    };
    return colors[level as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 头部导航 */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-blue-600 rounded-lg mr-3"></div>
              <h1 className="text-xl font-semibold text-gray-900">LAAA 控制台</h1>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">
                欢迎，{user.username}
              </span>
              <button
                onClick={logout}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 主要内容 */}
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-gray-900 mb-2">用户概览</h2>
          <p className="text-gray-600">您的账户信息和安全状态</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* 用户信息卡片 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">基本信息</h3>
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <dt className="text-sm text-gray-500">用户名</dt>
                <dd className="text-sm font-medium text-gray-900">{user.username}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">邮箱</dt>
                <dd className="text-sm font-medium text-gray-900">{user.email}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">账户状态</dt>
                <dd className="flex items-center text-sm">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                    {user.is_active ? '活跃' : '已停用'}
                  </span>
                </dd>
              </div>
            </div>
          </div>

          {/* 安全等级卡片 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">安全等级</h3>
              <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <dt className="text-sm text-gray-500">当前等级</dt>
                <dd className="text-sm">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getSecurityLevelColor(user.security_level)}`}>
                    等级 {user.security_level} - {getSecurityLevelText(user.security_level)}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">两步验证</dt>
                <dd className="text-sm">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.totp_enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                    {user.totp_enabled ? '已启用' : '未启用'}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">邮箱验证</dt>
                <dd className="text-sm">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.email_verified ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                    {user.email_verified ? '已验证' : '待验证'}
                  </span>
                </dd>
              </div>
            </div>
          </div>

          {/* 登录信息卡片 */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">登录信息</h3>
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <dt className="text-sm text-gray-500">最后登录</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {user.last_login_at ? new Date(user.last_login_at).toLocaleString('zh-CN') : '从未登录'}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">注册时间</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {new Date(user.created_at).toLocaleString('zh-CN')}
                </dd>
              </div>
            </div>
          </div>
        </div>

        {/* 快捷操作 */}
        <div className="mt-8">
          <h3 className="text-lg font-medium text-gray-900 mb-4">快捷操作</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <button className="p-4 text-left bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mb-3">
                <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
                </svg>
              </div>
              <h4 className="font-medium text-gray-900">安全设置</h4>
              <p className="text-sm text-gray-500 mt-1">管理密码和两步验证</p>
            </button>

            <button className="p-4 text-left bg-white rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors">
              <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center mb-3">
                <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h4 className="font-medium text-gray-900">设备管理</h4>
              <p className="text-sm text-gray-500 mt-1">查看和管理登录设备</p>
            </button>

            <button className="p-4 text-left bg-white rounded-xl border border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-colors">
              <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center mb-3">
                <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <h4 className="font-medium text-gray-900">应用授权</h4>
              <p className="text-sm text-gray-500 mt-1">管理已授权的应用</p>
            </button>

            <button className="p-4 text-left bg-white rounded-xl border border-gray-200 hover:border-green-300 hover:bg-green-50 transition-colors">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center mb-3">
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h4 className="font-medium text-gray-900">操作日志</h4>
              <p className="text-sm text-gray-500 mt-1">查看账户操作记录</p>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}