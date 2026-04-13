'use client';

import { useEffect, useState } from 'react';
import { AlertDialog, Button, Card, CheckboxGroup, Checkbox, Chip, Description, Input, Label, RadioGroup, TextArea, TextField, toast } from '@heroui/react';
import { clientApi, groupApi } from '@/lib/api';
import SidePanel from '@/components/SidePanel';
import { useAuthStore } from '@/lib/store';
import { isAdmin } from '@/lib/authz';
import { UICheckbox, UIRadio } from '@/components/ui/primitives';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';

interface Client {
  id: number;
  client_id: string;
  name: string;
  description?: string;
  logo?: string;
  website_url?: string;
  redirect_uris: string[];
  allowed_scopes: string[];
  trusted: boolean;
  default_access: boolean;
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
  const confirmDialog = useConfirmDialog();
  const user = useAuthStore((s) => s.user);
  const canManageClients = isAdmin(user);
  const [clients, setClients] = useState<Client[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [resettingClientId, setResettingClientId] = useState<number | null>(null);
  const [deletingClientId, setDeletingClientId] = useState<number | null>(null);
  const [accessControlLoading, setAccessControlLoading] = useState(false);
  const [accessControlSaving, setAccessControlSaving] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
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
    website_url: '',
    redirect_uris: '',
    allowed_scopes: ['profile', 'email'],  // 默认选中
    trusted: false,
    default_access: false,
  });

  useEffect(() => {
    if (!canManageClients) return;
    loadClients();
    loadGroups();
  }, [canManageClients]);

  if (!canManageClients) {
    return (
      <div className="surface p-6">
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
    if (creating) return;

    if (formData.allowed_scopes.length === 0) {
      toast('请至少选择一个权限范围');
      return;
    }

    try {
      setCreating(true);
      const response = await clientApi.create({
        name: formData.name,
        description: formData.description || undefined,
        logo: formData.logo || undefined,
        website_url: formData.website_url || undefined,
        redirect_uris: formData.redirect_uris.split('\n').filter(u => u.trim()),
        allowed_scopes: formData.allowed_scopes,
        trusted: formData.trusted,
        default_access: formData.default_access,
      });

      setNewClientCredentials({
        client_id: response.data.client_id,
        client_secret: response.data.client_secret,
      });
      setShowNewSecret(true);
      setCopyStatus(null);

      setShowCreateModal(false);
      setFormData({
        name: '',
        description: '',
        logo: '',
        website_url: '',
        redirect_uris: '',
        allowed_scopes: ['profile', 'email'],
        trusted: false,
        default_access: false,
      });
      await loadClients();
    } catch (err: any) {
      toast('创建应用失败: ' + (err.response?.data?.detail || '未知错误'));
    } finally {
      setCreating(false);
    }
  };

  const openEditForm = (client: Client) => {
    setEditingClient(client);
    setFormData({
      name: client.name,
      description: client.description || '',
      logo: client.logo || '',
      website_url: client.website_url || '',
      redirect_uris: client.redirect_uris.join('\n'),
      allowed_scopes: client.allowed_scopes,
      trusted: client.trusted,
      default_access: client.default_access,
    });
    setShowEditModal(true);
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient) return;
    if (updating) return;

    if (formData.allowed_scopes.length === 0) {
      toast('请至少选择一个权限范围');
      return;
    }

    try {
      setUpdating(true);
      await clientApi.update(editingClient.id, {
        name: formData.name,
        description: formData.description || undefined,
        logo: formData.logo || undefined,
        website_url: formData.website_url || undefined,
        redirect_uris: formData.redirect_uris.split('\n').filter(u => u.trim()),
        allowed_scopes: formData.allowed_scopes,
        trusted: formData.trusted,
        default_access: formData.default_access,
      });

      toast('应用更新成功！');
      setShowEditModal(false);
      setEditingClient(null);
      setFormData({
        name: '',
        description: '',
        logo: '',
        website_url: '',
        redirect_uris: '',
        allowed_scopes: ['profile', 'email'],
        trusted: false,
        default_access: false,
      });
      await loadClients();
    } catch (err: any) {
      toast('更新应用失败: ' + (err.response?.data?.detail || '未知错误'));
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (deletingClientId) return;
    const shouldDelete = await confirmDialog({
      title: '确认删除应用',
      description: `确定要删除应用 "${name}" 吗？`,
      confirmText: '删除应用',
      cancelText: '取消',
      status: 'danger',
      confirmVariant: 'danger',
    });
    if (!shouldDelete) return;

    try {
      setDeletingClientId(id);
      await clientApi.delete(id);
      await loadClients();
    } catch (err) {
      toast('删除应用失败');
    } finally {
      setDeletingClientId(null);
    }
  };

  const openAccessControl = async (client: Client) => {
    setSelectedClient(client);
    setShowAccessControl(true);
    setAccessControlLoading(true);
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
    } catch (err) {
      console.error('加载访问控制失败', err);
      toast('加载访问控制失败');
    } finally {
      setAccessControlLoading(false);
    }
  };

  const handleResetSecret = async (client: Client) => {
    if (resettingClientId) return;
    const shouldReset = await confirmDialog({
      title: '确认重置密钥',
      description: `确定要重置 "${client.name}" 的 Client Secret 吗？重置后旧密钥将立即失效。`,
      confirmText: '重置密钥',
      cancelText: '取消',
      status: 'warning',
      confirmVariant: 'danger',
    });
    if (!shouldReset) return;
    try {
      setResettingClientId(client.id);
      const response = await clientApi.resetSecret(client.id);
      setNewClientCredentials({
        client_id: response.data.client_id,
        client_secret: response.data.client_secret,
      });
      setShowNewSecret(true);
      setCopyStatus(null);
    } catch (err: any) {
      toast('重置密钥失败: ' + (err.response?.data?.detail || '未知错误'));
    } finally {
      setResettingClientId(null);
    }
  };

  const handleAccessControlSave = async () => {
    if (!selectedClient) return;
    if (accessControlSaving) return;

    // 检查是否有重复
    const overlap = accessControl.allowed_group_ids.filter(id =>
      accessControl.denied_group_ids.includes(id)
    );
    if (overlap.length > 0) {
      toast('同一个用户组不能同时在允许和禁止列表中');
      return;
    }

    try {
      setAccessControlSaving(true);
      await clientApi.updateAccessControl(selectedClient.id, accessControl);
      toast('访问控制更新成功');
      setShowAccessControl(false);
      setSelectedClient(null);
    } catch (err: any) {
      toast('更新失败: ' + (err.response?.data?.detail || '未知错误'));
    } finally {
      setAccessControlSaving(false);
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
    <div className="px-4 sm:px-0 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">我的应用</h1>
        <Button onPress={() => setShowCreateModal(true)} className="w-full sm:w-auto" variant="primary" isDisabled={creating || updating || accessControlSaving}>+ 创建应用</Button>
      </div>

      {newClientCredentials && (
        <div className="surface p-4 sm:p-6 mb-6 sm:mb-8 border-l-4 border-yellow-400">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
            <div className="flex-1">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">应用密钥（仅本次显示）</h2>
              <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1">
                请立即保存 `Client Secret`，关闭页面后将无法再次查看（可在此页面重置）。
              </p>
            </div>
            <Button type="button"
            className="text-xs sm:text-sm" variant="secondary" onPress={() => setNewClientCredentials(null)}>
              关闭
            </Button>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex flex-col gap-2">
              <div className="text-xs sm:text-sm font-medium">Client ID</div>
              <div className="flex items-center gap-2">
                <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded font-mono text-xs break-all select-all flex-1">
                  {newClientCredentials.client_id}
                </code>
                <Button type="button"
                className="text-xs shrink-0" variant="secondary" onPress={() => copyToClipboard(newClientCredentials.client_id, 'Client ID')}>
                  复制
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <div className="text-xs sm:text-sm font-medium">Client Secret</div>
              <div className="flex items-center gap-2">
                <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded font-mono text-xs break-all select-all flex-1">
                  {showNewSecret ? newClientCredentials.client_secret : '••••••••••••••••'}
                </code>
                <Button type="button"
                className="text-xs shrink-0" variant="secondary" onPress={() => setShowNewSecret((v) => !v)}>{showNewSecret ? '隐藏' : '显示'}</Button>
                <Button type="button"
                className="text-xs shrink-0" variant="secondary" onPress={() => copyToClipboard(newClientCredentials.client_secret, 'Client Secret')}>
                  复制
                </Button>
              </div>
            </div>

            {copyStatus && (
              <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-300">
                {copyStatus}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        <section className="flex-1 space-y-4">
          {clients.length === 0 ? (
            <Card>
              <Card.Content className="py-12 text-center">
                <p className="text-gray-500">还没有应用，创建一个开始使用吧！</p>
              </Card.Content>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {clients.map((client) => (
                <Card key={client.id}>
                  <Card.Header>
                    <div className="flex items-start gap-3">
                      {client.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={client.logo}
                          alt={client.name}
                          className="h-10 w-10 rounded-lg border border-gray-200 dark:border-gray-700 shrink-0 object-cover"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-lg bg-blue-500 flex items-center justify-center text-white text-lg font-bold shrink-0">
                          {client.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <Card.Title className="truncate">{client.name}</Card.Title>
                        {client.description && (
                          <Card.Description className="line-clamp-2">{client.description}</Card.Description>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap mt-3">
                      {client.trusted && <Chip color="success" variant="soft" size="sm">信任应用</Chip>}
                      <Chip color={client.default_access ? 'accent' : 'default'} variant="soft" size="sm">
                        默认{client.default_access ? '允许' : '拒绝'}
                      </Chip>
                    </div>
                  </Card.Header>
                  <Card.Content className="space-y-2 text-xs text-gray-600 dark:text-gray-300">
                    <p>
                      <span className="font-medium text-gray-900 dark:text-gray-100">Client ID: </span>
                      <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono break-all select-all">
                        {client.client_id}
                      </code>
                    </p>
                    <p className="truncate">
                      <span className="font-medium text-gray-900 dark:text-gray-100">权限范围: </span>
                      {client.allowed_scopes.join(', ')}
                    </p>
                  </Card.Content>
                  <Card.Footer className="flex flex-wrap gap-2">
                    <Button onPress={() => openEditForm(client)} size="sm" variant="secondary" isDisabled={creating || updating || accessControlSaving || deletingClientId === client.id || resettingClientId === client.id}>
                      编辑
                    </Button>
                    <Button onPress={() => handleResetSecret(client)} size="sm" variant="secondary" isDisabled={creating || updating || accessControlSaving || resettingClientId === client.id || deletingClientId === client.id} isPending={resettingClientId === client.id}>
                      {resettingClientId === client.id ? '重置中' : '重置密钥'}
                    </Button>
                    <Button onPress={() => openAccessControl(client)} size="sm" variant="secondary" isDisabled={creating || updating || accessControlSaving || accessControlLoading} isPending={accessControlLoading && selectedClient?.id === client.id}>
                      {accessControlLoading && selectedClient?.id === client.id ? '加载中' : '访问控制'}
                    </Button>
                    <Button onPress={() => handleDelete(client.id, client.name)} size="sm" variant="danger" isDisabled={creating || updating || accessControlSaving || deletingClientId === client.id || resettingClientId === client.id} isPending={deletingClientId === client.id}>
                      {deletingClientId === client.id ? '删除中' : '删除'}
                    </Button>
                  </Card.Footer>
                </Card>
              ))}
            </div>
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
          ) : accessControlLoading ? (
            <div className="text-sm text-gray-600 dark:text-gray-300">加载中...</div>
          ) : (
            <div className="space-y-6">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                设置哪些用户组可以访问此应用。不设置任何限制时，所有用户都可访问。
              </p>

              <div>
                <h3 className="font-semibold mb-2">允许访问（白名单）</h3>
                <p className="text-sm text-gray-500 mb-3">
                  只有这些用户组的成员可以访问此应用
                </p>
                <div className="surface overflow-hidden">
                  <div className="list p-2 space-y-2">
                    {groups.map((group) => (
                      <Checkbox
                        key={group.id}
                        id={`allowed-${group.id}`}
                        variant="secondary"
                        isSelected={accessControl.allowed_group_ids.includes(group.id)}
                        onChange={() => toggleGroupInList(group.id, 'allowed')}
                        isDisabled={accessControlSaving}
                        className="w-full max-w-full items-start m-0"
                      >
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                        <Checkbox.Content>
                          <div className="w-full min-w-0 flex-1">
                            <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{group.name}</div>
                            {group.description && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{group.description}</div>
                            )}
                          </div>
                        </Checkbox.Content>
                      </Checkbox>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">禁止访问（黑名单）</h3>
                <p className="text-sm text-gray-500 mb-3">
                  这些用户组的成员无法访问此应用
                </p>
                <div className="surface overflow-hidden">
                  <div className="list p-2 space-y-2">
                    {groups.map((group) => (
                      <Checkbox
                        key={group.id}
                        id={`denied-${group.id}`}
                        variant="secondary"
                        isSelected={accessControl.denied_group_ids.includes(group.id)}
                        onChange={() => toggleGroupInList(group.id, 'denied')}
                        isDisabled={accessControlSaving}
                        className="w-full max-w-full items-start m-0"
                      >
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                        <Checkbox.Content>
                          <div className="w-full min-w-0 flex-1">
                            <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{group.name}</div>
                            {group.description && (
                              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{group.description}</div>
                            )}
                          </div>
                        </Checkbox.Content>
                      </Checkbox>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t">
                <Button onPress={handleAccessControlSave} className="flex-1 text-sm" variant="primary" isDisabled={accessControlSaving} isPending={accessControlSaving}>{accessControlSaving ? '保存中...' : '保存'}</Button>
                <Button onPress={() => {
                  setShowAccessControl(false);
                  setSelectedClient(null);
                }} className="flex-1 text-sm" variant="secondary" isDisabled={accessControlSaving} >
                  取消
                </Button>
              </div>
            </div>
          )}
        </SidePanel>
      </div>

      {/* 创建应用 Modal */}
      <AlertDialog>
        <AlertDialog.Backdrop isOpen={showCreateModal} onOpenChange={setShowCreateModal}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>创建新应用</AlertDialog.Heading>
              </AlertDialog.Header>
              <form onSubmit={handleCreate}>
                <AlertDialog.Body className="overflow-y-auto max-h-[60vh]">
                  <fieldset disabled={creating} className="space-y-4">
                    <TextField isRequired>
                      <Label>应用名称</Label>
                      <Input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
                    </TextField>
                    <TextField>
                      <Label>应用描述</Label>
                      <TextArea rows={3} value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
                    </TextField>
                    <TextField>
                      <Label>应用 Logo URL</Label>
                      <Input type="url" placeholder="https://example.com/logo.png" value={formData.logo} onChange={(e) => setFormData({ ...formData, logo: e.target.value })} />
                      <Description>Logo 将显示在授权页面上</Description>
                    </TextField>
                    <TextField>
                      <Label>应用官网（可选）</Label>
                      <Input type="url" placeholder="https://example.com" value={formData.website_url} onChange={(e) => setFormData({ ...formData, website_url: e.target.value })} />
                    </TextField>
                    <TextField isRequired>
                      <Label>回调地址（每行一个）</Label>
                      <TextArea rows={3} className="font-mono text-sm" placeholder="http://localhost:3000/callback&#10;https://myapp.com/callback" value={formData.redirect_uris} onChange={(e) => setFormData({ ...formData, redirect_uris: e.target.value })} />
                    </TextField>
                    <div>
                      <label className="block text-sm font-medium mb-3">权限范围 *</label>
                      <CheckboxGroup aria-label="权限范围" value={formData.allowed_scopes} onChange={(value) => setFormData((prev) => ({ ...prev, allowed_scopes: Array.isArray(value) ? value.map(String) : [] }))} className="space-y-2">
                        {AVAILABLE_SCOPES.map((scope) => (
                          <UICheckbox key={scope.value} value={scope.value} variant="secondary" className="w-full max-w-full items-start m-0">
                            <div className="w-full min-w-0">
                              <div className="font-medium text-sm">{scope.label}</div>
                              <div className="text-xs text-gray-500 mt-0.5">{scope.description}</div>
                            </div>
                          </UICheckbox>
                        ))}
                      </CheckboxGroup>
                      <p className="text-xs text-gray-500 mt-2">已选择 {formData.allowed_scopes.length} 项权限</p>
                    </div>
                    <Checkbox variant="secondary" isSelected={formData.trusted} onChange={(isSelected) => setFormData({ ...formData, trusted: isSelected })}>
                      <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                      <Checkbox.Content>信任的应用（跳过授权确认）</Checkbox.Content>
                    </Checkbox>
                    <div>
                      <label className="block text-sm font-medium mb-2">默认访问</label>
                      <RadioGroup orientation="vertical" value={formData.default_access ? 'allow' : 'deny'} onChange={(val) => setFormData({ ...formData, default_access: val === 'allow' })} className="space-y-2">
                        <UIRadio value="allow">允许</UIRadio>
                        <UIRadio value="deny">拒绝</UIRadio>
                      </RadioGroup>
                      <p className="text-xs text-gray-500 mt-2">当未配置用户/用户组的应用权限时生效</p>
                    </div>
                  </fieldset>
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button type="button" variant="secondary" onPress={() => setShowCreateModal(false)}>取消</Button>
                  <Button type="submit" variant="primary" isDisabled={creating} isPending={creating}>{creating ? '创建中...' : '创建'}</Button>
                </AlertDialog.Footer>
              </form>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      {/* 编辑应用 Modal */}
      <AlertDialog>
        <AlertDialog.Backdrop isOpen={showEditModal && !!editingClient} onOpenChange={setShowEditModal}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>编辑应用：{editingClient?.name}</AlertDialog.Heading>
              </AlertDialog.Header>
              <form onSubmit={handleUpdate}>
                <AlertDialog.Body className="overflow-y-auto max-h-[60vh]">
                  <fieldset disabled={updating} className="space-y-4">
                    <TextField isRequired>
                      <Label>应用名称</Label>
                      <Input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
                    </TextField>
                    <TextField>
                      <Label>应用描述</Label>
                      <TextArea rows={3} value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
                    </TextField>
                    <TextField>
                      <Label>应用 Logo URL</Label>
                      <Input type="url" placeholder="https://example.com/logo.png" value={formData.logo} onChange={(e) => setFormData({ ...formData, logo: e.target.value })} />
                      <Description>Logo 将显示在授权页面上</Description>
                    </TextField>
                    <TextField>
                      <Label>应用官网（可选）</Label>
                      <Input type="url" placeholder="https://example.com" value={formData.website_url} onChange={(e) => setFormData({ ...formData, website_url: e.target.value })} />
                    </TextField>
                    <TextField isRequired>
                      <Label>回调地址（每行一个）</Label>
                      <TextArea rows={3} className="font-mono text-sm" placeholder="http://localhost:3000/callback&#10;https://myapp.com/callback" value={formData.redirect_uris} onChange={(e) => setFormData({ ...formData, redirect_uris: e.target.value })} />
                    </TextField>
                    <div>
                      <label className="block text-sm font-medium mb-3">权限范围 *</label>
                      <CheckboxGroup aria-label="权限范围" value={formData.allowed_scopes} onChange={(value) => setFormData((prev) => ({ ...prev, allowed_scopes: Array.isArray(value) ? value.map(String) : [] }))} className="space-y-2">
                        {AVAILABLE_SCOPES.map((scope) => (
                          <UICheckbox key={scope.value} value={scope.value} variant="secondary" className="w-full max-w-full items-start m-0">
                            <div className="w-full min-w-0">
                              <div className="font-medium text-sm">{scope.label}</div>
                              <div className="text-xs text-gray-500 mt-0.5">{scope.description}</div>
                            </div>
                          </UICheckbox>
                        ))}
                      </CheckboxGroup>
                      <p className="text-xs text-gray-500 mt-2">已选择 {formData.allowed_scopes.length} 项权限</p>
                    </div>
                    <Checkbox variant="secondary" isSelected={formData.trusted} onChange={(isSelected) => setFormData({ ...formData, trusted: isSelected })}>
                      <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                      <Checkbox.Content>信任的应用（跳过授权确认）</Checkbox.Content>
                    </Checkbox>
                    <div>
                      <label className="block text-sm font-medium mb-2">默认访问</label>
                      <RadioGroup orientation="vertical" value={formData.default_access ? 'allow' : 'deny'} onChange={(val) => setFormData({ ...formData, default_access: val === 'allow' })} className="space-y-2">
                        <UIRadio value="allow">允许</UIRadio>
                        <UIRadio value="deny">拒绝</UIRadio>
                      </RadioGroup>
                      <p className="text-xs text-gray-500 mt-2">当未配置用户/用户组的应用权限时生效</p>
                    </div>
                  </fieldset>
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button type="button" variant="secondary" onPress={() => { setShowEditModal(false); setEditingClient(null); }}>取消</Button>
                  <Button type="submit" variant="primary" isDisabled={updating} isPending={updating}>{updating ? '保存中...' : '保存'}</Button>
                </AlertDialog.Footer>
              </form>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
