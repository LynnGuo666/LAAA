'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '../../../lib/auth';
import { useRouter } from 'next/navigation';
import { apiClient } from '../../../lib/api';
import { Application } from '../../../types/auth';
import Link from 'next/link';

interface ApplicationFormData {
  name: string;
  description: string;
  logo_url: string;
  website_url: string;
  support_email: string;
  privacy_policy_url: string;
  terms_of_service_url: string;
  redirect_uris: string;
  required_security_level: number;
  require_mfa: boolean;
}

interface AppUser {
  id: string;
  username: string;
  email: string;
  security_level: number;
  is_active: boolean;
  granted_at: string;
}

interface AvailableUser {
  id: string;
  username: string;
  email: string;
  security_level: number;
}

export default function AdminApplicationsPage() {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const [applications, setApplications] = useState<Application[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingApp, setEditingApp] = useState<Application | null>(null);
  const [showUserModal, setShowUserModal] = useState<string | null>(null);
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [managingAccess, setManagingAccess] = useState(false);
  const [formData, setFormData] = useState<ApplicationFormData>({
    name: '',
    description: '',
    logo_url: '',
    website_url: '',
    support_email: '',
    privacy_policy_url: '',
    terms_of_service_url: '',
    redirect_uris: '',
    required_security_level: 1,
    require_mfa: false
  });

  useEffect(() => {
    if (!isLoading && (!user || !user.is_superuser)) {
      router.push('/dashboard');
    }
  }, [user, isLoading, router]);

  const loadApplications = async () => {
    if (!user?.is_superuser) return;
    
    setLoadingData(true);
    try {
      const appsData = await apiClient.getApplications();
      setApplications(appsData);
    } catch (error) {
      console.error('Failed to load applications:', error);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (user?.is_superuser) {
      loadApplications();
    }
  }, [user]);

  const handleCreateApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    
    try {
      await apiClient.createApplication({
        name: formData.name,
        description: formData.description || undefined,
        logo_url: formData.logo_url || undefined,
        website_url: formData.website_url || undefined,
        support_email: formData.support_email || undefined,
        privacy_policy_url: formData.privacy_policy_url || undefined,
        terms_of_service_url: formData.terms_of_service_url || undefined,
        redirect_uris: formData.redirect_uris.split('\n').filter(uri => uri.trim()),
        required_security_level: formData.required_security_level,
        require_mfa: formData.require_mfa
      });
      
      setShowCreateModal(false);
      setFormData({
        name: '',
        description: '',
        logo_url: '',
        website_url: '',
        support_email: '',
        privacy_policy_url: '',
        terms_of_service_url: '',
        redirect_uris: '',
        required_security_level: 1,
        require_mfa: false
      });
      loadApplications();
    } catch (error) {
      console.error('Failed to create application:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleEditApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingApp) return;
    
    setCreating(true);
    
    try {
      await apiClient.updateApplication(editingApp.id, {
        name: formData.name,
        description: formData.description || undefined,
        redirect_uris: formData.redirect_uris.split('\n').filter(uri => uri.trim()),
        required_security_level: formData.required_security_level,
        require_mfa: formData.require_mfa
      });
      
      setEditingApp(null);
      loadApplications();
    } catch (error) {
      console.error('Failed to update application:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteApplication = async (appId: string) => {
    if (!confirm('确认删除此应用？此操作不可撤销。')) return;
    
    try {
      await apiClient.deleteApplication(appId);
      loadApplications();
    } catch (error) {
      console.error('Failed to delete application:', error);
    }
  };

  const openEditModal = (app: Application) => {
    setEditingApp(app);
    setFormData({
      name: app.name,
      description: app.description || '',
      redirect_uris: app.redirect_uris.join('\n'),
      required_security_level: app.required_security_level,
      require_mfa: app.require_mfa
    });
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setEditingApp(null);
    setFormData({
      name: '',
      description: '',
      redirect_uris: '',
      required_security_level: 1,
      require_mfa: false
    });
  };

  const loadApplicationUsers = async (appId: string) => {
    setLoadingUsers(true);
    try {
      const [usersData, availableData] = await Promise.all([
        apiClient.getApplicationUsers(appId),
        apiClient.getAvailableUsersForApplication(appId)
      ]);
      setAppUsers(usersData.users);
      setAvailableUsers(availableData.users);
    } catch (error) {
      console.error('Failed to load application users:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  const openUserModal = async (appId: string) => {
    setShowUserModal(appId);
    await loadApplicationUsers(appId);
  };

  const closeUserModal = () => {
    setShowUserModal(null);
    setAppUsers([]);
    setAvailableUsers([]);
  };

  const handleGrantAccess = async (appId: string, userId: string) => {
    setManagingAccess(true);
    try {
      await apiClient.grantApplicationAccess(appId, userId);
      await loadApplicationUsers(appId);
    } catch (error) {
      console.error('Failed to grant access:', error);
    } finally {
      setManagingAccess(false);
    }
  };

  const handleRevokeAccess = async (appId: string, userId: string) => {
    if (!confirm('确认撤销该用户的访问权限？')) return;
    
    setManagingAccess(true);
    try {
      await apiClient.revokeApplicationAccess(appId, userId);
      await loadApplicationUsers(appId);
    } catch (error) {
      console.error('Failed to revoke access:', error);
    } finally {
      setManagingAccess(false);
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
              <Link href="/admin/invitations" className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-md text-sm font-medium transition-colors">
                🎫 邀请码
              </Link>
              <Link href="/admin/applications" className="text-purple-600 border-b-2 border-purple-500 px-3 py-2 text-sm font-medium">
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
            <h2 className="text-3xl font-bold text-gray-900 mb-2">OAuth2 应用管理</h2>
            <p className="text-gray-600">管理接入的OAuth2应用程序和客户端</p>
          </div>
          <div className="flex space-x-3">
            <button
              onClick={loadApplications}
              disabled={loadingData}
              className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-xl font-medium transition-colors disabled:opacity-50"
            >
              {loadingData ? '刷新中...' : '刷新数据'}
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-xl font-medium transition-colors"
            >
              创建应用
            </button>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">总应用数</p>
                <p className="text-2xl font-bold text-gray-900">{applications.length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">活跃应用</p>
                <p className="text-2xl font-bold text-gray-900">{applications.filter(app => app.is_active).length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">需要MFA</p>
                <p className="text-2xl font-bold text-gray-900">{applications.filter(app => app.require_mfa).length}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">高级应用</p>
                <p className="text-2xl font-bold text-gray-900">{applications.filter(app => app.required_security_level >= 3).length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* 应用列表表格 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">OAuth2 应用列表</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    应用信息
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Client ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    安全设置
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    回调地址
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
                {applications.map((app) => (
                  <tr key={app.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div>
                        <div className="text-sm font-medium text-gray-900">{app.name}</div>
                        {app.description && (
                          <div className="text-sm text-gray-500">{app.description}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="text-sm font-mono font-medium text-gray-900 bg-gray-100 px-3 py-1 rounded-lg">
                          {app.client_id}
                        </div>
                        <button
                          onClick={() => navigator.clipboard.writeText(app.client_id)}
                          className="ml-2 p-1 text-gray-400 hover:text-gray-600"
                          title="复制Client ID"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex flex-col space-y-1">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getSecurityLevelColor(app.required_security_level)}`}>
                          安全等级 {app.required_security_level}
                        </span>
                        {app.require_mfa && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                            需要MFA
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">
                        {app.redirect_uris.length > 0 ? (
                          <div className="space-y-1">
                            {app.redirect_uris.slice(0, 2).map((uri, index) => (
                              <div key={index} className="text-xs bg-gray-100 px-2 py-1 rounded">
                                {uri}
                              </div>
                            ))}
                            {app.redirect_uris.length > 2 && (
                              <div className="text-xs text-gray-500">
                                +{app.redirect_uris.length - 2} 个更多
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-500">无</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        app.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {app.is_active ? '活跃' : '已停用'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(app.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex space-x-2">
                        <button
                          onClick={() => openUserModal(app.id)}
                          className="text-green-600 hover:text-green-900"
                        >
                          用户授权
                        </button>
                        <button
                          onClick={() => openEditModal(app)}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDeleteApplication(app.id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 创建/编辑应用弹窗 */}
      {(showCreateModal || editingApp) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-screen overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-gray-900">
                  {editingApp ? '编辑应用' : '创建OAuth2应用'}
                </h3>
                <button
                  onClick={closeModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={editingApp ? handleEditApplication : handleCreateApplication}>
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      应用名称 *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="输入应用名称"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      应用描述
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="输入应用描述"
                      rows={3}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      回调地址
                    </label>
                    <textarea
                      value={formData.redirect_uris}
                      onChange={(e) => setFormData({ ...formData, redirect_uris: e.target.value })}
                      className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="每行一个URL，例如：&#10;https://example.com/callback&#10;https://app.example.com/auth/callback"
                      rows={4}
                    />
                    <p className="text-sm text-gray-500 mt-1">每行输入一个回调URL</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        所需安全等级
                      </label>
                      <select
                        value={formData.required_security_level}
                        onChange={(e) => setFormData({ ...formData, required_security_level: parseInt(e.target.value) })}
                        className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      >
                        <option value={1}>等级 1 (普通)</option>
                        <option value={2}>等级 2 (中级)</option>
                        <option value={3}>等级 3 (高级)</option>
                        <option value={4}>等级 4 (管理员)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        多因子认证
                      </label>
                      <div className="flex items-center space-x-3 p-3">
                        <input
                          type="checkbox"
                          id="require_mfa"
                          checked={formData.require_mfa}
                          onChange={(e) => setFormData({ ...formData, require_mfa: e.target.checked })}
                          className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                        />
                        <label htmlFor="require_mfa" className="text-sm text-gray-700">
                          要求用户启用MFA才能访问
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end space-x-3 mt-8">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-6 py-3 text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="px-6 py-3 bg-purple-500 text-white rounded-xl hover:bg-purple-600 transition-colors disabled:opacity-50"
                  >
                    {creating ? '保存中...' : (editingApp ? '更新应用' : '创建应用')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* 用户授权管理弹窗 */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-screen overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-gray-900">
                  应用用户授权管理
                </h3>
                <button
                  onClick={closeUserModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {loadingUsers ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 已授权用户列表 */}
                  <div className="bg-green-50 rounded-xl p-6">
                    <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                      <svg className="w-5 h-5 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      已授权用户 ({appUsers.length})
                    </h4>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {appUsers.length === 0 ? (
                        <p className="text-gray-500 text-center py-4">暂无用户被授权访问此应用</p>
                      ) : (
                        appUsers.map((user) => (
                          <div key={user.id} className="bg-white rounded-lg p-4 flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center">
                                <h5 className="font-medium text-gray-900">{user.username}</h5>
                                <span className={`ml-2 px-2 py-1 text-xs rounded-full ${
                                  user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                }`}>
                                  {user.is_active ? '活跃' : '停用'}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600">{user.email}</p>
                              <p className="text-xs text-gray-500">
                                安全等级: {user.security_level} | 授权时间: {new Date(user.granted_at).toLocaleDateString('zh-CN')}
                              </p>
                            </div>
                            <button
                              onClick={() => handleRevokeAccess(showUserModal, user.id)}
                              disabled={managingAccess}
                              className="ml-3 px-3 py-1 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50"
                            >
                              撤销
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* 可授权用户列表 */}
                  <div className="bg-blue-50 rounded-xl p-6">
                    <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                      <svg className="w-5 h-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      可授权用户 ({availableUsers.length})
                    </h4>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {availableUsers.length === 0 ? (
                        <p className="text-gray-500 text-center py-4">所有用户都已被授权或无可用用户</p>
                      ) : (
                        availableUsers.map((user) => (
                          <div key={user.id} className="bg-white rounded-lg p-4 flex items-center justify-between">
                            <div className="flex-1">
                              <h5 className="font-medium text-gray-900">{user.username}</h5>
                              <p className="text-sm text-gray-600">{user.email}</p>
                              <p className="text-xs text-gray-500">安全等级: {user.security_level}</p>
                            </div>
                            <button
                              onClick={() => handleGrantAccess(showUserModal, user.id)}
                              disabled={managingAccess}
                              className="ml-3 px-3 py-1 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
                            >
                              授权
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end mt-6">
                <button
                  onClick={closeUserModal}
                  className="px-6 py-3 text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}