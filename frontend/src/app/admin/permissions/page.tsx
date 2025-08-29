'use client';

import { useState, useEffect } from 'react';
import { authApi } from '@/lib/api';

interface ClientApplication {
  id: string;
  client_id: string;
  client_name: string;
  client_description?: string;
  owner_id: string;
  is_active: boolean;
  created_at: string;
}

interface PermissionGroup {
  id: string;
  client_id: string;
  name: string;
  description?: string;
  default_allowed: boolean;
  allowed_scopes: string[];
  created_at: string;
  updated_at?: string;
}

interface User {
  id: string;
  username: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
}

interface UserAccess {
  id: string;
  user_id: string;
  client_id: string;
  access_type: string;
  custom_scopes?: string[];
  granted_by?: string;
  granted_at?: string;
  notes?: string;
  expires_at?: string;
  created_at: string;
  updated_at?: string;
}

export default function AdminPermissionsPage() {
  const [clients, setClients] = useState<ClientApplication[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientApplication | null>(null);
  const [permissionGroup, setPermissionGroup] = useState<PermissionGroup | null>(null);
  const [userAccesses, setUserAccesses] = useState<UserAccess[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form states
  const [groupName, setGroupName] = useState('默认权限组');
  const [groupDescription, setGroupDescription] = useState('');
  const [defaultAllowed, setDefaultAllowed] = useState(false);
  const [allowedScopes, setAllowedScopes] = useState<string[]>(['openid', 'profile', 'email']);

  // User access form
  const [showUserAccessForm, setShowUserAccessForm] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [accessType, setAccessType] = useState('allowed');
  const [customScopes, setCustomScopes] = useState<string[]>([]);
  const [accessNotes, setAccessNotes] = useState('');

  const availableScopes = ['openid', 'profile', 'email', 'phone', 'address'];

  useEffect(() => {
    loadClients();
    loadUsers();
  }, []);

  useEffect(() => {
    if (selectedClient) {
      loadClientPermissions(selectedClient.client_id);
    }
  }, [selectedClient]);

  const loadClients = async () => {
    try {
      const response = await fetch('/api/v1/clients/my', {
        headers: {
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setClients(data);
        if (data.length > 0) {
          setSelectedClient(data[0]);
        }
      }
    } catch (error) {
      console.error('Failed to load clients:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await fetch('/api/v1/users/', {
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

  const loadClientPermissions = async (clientId: string) => {
    try {
      // Load permission group
      try {
        const groupResponse = await fetch(`/api/v1/permissions/groups/${clientId}`, {
          headers: {
            'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
          }
        });
        
        if (groupResponse.ok) {
          const group = await groupResponse.json();
          setPermissionGroup(group);
          setGroupName(group.name || '默认权限组');
          setGroupDescription(group.description || '');
          setDefaultAllowed(group.default_allowed || false);
          setAllowedScopes(group.allowed_scopes || ['openid', 'profile', 'email']);
        } else {
          // No permission group exists yet
          setPermissionGroup(null);
          setGroupName('默认权限组');
          setGroupDescription('');
          setDefaultAllowed(false);
          setAllowedScopes(['openid', 'profile', 'email']);
        }
      } catch (error) {
        console.error('Failed to load permission group:', error);
      }

      // Load user accesses
      try {
        const accessResponse = await fetch(`/api/v1/permissions/access/${clientId}`, {
          headers: {
            'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
          }
        });
        
        if (accessResponse.ok) {
          const accessData = await accessResponse.json();
          setUserAccesses(accessData.user_accesses || []);
        }
      } catch (error) {
        console.error('Failed to load user accesses:', error);
      }
    } catch (error) {
      console.error('Failed to load client permissions:', error);
    }
  };

  const savePermissionGroup = async () => {
    if (!selectedClient) return;
    
    setSaving(true);
    try {
      const groupData = {
        name: groupName,
        description: groupDescription,
        default_allowed: defaultAllowed,
        allowed_scopes: allowedScopes
      };

      const response = await fetch(`/api/v1/permissions/groups/${selectedClient.client_id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        },
        body: JSON.stringify(groupData)
      });

      if (response.ok) {
        const result = await response.json();
        setPermissionGroup(result);
        alert('权限组保存成功！');
      } else {
        throw new Error('保存失败');
      }
    } catch (error) {
      console.error('Failed to save permission group:', error);
      alert('保存权限组失败');
    } finally {
      setSaving(false);
    }
  };

  const grantUserAccess = async () => {
    if (!selectedClient || !selectedUserId) return;
    
    setSaving(true);
    try {
      const accessData = {
        user_id: selectedUserId,
        access_type: accessType,
        custom_scopes: customScopes.length > 0 ? customScopes : null,
        notes: accessNotes || null
      };

      const response = await fetch(`/api/v1/permissions/access/${selectedClient.client_id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        },
        body: JSON.stringify(accessData)
      });

      if (response.ok) {
        setShowUserAccessForm(false);
        setSelectedUserId('');
        setAccessType('allowed');
        setCustomScopes([]);
        setAccessNotes('');
        loadClientPermissions(selectedClient.client_id);
        alert('用户权限设置成功！');
      } else {
        throw new Error('设置失败');
      }
    } catch (error) {
      console.error('Failed to grant user access:', error);
      alert('设置用户权限失败');
    } finally {
      setSaving(false);
    }
  };

  const revokeUserAccess = async (userId: string) => {
    if (!selectedClient || !confirm('确定要撤销该用户的权限吗？')) return;
    
    try {
      const response = await fetch(`/api/v1/permissions/access/${selectedClient.client_id}/user/${userId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${document.cookie.match(/access_token=([^;]+)/)?.[1]}`,
        }
      });

      if (response.ok) {
        loadClientPermissions(selectedClient.client_id);
        alert('用户权限已撤销！');
      } else {
        throw new Error('撤销失败');
      }
    } catch (error) {
      console.error('Failed to revoke user access:', error);
      alert('撤销用户权限失败');
    }
  };

  const getScopeDescription = (scope: string): string => {
    const descriptions: Record<string, string> = {
      'openid': '身份验证',
      'profile': '基本资料',
      'email': '邮箱地址',
      'phone': '手机号码',
      'address': '地址信息',
    };
    return descriptions[scope] || scope;
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
    <div className="min-h-full py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">应用权限管理</h1>
          <p className="mt-2 text-gray-600">管理应用的权限组和用户访问权限</p>
        </div>

        {clients.length === 0 ? (
          <div className="text-center py-12">
            <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-gray-100">
              <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h3 className="mt-4 text-lg font-medium text-gray-900">暂无应用</h3>
            <p className="mt-2 text-gray-500">请先创建应用后再配置权限</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 应用列表 */}
            <div className="bg-white shadow rounded-lg p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">选择应用</h2>
              <div className="space-y-2">
                {clients.map((client) => (
                  <button
                    key={client.id}
                    onClick={() => setSelectedClient(client)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      selectedClient?.id === client.id
                        ? 'bg-blue-50 border-blue-200 text-blue-900'
                        : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    <div className="font-medium">{client.client_name}</div>
                    <div className="text-sm text-gray-600">{client.client_description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 权限组配置 */}
            {selectedClient && (
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white shadow rounded-lg p-6">
                  <h2 className="text-lg font-medium text-gray-900 mb-4">权限组配置</h2>
                  
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">组名称</label>
                      <input
                        type="text"
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">组描述</label>
                      <textarea
                        value={groupDescription}
                        onChange={(e) => setGroupDescription(e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>

                    <div>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={defaultAllowed}
                          onChange={(e) => setDefaultAllowed(e.target.checked)}
                          className="mr-2"
                        />
                        <span className="text-sm font-medium text-gray-700">默认允许所有用户使用此应用</span>
                      </label>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">允许的权限范围</label>
                      <div className="space-y-2">
                        {availableScopes.map((scope) => (
                          <label key={scope} className="flex items-center">
                            <input
                              type="checkbox"
                              checked={allowedScopes.includes(scope)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setAllowedScopes([...allowedScopes, scope]);
                                } else {
                                  setAllowedScopes(allowedScopes.filter(s => s !== scope));
                                }
                              }}
                              className="mr-2"
                            />
                            <span className="text-sm text-gray-700">{getScopeDescription(scope)}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={savePermissionGroup}
                      disabled={saving}
                      className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving ? '保存中...' : '保存权限组'}
                    </button>
                  </div>
                </div>

                {/* 用户权限管理 */}
                <div className="bg-white shadow rounded-lg p-6">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-medium text-gray-900">用户权限管理</h2>
                    <button
                      onClick={() => setShowUserAccessForm(true)}
                      className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                    >
                      添加用户权限
                    </button>
                  </div>

                  {userAccesses.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">暂无特定用户权限设置</p>
                  ) : (
                    <div className="space-y-3">
                      {userAccesses.map((access) => {
                        const user = users.find(u => u.id === access.user_id);
                        return (
                          <div key={access.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <div>
                              <div className="font-medium">{user?.username || '未知用户'}</div>
                              <div className="text-sm text-gray-600">
                                {access.access_type === 'allowed' ? '允许' : '拒绝'}
                                {access.custom_scopes && access.custom_scopes.length > 0 && (
                                  <span> - {access.custom_scopes.map(getScopeDescription).join(', ')}</span>
                                )}
                              </div>
                              {access.notes && (
                                <div className="text-xs text-gray-500 mt-1">{access.notes}</div>
                              )}
                            </div>
                            <button
                              onClick={() => revokeUserAccess(access.user_id)}
                              className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700"
                            >
                              撤销
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 用户权限表单模态框 */}
        {showUserAccessForm && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
            <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
              <div className="mt-3">
                <h3 className="text-lg font-medium text-gray-900 mb-4">添加用户权限</h3>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">选择用户</label>
                    <select
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">请选择用户</option>
                      {users.filter(user => !userAccesses.some(access => access.user_id === user.id)).map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.username} ({user.email})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">访问类型</label>
                    <select
                      value={accessType}
                      onChange={(e) => setAccessType(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="allowed">允许</option>
                      <option value="denied">拒绝</option>
                    </select>
                  </div>

                  {accessType === 'allowed' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">自定义权限范围（可选）</label>
                      <div className="space-y-2">
                        {availableScopes.map((scope) => (
                          <label key={scope} className="flex items-center">
                            <input
                              type="checkbox"
                              checked={customScopes.includes(scope)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setCustomScopes([...customScopes, scope]);
                                } else {
                                  setCustomScopes(customScopes.filter(s => s !== scope));
                                }
                              }}
                              className="mr-2"
                            />
                            <span className="text-sm text-gray-700">{getScopeDescription(scope)}</span>
                          </label>
                        ))}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        不选择则使用权限组默认设置
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">备注（可选）</label>
                    <textarea
                      value={accessNotes}
                      onChange={(e) => setAccessNotes(e.target.value)}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    onClick={() => {
                      setShowUserAccessForm(false);
                      setSelectedUserId('');
                      setAccessType('allowed');
                      setCustomScopes([]);
                      setAccessNotes('');
                    }}
                    className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
                  >
                    取消
                  </button>
                  <button
                    onClick={grantUserAccess}
                    disabled={!selectedUserId || saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? '设置中...' : '确认'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}