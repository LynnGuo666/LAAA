'use client';

import { useEffect, useState } from 'react';
import { clientApi, groupApi } from '@/lib/api';
import SidePanel from '@/components/SidePanel';
import { useAuthStore } from '@/lib/store';
import { isAdmin } from '@/lib/authz';

interface Client {
  id: number;
  client_id: string;
  name: string;
  description?: string;
  logo?: string;
  redirect_uris: string[];
  allowed_scopes: string[];
  trusted: boolean;
  created_at: string;
}

interface Group {
  id: number;
  name: string;
  description?: string;
}

// 可用的 OAuth Scopes
const AVAILABLE_SCOPES = [
  { value: 'profile', label: '基本信息 (profile)', description: '用户名、头像等基本信息' },
  { value: 'email', label: '邮箱地址 (email)', description: '用户的邮箱地址' },
  { value: 'openid', label: 'OpenID Connect (openid)', description: 'OpenID Connect 标准' },
  { value: 'read', label: '读取权限 (read)', description: '读取用户数据' },
  { value: 'write', label: '写入权限 (write)', description: '修改用户数据' },
];

export default function AppsPage() {
  const user = useAuthStore((s) => s.user);
  const canManageClients = isAdmin(user);
  const [clients, setClients] = useState<Client[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [showAccessControl, setShowAccessControl] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [newClientCredentials, setNewClientCredentials] = useState<{
    client_id: string;
    client_secret: string;
  } | null>(null);
  const [showNewSecret, setShowNewSecret] = useState(true);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [accessControl, setAccessControl] = useState({
    allowed_group_ids: [] as number[],
    denied_group_ids: [] as number[],
  });
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    logo: '',
    redirect_uris: '',
    allowed_scopes: ['profile', 'email'],  // 默认选中
    trusted: false,
  });

  useEffect(() => {
    if (!canManageClients) return;
    loadClients();
    loadGroups();
  }, [canManageClients]);

  if (!canManageClients) {
    return (
      <div className="card">
        <h1 className="text-xl font-semibold mb-2">无权限</h1>
        <p className="text-gray-600">该页面仅管理员可访问。</p>
      </div>
    );
  }

  const loadClients = async () => {
    try {
      const response = await clientApi.list();
      setClients(response.data);
    } catch (err) {
      console.error('加载应用列表失败', err);
    } finally {
      setLoading(false);
    }
  };

  const loadGroups = async () => {
    try {
      const response = await groupApi.list();
      setGroups(response.data);
    } catch (err) {
      console.error('加载用户组列表失败', err);
    }
  };

  const handleScopeToggle = (scope: string) => {
    setFormData(prev => ({
      ...prev,
      allowed_scopes: prev.allowed_scopes.includes(scope)
        ? prev.allowed_scopes.filter(s => s !== scope)
        : [...prev.allowed_scopes, scope]
    }));
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(`${label} 已复制`);
      window.setTimeout(() => setCopyStatus(null), 1500);
    } catch {
      setCopyStatus('复制失败，请手动复制');
      window.setTimeout(() => setCopyStatus(null), 2000);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.allowed_scopes.length === 0) {
      alert('请至少选择一个权限范围');
      return;
    }

    try {
      const response = await clientApi.create({
        name: formData.name,
        description: formData.description || undefined,
        logo: formData.logo || undefined,
        redirect_uris: formData.redirect_uris.split('\n').filter(u => u.trim()),
        allowed_scopes: formData.allowed_scopes,
        trusted: formData.trusted,
      });

      setNewClientCredentials({
        client_id: response.data.client_id,
        client_secret: response.data.client_secret,
      });
      setShowNewSecret(true);
      setCopyStatus(null);

      setShowCreateForm(false);
      setFormData({
        name: '',
        description: '',
        logo: '',
        redirect_uris: '',
        allowed_scopes: ['profile', 'email'],
        trusted: false,
      });
      loadClients();
    } catch (err: any) {
      alert('创建应用失败: ' + (err.response?.data?.detail || '未知错误'));
    }
  };

  const openEditForm = (client: Client) => {
    setEditingClient(client);
    setFormData({
      name: client.name,
      description: client.description || '',
      logo: client.logo || '',
      redirect_uris: client.redirect_uris.join('\n'),
      allowed_scopes: client.allowed_scopes,
      trusted: client.trusted,
    });
    setShowEditForm(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient) return;

    if (formData.allowed_scopes.length === 0) {
      alert('请至少选择一个权限范围');
      return;
    }

    try {
      await clientApi.update(editingClient.id, {
        name: formData.name,
        description: formData.description || undefined,
        logo: formData.logo || undefined,
        redirect_uris: formData.redirect_uris.split('\n').filter(u => u.trim()),
        allowed_scopes: formData.allowed_scopes,
        trusted: formData.trusted,
      });

      alert('应用更新成功！');
      setShowEditForm(false);
      setEditingClient(null);
      setFormData({
        name: '',
        description: '',
        logo: '',
        redirect_uris: '',
        allowed_scopes: ['profile', 'email'],
        trusted: false,
      });
      loadClients();
    } catch (err: any) {
      alert('更新应用失败: ' + (err.response?.data?.detail || '未知错误'));
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定要删除应用 "${name}" 吗？`)) return;

    try {
      await clientApi.delete(id);
      loadClients();
    } catch (err) {
      alert('删除应用失败');
    }
  };

  const openAccessControl = async (client: Client) => {
    setSelectedClient(client);
    try {
      const response = await clientApi.getAccessControl(client.id);
      const data = response.data;
      setAccessControl({
        allowed_group_ids: Array.isArray(data.allowed_groups)
          ? data.allowed_groups.map((g: Group) => g.id)
          : [],
        denied_group_ids: Array.isArray(data.denied_groups)
          ? data.denied_groups.map((g: Group) => g.id)
          : [],
      });
      setShowAccessControl(true);
    } catch (err) {
      console.error('加载访问控制失败', err);
      alert('加载访问控制失败');
    }
  };

  const handleResetSecret = async (client: Client) => {
    if (!confirm(`确定要重置 "${client.name}" 的 Client Secret 吗？重置后旧密钥将立即失效。`)) return;
    try {
      const response = await clientApi.resetSecret(client.id);
      setNewClientCredentials({
        client_id: response.data.client_id,
        client_secret: response.data.client_secret,
      });
      setShowNewSecret(true);
      setCopyStatus(null);
    } catch (err: any) {
      alert('重置密钥失败: ' + (err.response?.data?.detail || '未知错误'));
    }
  };

  const handleAccessControlSave = async () => {
    if (!selectedClient) return;

    // 检查是否有重复
    const overlap = accessControl.allowed_group_ids.filter(id =>
      accessControl.denied_group_ids.includes(id)
    );
    if (overlap.length > 0) {
      alert('同一个用户组不能同时在允许和禁止列表中');
      return;
    }

    try {
      await clientApi.updateAccessControl(selectedClient.id, accessControl);
      alert('访问控制更新成功');
      setShowAccessControl(false);
      setSelectedClient(null);
    } catch (err: any) {
      alert('更新失败: ' + (err.response?.data?.detail || '未知错误'));
    }
  };

  const toggleGroupInList = (groupId: number, listType: 'allowed' | 'denied') => {
    if (listType === 'allowed') {
      setAccessControl(prev => ({
        ...prev,
        allowed_group_ids: prev.allowed_group_ids.includes(groupId)
          ? prev.allowed_group_ids.filter(id => id !== groupId)
          : [...prev.allowed_group_ids, groupId]
      }));
    } else {
      setAccessControl(prev => ({
        ...prev,
        denied_group_ids: prev.denied_group_ids.includes(groupId)
          ? prev.denied_group_ids.filter(id => id !== groupId)
          : [...prev.denied_group_ids, groupId]
      }));
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-600">加载中...</div>;
  }

  return (
    <div className="px-4 sm:px-0">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">我的应用</h1>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="btn btn-primary"
        >
          {showCreateForm ? '取消' : '+ 创建应用'}
        </button>
      </div>

      {newClientCredentials && (
        <div className="card mb-8 border-l-4 border-yellow-400">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h2 className="text-lg font-semibold">应用密钥（仅本次显示）</h2>
              <p className="text-sm text-gray-600 mt-1">
                请立即保存 `Client Secret`，关闭页面后将无法再次查看（可在此页面重置）。
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary text-sm"
              onClick={() => setNewClientCredentials(null)}
            >
              关闭
            </button>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="sm:w-28 text-sm font-medium">Client ID</div>
              <div className="flex-1 flex items-center gap-2">
                <code className="bg-gray-100 px-2 py-1 rounded font-mono text-sm break-all select-all flex-1">
                  {newClientCredentials.client_id}
                </code>
                <button
                  type="button"
                  className="btn btn-secondary text-sm"
                  onClick={() => copyToClipboard(newClientCredentials.client_id, 'Client ID')}
                >
                  复制
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="sm:w-28 text-sm font-medium">Client Secret</div>
              <div className="flex-1 flex items-center gap-2">
                <code className="bg-gray-100 px-2 py-1 rounded font-mono text-sm break-all select-all flex-1">
                  {showNewSecret ? newClientCredentials.client_secret : '••••••••••••••••'}
                </code>
                <button
                  type="button"
                  className="btn btn-secondary text-sm"
                  onClick={() => setShowNewSecret((v) => !v)}
                >
                  {showNewSecret ? '隐藏' : '显示'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary text-sm"
                  onClick={() => copyToClipboard(newClientCredentials.client_secret, 'Client Secret')}
                >
                  复制
                </button>
              </div>
            </div>

            {copyStatus && <div className="text-sm text-gray-600">{copyStatus}</div>}
          </div>
        </div>
      )}

      {showCreateForm && (
        <form onSubmit={handleCreate} className="card mb-8 space-y-4">
          <h2 className="text-xl font-semibold">创建新应用</h2>

          <div>
            <label className="block text-sm font-medium mb-2">应用名称 *</label>
            <input
              type="text"
              required
              className="input"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">应用描述</label>
            <textarea
              className="input"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">应用 Logo URL</label>
            <input
              type="url"
              className="input"
              placeholder="https://example.com/logo.png"
              value={formData.logo}
              onChange={(e) => setFormData({ ...formData, logo: e.target.value })}
            />
            <p className="text-xs text-gray-500 mt-1">Logo 将显示在授权页面上</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">回调地址 * (每行一个)</label>
            <textarea
              required
              className="input font-mono text-sm"
              rows={3}
              placeholder="http://localhost:3000/callback&#10;https://myapp.com/callback"
              value={formData.redirect_uris}
              onChange={(e) => setFormData({ ...formData, redirect_uris: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-3">权限范围 *</label>
            <div className="space-y-3">
              {AVAILABLE_SCOPES.map((scope) => (
                <div key={scope.value} className="flex items-start">
                  <input
                    type="checkbox"
                    id={`scope-${scope.value}`}
                    checked={formData.allowed_scopes.includes(scope.value)}
                    onChange={() => handleScopeToggle(scope.value)}
                    className="h-4 w-4 mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor={`scope-${scope.value}`} className="ml-3 flex-1 cursor-pointer">
                    <div className="font-medium text-sm">{scope.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{scope.description}</div>
                  </label>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              已选择 {formData.allowed_scopes.length} 项权限
            </p>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="trusted"
              checked={formData.trusted}
              onChange={(e) => setFormData({ ...formData, trusted: e.target.checked })}
              className="h-4 w-4"
            />
            <label htmlFor="trusted" className="ml-2 text-sm">
              信任的应用（跳过授权确认）
            </label>
          </div>

          <button type="submit" className="btn btn-primary">
            创建应用
          </button>
        </form>
      )}

      {/* 编辑应用表单 */}
      {showEditForm && editingClient && (
        <form onSubmit={handleUpdate} className="card mb-8 space-y-4">
          <h2 className="text-xl font-semibold">编辑应用: {editingClient.name}</h2>

          <div>
            <label className="block text-sm font-medium mb-2">应用名称 *</label>
            <input
              type="text"
              required
              className="input"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">应用描述</label>
            <textarea
              className="input"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">应用 Logo URL</label>
            <input
              type="url"
              className="input"
              placeholder="https://example.com/logo.png"
              value={formData.logo}
              onChange={(e) => setFormData({ ...formData, logo: e.target.value })}
            />
            <p className="text-xs text-gray-500 mt-1">Logo 将显示在授权页面上</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">回调地址 * (每行一个)</label>
            <textarea
              required
              className="input font-mono text-sm"
              rows={3}
              placeholder="http://localhost:3000/callback&#10;https://myapp.com/callback"
              value={formData.redirect_uris}
              onChange={(e) => setFormData({ ...formData, redirect_uris: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-3">权限范围 *</label>
            <div className="space-y-3">
              {AVAILABLE_SCOPES.map((scope) => (
                <div key={scope.value} className="flex items-start">
                  <input
                    type="checkbox"
                    id={`edit-scope-${scope.value}`}
                    checked={formData.allowed_scopes.includes(scope.value)}
                    onChange={() => handleScopeToggle(scope.value)}
                    className="h-4 w-4 mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <label htmlFor={`edit-scope-${scope.value}`} className="ml-3 flex-1 cursor-pointer">
                    <div className="font-medium text-sm">{scope.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{scope.description}</div>
                  </label>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              已选择 {formData.allowed_scopes.length} 项权限
            </p>
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="edit-trusted"
              checked={formData.trusted}
              onChange={(e) => setFormData({ ...formData, trusted: e.target.checked })}
              className="h-4 w-4"
            />
            <label htmlFor="edit-trusted" className="ml-2 text-sm">
              信任的应用（跳过授权确认）
            </label>
          </div>

          <div className="flex space-x-3">
            <button type="submit" className="btn btn-primary">
              保存更改
            </button>
            <button
              type="button"
              onClick={() => {
                setShowEditForm(false);
                setEditingClient(null);
              }}
              className="btn btn-secondary"
            >
              取消
            </button>
          </div>
        </form>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        <section className="flex-1 space-y-4">
          {clients.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-gray-500">还没有应用，创建一个开始使用吧！</p>
            </div>
          ) : (
            clients.map((client) => (
              <div key={client.id} className="card">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold">{client.name}</h3>
                    {client.description && (
                      <p className="text-sm text-gray-600 mt-1">{client.description}</p>
                    )}
                    <div className="mt-3 space-y-1 text-sm">
                      <p>
                        <span className="font-medium">Client ID:</span>{' '}
                        <code className="bg-gray-100 px-2 py-1 rounded">{client.client_id}</code>
                      </p>
                      <p>
                        <span className="font-medium">权限范围:</span> {client.allowed_scopes.join(', ')}
                      </p>
                      {client.trusted && (
                        <p className="text-green-600">已设为信任应用</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEditForm(client)}
                      className="btn btn-secondary text-sm"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleResetSecret(client)}
                      className="btn btn-secondary text-sm"
                    >
                      重置密钥
                    </button>
                    <button
                      onClick={() => openAccessControl(client)}
                      className="btn btn-secondary text-sm"
                    >
                      访问控制
                    </button>
                    <button
                      onClick={() => handleDelete(client.id, client.name)}
                      className="btn btn-danger text-sm"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </section>

        <SidePanel
          title={selectedClient ? `访问控制：${selectedClient.name}` : '访问控制'}
          open={showAccessControl && !!selectedClient}
          onClose={() => {
            setShowAccessControl(false);
            setSelectedClient(null);
          }}
        >
          {!selectedClient ? (
            <div className="text-sm text-gray-500">请选择左侧应用</div>
          ) : (
            <div className="space-y-6">
              <p className="text-sm text-gray-600">
                设置哪些用户组可以访问此应用。不设置任何限制时，所有用户都可访问。
              </p>

              <div>
                <h3 className="font-semibold mb-2">允许访问（白名单）</h3>
                <p className="text-sm text-gray-500 mb-3">
                  只有这些用户组的成员可以访问此应用
                </p>
                <div className="space-y-2">
                  {groups.map((group) => (
                    <div key={group.id} className="flex items-center">
                      <input
                        type="checkbox"
                        id={`allowed-${group.id}`}
                        checked={accessControl.allowed_group_ids.includes(group.id)}
                        onChange={() => toggleGroupInList(group.id, 'allowed')}
                        className="h-4 w-4"
                      />
                      <label htmlFor={`allowed-${group.id}`} className="ml-3 cursor-pointer flex-1">
                        <div className="font-medium text-sm">{group.name}</div>
                        {group.description && (
                          <div className="text-xs text-gray-500">{group.description}</div>
                        )}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">禁止访问（黑名单）</h3>
                <p className="text-sm text-gray-500 mb-3">
                  这些用户组的成员无法访问此应用
                </p>
                <div className="space-y-2">
                  {groups.map((group) => (
                    <div key={group.id} className="flex items-center">
                      <input
                        type="checkbox"
                        id={`denied-${group.id}`}
                        checked={accessControl.denied_group_ids.includes(group.id)}
                        onChange={() => toggleGroupInList(group.id, 'denied')}
                        className="h-4 w-4"
                      />
                      <label htmlFor={`denied-${group.id}`} className="ml-3 cursor-pointer flex-1">
                        <div className="font-medium text-sm">{group.name}</div>
                        {group.description && (
                          <div className="text-xs text-gray-500">{group.description}</div>
                        )}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t">
                <button
                  onClick={handleAccessControlSave}
                  className="btn btn-primary flex-1 text-sm"
                >
                  保存
                </button>
                <button
                  onClick={() => {
                    setShowAccessControl(false);
                    setSelectedClient(null);
                  }}
                  className="btn btn-secondary flex-1 text-sm"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </SidePanel>
      </div>
    </div>
  );
}
