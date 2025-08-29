'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api';

interface ClientApplication {
  id: string;
  client_id: string;
  client_name: string;
  client_description?: string;
  client_uri?: string;
  logo_uri?: string;
  tos_uri?: string;
  policy_uri?: string;
  redirect_uris: string[];
  contacts: string[];
  scope?: string;
  response_types?: string;
  grant_types?: string;
  is_active: boolean;
  owner_id: string;
  created_at: string;
  owner?: {
    username: string;
    email: string;
  };
}

export default function ApplicationManagePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [applications, setApplications] = useState<ClientApplication[]>([]);
  const [selectedApplication, setSelectedApplication] = useState<ClientApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');

  // Form state
  const [applicationForm, setApplicationForm] = useState({
    client_name: '',
    client_description: '',
    client_uri: '',
    logo_uri: '',
    tos_uri: '',
    policy_uri: '',
    redirect_uris: [''],
    contacts: [''],
    scope: 'openid profile email',
    response_types: 'code',
    grant_types: 'authorization_code,refresh_token',
    is_active: true
  });

  useEffect(() => {
    checkAdmin();
    loadApplications();
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

  const loadApplications = async () => {
    try {
      const data = await authApi.getAllClients();
      setApplications(data);
    } catch (error) {
      console.error('Failed to load applications:', error);
    }
  };

  const handleCreate = () => {
    setMode('create');
    setApplicationForm({
      client_name: '',
      client_description: '',
      client_uri: '',
      logo_uri: '',
      tos_uri: '',
      policy_uri: '',
      redirect_uris: [''],
      contacts: [''],
      scope: 'openid profile email',
      response_types: 'code',
      grant_types: 'authorization_code,refresh_token',
      is_active: true
    });
  };

  const handleEdit = (application: ClientApplication) => {
    setMode('edit');
    setSelectedApplication(application);
    setApplicationForm({
      client_name: application.client_name,
      client_description: application.client_description || '',
      client_uri: application.client_uri || '',
      logo_uri: application.logo_uri || '',
      tos_uri: application.tos_uri || '',
      policy_uri: application.policy_uri || '',
      redirect_uris: Array.isArray(application.redirect_uris) ? application.redirect_uris : 
                    typeof application.redirect_uris === 'string' ? [application.redirect_uris] : [''],
      contacts: Array.isArray(application.contacts) ? application.contacts : 
               typeof application.contacts === 'string' ? [application.contacts] : [''],
      scope: application.scope || 'openid profile email',
      response_types: application.response_types || 'code',
      grant_types: application.grant_types || 'authorization_code,refresh_token',
      is_active: application.is_active
    });
  };

  const handleSubmit = async () => {
    if (!applicationForm.client_name) {
      alert('请填写应用名称');
      return;
    }

    if (applicationForm.redirect_uris.filter(uri => uri.trim()).length === 0) {
      alert('请至少添加一个重定向URI');
      return;
    }

    setSaving(true);
    try {
      const submitData = {
        ...applicationForm,
        redirect_uris: applicationForm.redirect_uris.filter(uri => uri.trim() !== ''),
        contacts: applicationForm.contacts.filter(contact => contact.trim() !== '')
      };

      if (mode === 'create') {
        await authApi.createClient(submitData);
        alert('应用创建成功！');
      } else if (mode === 'edit' && selectedApplication) {
        await authApi.updateClient(selectedApplication.id, submitData);
        alert('应用更新成功！');
      }
      
      setMode('list');
      loadApplications();
    } catch (error: any) {
      console.error('Failed to save application:', error);
      alert(error.response?.data?.detail || '操作失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (applicationId: string, applicationName: string) => {
    if (!confirm(`确定要删除应用 "${applicationName}" 吗？此操作不可撤销。`)) {
      return;
    }

    try {
      await authApi.deleteClient(applicationId);
      alert('应用删除成功！');
      loadApplications();
    } catch (error: any) {
      console.error('Failed to delete application:', error);
      alert(error.response?.data?.detail || '删除失败，请重试');
    }
  };

  const addRedirectUri = () => {
    setApplicationForm({
      ...applicationForm,
      redirect_uris: [...applicationForm.redirect_uris, '']
    });
  };

  const removeRedirectUri = (index: number) => {
    if (applicationForm.redirect_uris.length > 1) {
      const newUris = applicationForm.redirect_uris.filter((_, i) => i !== index);
      setApplicationForm({
        ...applicationForm,
        redirect_uris: newUris
      });
    }
  };

  const updateRedirectUri = (index: number, value: string) => {
    const newUris = [...applicationForm.redirect_uris];
    newUris[index] = value;
    setApplicationForm({
      ...applicationForm,
      redirect_uris: newUris
    });
  };

  const addContact = () => {
    setApplicationForm({
      ...applicationForm,
      contacts: [...applicationForm.contacts, '']
    });
  };

  const removeContact = (index: number) => {
    if (applicationForm.contacts.length > 1) {
      const newContacts = applicationForm.contacts.filter((_, i) => i !== index);
      setApplicationForm({
        ...applicationForm,
        contacts: newContacts
      });
    }
  };

  const updateContact = (index: number, value: string) => {
    const newContacts = [...applicationForm.contacts];
    newContacts[index] = value;
    setApplicationForm({
      ...applicationForm,
      contacts: newContacts
    });
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
                {mode === 'list' ? '应用管理' : mode === 'create' ? '创建应用' : '编辑应用'}
              </h1>
            </div>
            {mode === 'list' && (
              <button
                onClick={handleCreate}
                className="btn-primary"
              >
                创建应用
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
                {applications.map((app) => (
                  <li key={app.id}>
                    <div className="px-4 py-4 flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center space-x-4">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">
                              {app.client_name}
                            </p>
                            <p className="text-sm text-gray-500">{app.client_description}</p>
                            <p className="text-xs text-gray-400">
                              客户端ID: {app.client_id} | 所有者: {app.owner?.username}
                            </p>
                            <p className="text-xs text-gray-400">
                              创建时间: {new Date(app.created_at).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex space-x-2">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              app.is_active 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {app.is_active ? '活跃' : '禁用'}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={() => handleEdit(app)}
                          className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(app.id, app.client_name)}
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
                        <label className="block text-sm font-medium text-gray-700">应用名称 *</label>
                        <input
                          type="text"
                          value={applicationForm.client_name}
                          onChange={(e) => setApplicationForm({...applicationForm, client_name: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">应用官网</label>
                        <input
                          type="url"
                          value={applicationForm.client_uri}
                          onChange={(e) => setApplicationForm({...applicationForm, client_uri: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700">应用描述</label>
                        <textarea
                          rows={3}
                          value={applicationForm.client_description}
                          onChange={(e) => setApplicationForm({...applicationForm, client_description: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Redirect URIs */}
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">重定向URI *</h3>
                    <div className="space-y-2">
                      {applicationForm.redirect_uris.map((uri, index) => (
                        <div key={index} className="flex gap-2">
                          <input
                            type="url"
                            value={uri}
                            onChange={(e) => updateRedirectUri(index, e.target.value)}
                            placeholder="https://example.com/callback"
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          />
                          {applicationForm.redirect_uris.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeRedirectUri(index)}
                              className="px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
                            >
                              删除
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addRedirectUri}
                        className="px-3 py-1 bg-blue-500 text-white text-sm rounded-md hover:bg-blue-600"
                      >
                        添加重定向URI
                      </button>
                    </div>
                  </div>

                  {/* Contact Info */}
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">联系信息</h3>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-gray-700">联系邮箱</label>
                      {applicationForm.contacts.map((contact, index) => (
                        <div key={index} className="flex gap-2">
                          <input
                            type="email"
                            value={contact}
                            onChange={(e) => updateContact(index, e.target.value)}
                            placeholder="contact@example.com"
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                          />
                          {applicationForm.contacts.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeContact(index)}
                              className="px-3 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
                            >
                              删除
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addContact}
                        className="px-3 py-1 bg-blue-500 text-white text-sm rounded-md hover:bg-blue-600"
                      >
                        添加邮箱
                      </button>
                    </div>
                  </div>

                  {/* Assets */}
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">资源链接</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">应用图标URL</label>
                        <input
                          type="url"
                          value={applicationForm.logo_uri}
                          onChange={(e) => setApplicationForm({...applicationForm, logo_uri: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">服务条款URL</label>
                        <input
                          type="url"
                          value={applicationForm.tos_uri}
                          onChange={(e) => setApplicationForm({...applicationForm, tos_uri: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700">隐私政策URL</label>
                        <input
                          type="url"
                          value={applicationForm.policy_uri}
                          onChange={(e) => setApplicationForm({...applicationForm, policy_uri: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* OAuth Settings */}
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">OAuth配置</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">授权范围</label>
                        <input
                          type="text"
                          value={applicationForm.scope}
                          onChange={(e) => setApplicationForm({...applicationForm, scope: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">响应类型</label>
                        <input
                          type="text"
                          value={applicationForm.response_types}
                          onChange={(e) => setApplicationForm({...applicationForm, response_types: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700">授权类型</label>
                        <input
                          type="text"
                          value={applicationForm.grant_types}
                          onChange={(e) => setApplicationForm({...applicationForm, grant_types: e.target.value})}
                          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Application Status */}
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">应用状态</h3>
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="is_active"
                        checked={applicationForm.is_active}
                        onChange={(e) => setApplicationForm({...applicationForm, is_active: e.target.checked})}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900">
                        启用应用
                      </label>
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
                    {saving ? '保存中...' : (mode === 'create' ? '创建应用' : '更新应用')}
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