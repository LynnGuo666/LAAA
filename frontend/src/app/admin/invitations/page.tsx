'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../../lib/auth';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../../lib/api';
import { InvitationCode } from '../../../types/auth';
import Link from 'next/link';

export default function AdminInvitationsPage() {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const [invitationCodes, setInvitationCodes] = useState<InvitationCode[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isLoading && (!user || !user.is_superuser)) {
      router.push('/dashboard');
    }
  }, [user, isLoading, router]);

  const loadInvitationCodes = async () => {
    if (!user?.is_superuser) return;
    
    setLoadingData(true);
    try {
      const codesData = await apiClient.getInvitationCodes(false); // 获取所有邀请码包括已失效的
      setInvitationCodes(codesData);
    } catch (error) {
      console.error('Failed to load invitation codes:', error);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (user?.is_superuser) {
      loadInvitationCodes();
    }
  }, [user]);

  const createInvitationCode = async () => {
    setCreating(true);
    try {
      await apiClient.createInvitationCode({
        security_level: 1,
        max_uses: 10,
        expire_days: 7
      });
      loadInvitationCodes();
    } catch (error) {
      console.error('Failed to create invitation code:', error);
    } finally {
      setCreating(false);
    }
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

  if (isLoading || loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user?.is_superuser) {
    return null;
  }

  const activeCodes = invitationCodes.filter(code => code.is_active);
  const expiredCodes = invitationCodes.filter(code => !code.is_active || new Date(code.expires_at) < new Date());

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航栏 */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Link href="/dashboard" className="flex items-center">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl mr-3"></div>
                <h1 className="text-xl font-bold text-gray-900">LAAA 控制台</h1>
              </Link>
              <span className="ml-3 px-2 py-1 bg-red-100 text-red-800 text-xs font-semibold rounded-full">管理员</span>
            </div>
            
            {/* 管理员菜单 */}
            <nav className="hidden md:flex space-x-8">
              <Link href="/admin/users" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                👥 用户管理
              </Link>
              <Link href="/admin/invitations" className="text-green-600 border-b-2 border-green-500 px-3 py-2 text-sm font-medium">
                🎫 邀请码
              </Link>
              <Link href="/admin/applications" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                📱 应用管理
              </Link>
              <Link href="/admin/settings" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                ⚙️ 系统设置
              </Link>
            </nav>

            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-700">欢迎，{user.username}</span>
              <button
                onClick={logout}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors px-3 py-1 rounded-lg hover:bg-gray-100"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex justify-between items-center">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">邀请码管理</h2>
            <p className="text-gray-600">创建和管理用户注册邀请码</p>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={loadInvitationCodes}
              disabled={loadingData}
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-xl font-medium transition-colors disabled:opacity-50"
            >
              {loadingData ? '刷新中...' : '刷新数据'}
            </button>
            <button
              onClick={createInvitationCode}
              disabled={creating}
              className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-xl font-medium transition-colors disabled:opacity-50"
            >
              {creating ? '创建中...' : '创建邀请码'}
            </button>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">总邀请码</p>
                <p className="text-2xl font-bold text-gray-900">{invitationCodes.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">活跃邀请码</p>
                <p className="text-2xl font-bold text-gray-900">{activeCodes.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">总使用次数</p>
                <p className="text-2xl font-bold text-gray-900">
                  {invitationCodes.reduce((sum, code) => sum + code.current_uses, 0)}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">即将过期</p>
                <p className="text-2xl font-bold text-gray-900">
                  {activeCodes.filter(code => {
                    const expiresIn = (new Date(code.expires_at).getTime() - new Date().getTime()) / (1000 * 3600 * 24);
                    return expiresIn <= 1 && expiresIn > 0;
                  }).length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 邀请码表格 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">邀请码列表</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    邀请码
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    使用情况
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    安全等级
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    过期时间
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    状态
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    创建时间
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {invitationCodes.map((code) => {
                  const isExpired = new Date(code.expires_at) < new Date();
                  const expiresIn = Math.ceil((new Date(code.expires_at).getTime() - new Date().getTime()) / (1000 * 3600 * 24));
                  const isExpiringSoon = expiresIn <= 1 && expiresIn > 0;
                  
                  return (
                    <tr key={code.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="text-sm font-mono font-medium text-gray-900 bg-gray-100 px-3 py-1 rounded-lg">
                            {code.code}
                          </div>
                          <button
                            onClick={() => navigator.clipboard.writeText(code.code)}
                            className="ml-2 p-1 text-gray-400 hover:text-gray-600"
                            title="复制邀请码"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-1 bg-gray-200 rounded-full h-2 mr-3">
                            <div
                              className="bg-blue-500 h-2 rounded-full"
                              style={{ width: `${(code.current_uses / code.max_uses) * 100}%` }}
                            ></div>
                          </div>
                          <span className="text-sm text-gray-900">
                            {code.current_uses} / {code.max_uses}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getSecurityLevelColor(code.security_level)}`}>
                          等级 {code.security_level}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div>
                          <div>{new Date(code.expires_at).toLocaleDateString('zh-CN')}</div>
                          {!isExpired && (
                            <div className={`text-xs ${isExpiringSoon ? 'text-red-600' : 'text-gray-400'}`}>
                              {expiresIn > 0 ? `${expiresIn}天后过期` : '今天过期'}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          code.is_active && !isExpired 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {code.is_active && !isExpired ? '有效' : '已失效'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(code.created_at).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                        {code.is_active && !isExpired ? (
                          <button className="text-red-600 hover:text-red-900">停用</button>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}