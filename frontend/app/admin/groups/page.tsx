'use client';

import { useEffect, useState } from 'react';
import { adminApi, groupApi, clientApi, groupAppApi } from '@/lib/api';
import SidePanel from '@/components/SidePanel';
import { useAuthStore } from '@/lib/store';
import { isAdmin } from '@/lib/authz';
import { UIButton, UIInput, UITextarea, UICheckbox } from '@/components/ui/primitives';

interface Group {
  id: number;
  name: string;
  description?: string;
  is_default: boolean;
  member_count?: number;
  created_at: string;
  updated_at: string;
}

interface User {
  id: number;
  username: string;
  email: string;
  avatar?: string;
  status: string;
  groups: string[];
}

interface AppItem {
  id: number;
  client_id: string;
  name: string;
  logo?: string;
}

export default function GroupsPage() {
  const user = useAuthStore((s) => s.user);
  const canManageGroups = isAdmin(user);
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [pendingAddIds, setPendingAddIds] = useState<number[]>([]);
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaForm, setMetaForm] = useState({ name: '', description: '' });
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    is_default: false,
  });
  const [apps, setApps] = useState<AppItem[]>([]);
  const [selectedGroupAllowedApps, setSelectedGroupAllowedApps] = useState<number[]>([]);
  const [selectedGroupDeniedApps, setSelectedGroupDeniedApps] = useState<number[]>([]);
  const [appPermissionsLoading, setAppPermissionsLoading] = useState(false);
  const [appSearch, setAppSearch] = useState('');

  useEffect(() => {
    if (!canManageGroups) return;
    void Promise.all([loadGroups(), loadUsers(), loadApps()]);
  }, [canManageGroups]);

  if (!canManageGroups) {
    return (
      <div className="card">
        <h1 className="text-xl font-semibold mb-2">无权限</h1>
        <p className="text-gray-600">该页面仅管理员可访问。</p>
      </div>
    );
  }

  const loadGroups = async () => {
    try {
      const response = await groupApi.list();
      if (Array.isArray(response.data)) {
        setGroups(response.data);
      } else {
        setGroups([]);
      }
    } catch (err) {
      console.error('加载用户组失败', err);
      setGroups([]);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await adminApi.listUsers({ limit: 1000 });
      if (Array.isArray(response.data.items)) {
        setUsers(response.data.items);
      } else {
        setUsers([]);
      }
    } catch {
      // 非管理员可能 403
      setUsers([]);
    }
  };

  const loadApps = async () => {
    try {
      const response = await clientApi.list();
      if (Array.isArray(response.data)) {
        setApps(response.data);
      } else {
        setApps([]);
      }
    } catch {
      setApps([]);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setPanelError(null);
    try {
      await groupApi.create(formData);
      setShowCreateForm(false);
      setFormData({ name: '', description: '', is_default: false });
      await loadGroups();
      await loadUsers();
    } catch (err: any) {
      setPanelError(err.response?.data?.detail || '创建用户组失败');
    }
  };

  const handleDelete = async (id: number) => {
    setPanelError(null);
    try {
      await groupApi.delete(id);
      setPanelOpen(false);
      setSelectedGroup(null);
      await loadGroups();
      await loadUsers();
    } catch {
      setPanelError('删除用户组失败（可能需要管理员权限）');
    }
  };

  const toggleDefault = async (id: number, currentValue: boolean) => {
    setPanelError(null);
    try {
      await groupApi.update(id, { is_default: !currentValue });
      await loadGroups();
    } catch {
      setPanelError('更新失败（可能需要管理员权限）');
    }
  };

  const openPanel = async (group: Group) => {
    setSelectedGroup(group);
    setPanelOpen(true);
    setPanelError(null);
    setPendingAddIds([]);
    setSearch('');
    setEditingMeta(false);
    setMetaForm({ name: group.name, description: group.description || '' });

    // 加载用户组的应用权限
    setAppPermissionsLoading(true);
    try {
      const response = await groupAppApi.getAppPermissions(group.id);
      setSelectedGroupAllowedApps(response.data.allowed_apps.map((app: AppItem) => app.id));
      setSelectedGroupDeniedApps(response.data.denied_apps.map((app: AppItem) => app.id));
    } catch {
      setSelectedGroupAllowedApps([]);
      setSelectedGroupDeniedApps([]);
    } finally {
      setAppPermissionsLoading(false);
    }
  };

  const handleUpdateMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup) return;
    setPanelError(null);

    try {
      const response = await groupApi.update(selectedGroup.id, {
        name: metaForm.name.trim(),
        description: metaForm.description.trim() || undefined,
      });
      setSelectedGroup(response.data);
      setEditingMeta(false);
      await loadUsers();
      await loadGroups();
    } catch (err: any) {
      setPanelError(err.response?.data?.detail || '更新用户组失败（可能需要管理员权限）');
    }
  };

  const members = selectedGroup
    ? users.filter(u => u.groups?.includes(selectedGroup.name))
    : [];

  const availableUsers = selectedGroup
    ? users.filter(u => !u.groups?.includes(selectedGroup.name))
    : [];

  const filteredAvailableUsers = availableUsers.filter(u =>
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const togglePendingAdd = (userId: number) => {
    setPendingAddIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  const handleAddMembers = async () => {
    if (!selectedGroup || pendingAddIds.length === 0) return;
    setPanelError(null);
    try {
      await groupApi.addMembers(selectedGroup.id, pendingAddIds);
      setPendingAddIds([]);
      await loadUsers();
      await loadGroups();
    } catch (err: any) {
      setPanelError(err.response?.data?.detail || '添加成员失败（可能需要管理员权限）');
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!selectedGroup) return;
    setPanelError(null);
    try {
      await groupApi.removeMembers(selectedGroup.id, [userId]);
      await loadUsers();
      await loadGroups();
    } catch (err: any) {
      setPanelError(err.response?.data?.detail || '移除成员失败（可能需要管理员权限）');
    }
  };

  const handleUpdateAppPermissions = async () => {
    if (!selectedGroup) return;
    setPanelError(null);
    try {
      await groupAppApi.updateAppPermissions(selectedGroup.id, {
        allowed_app_ids: selectedGroupAllowedApps,
        denied_app_ids: selectedGroupDeniedApps,
      });
    } catch (err: any) {
      setPanelError(err.response?.data?.detail || '更新应用权限失败');
    }
  };

  const toggleAllowedApp = (appId: number) => {
    // 如果在拒绝列表中，先移除
    if (selectedGroupDeniedApps.includes(appId)) {
      setSelectedGroupDeniedApps(prev => prev.filter(id => id !== appId));
    }
    setSelectedGroupAllowedApps(prev =>
      prev.includes(appId)
        ? prev.filter(id => id !== appId)
        : [...prev, appId]
    );
  };

  const toggleDeniedApp = (appId: number) => {
    // 如果在允许列表中，先移除
    if (selectedGroupAllowedApps.includes(appId)) {
      setSelectedGroupAllowedApps(prev => prev.filter(id => id !== appId));
    }
    setSelectedGroupDeniedApps(prev =>
      prev.includes(appId)
        ? prev.filter(id => id !== appId)
        : [...prev, appId]
    );
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-600">加载中...</div>;
  }

  return (
    <div className="px-4 sm:px-0">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">用户组</h1>
        <UIButton  onPress={() => setShowCreateForm(!showCreateForm)} variant="primary">{showCreateForm ? '取消创建' : '创建用户组'}</UIButton>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <section className="flex-1">
          {showCreateForm && (
            <form onSubmit={handleCreate} className="card mb-6 space-y-4">
              <h2 className="text-lg font-semibold">创建用户组</h2>

              <div>
                <label className="block text-sm font-medium mb-2">组名称 *</label>
                <UIInput
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">描述</label>
                <UITextarea
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="flex items-center">
                <UICheckbox id="is_default" isSelected={formData.is_default} onChange={(isSelected) => setFormData({ ...formData, is_default: isSelected })}>
                  默认组（新用户自动加入）
                </UICheckbox>
              </div>

              {panelError && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
                  {panelError}
                </div>
              )}

              <div className="flex gap-2">
                <UIButton type="submit" variant="primary">创建</UIButton>
                <UIButton type="button" onPress={() => setShowCreateForm(false)} variant="secondary">
                  取消
                </UIButton>
              </div>
            </form>
          )}

          <div className="surface overflow-hidden">
            {groups.length === 0 ? (
              <div className="p-8 text-center text-gray-500">暂无用户组</div>
            ) : (
              <div className="list">
                {groups.map(group => {
                  const active = selectedGroup?.id === group.id;
                  return (
                    <UIButton key={group.id} onPress={() => openPanel(group)} className={`w-full text-left list-item list-item-pressable h-auto p-0 min-w-0 ${
                      active ? 'bg-black/[0.03] dark:bg-white/[0.04]' : ''
                    }`} variant="tertiary" ><div className="flex items-center justify-between gap-4 w-full">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{group.name}</span>
                          {group.is_default && (
                            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-900 shrink-0">
                              默认
                            </span>
                          )}
                        </div>
                        {group.description && (
                          <div className="text-sm text-gray-600 dark:text-gray-300 mt-1 truncate">
                            {group.description}
                          </div>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 shrink-0">
                        {group.member_count || 0} 人
                      </div>
                    </div></UIButton>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <SidePanel
          title={selectedGroup ? `用户组：${selectedGroup.name}` : '用户组详情'}
          open={panelOpen && !!selectedGroup}
          onClose={() => setPanelOpen(false)}
        >
          {!selectedGroup ? (
            <div className="text-gray-500 text-sm">请选择左侧用户组查看详情</div>
          ) : (
            <div className="space-y-6">
              {panelError && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
                  {panelError}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-200">信息</div>
                  {!editingMeta ? (
                    <UIButton type="button"
                    variant="secondary" onPress={() => setEditingMeta(true)} >
                      编辑
                    </UIButton>
                  ) : (
                    <UIButton type="button"
                    variant="secondary" onPress={() => {
                      setEditingMeta(false);
                      setMetaForm({ name: selectedGroup.name, description: selectedGroup.description || '' });
                    }} >
                      取消
                    </UIButton>
                  )}
                </div>

                {!editingMeta ? (
                  <div className="space-y-2">
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      <span className="font-medium text-gray-900 dark:text-gray-100">名称：</span>
                      {selectedGroup.name}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-300">
                      <span className="font-medium text-gray-900 dark:text-gray-100">描述：</span>
                      {selectedGroup.description || '—'}
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleUpdateMeta} className="space-y-3 animate-slide-up">
                    <div>
                      <label className="block text-sm font-medium mb-2">组名称 *</label>
                      <UIInput
                        required
                        value={metaForm.name}
                        onChange={(e) => setMetaForm({ ...metaForm, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-2">描述</label>
                      <UITextarea
                  rows={3}
                        value={metaForm.description}
                        onChange={(e) => setMetaForm({ ...metaForm, description: e.target.value })}
                      />
                    </div>
                    <div className="flex gap-2">
                      <UIButton type="submit" variant="primary">
                        保存
                      </UIButton>
                      <UIButton type="button"
                      variant="secondary" onPress={() => {
                        setEditingMeta(false);
                        setMetaForm({ name: selectedGroup.name, description: selectedGroup.description || '' });
                      }} >
                        取消
                      </UIButton>
                    </div>
                  </form>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-gray-700">默认组</div>
                <UIButton  onPress={() => toggleDefault(selectedGroup.id, selectedGroup.is_default)} variant="secondary">{selectedGroup.is_default ? '取消默认' : '设为默认'}</UIButton>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium text-gray-700">成员</div>
                  <div className="text-sm text-gray-500">{members.length} 人</div>
                </div>
                {members.length === 0 ? (
                  <div className="text-sm text-gray-500">暂无成员</div>
                ) : (
                  <ul className="divide-y border rounded">
                    {members.map(m => (
                      <li key={m.id} className="flex items-center justify-between px-3 py-2">
                        <div className="flex items-center gap-3">
                          {m.avatar ? (
                            <img src={m.avatar} alt={m.username} className="w-8 h-8 rounded-full" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm text-gray-700">
                              {m.username.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="text-sm text-gray-900">{m.username}</div>
                            <div className="text-xs text-gray-500">{m.email}</div>
                          </div>
                        </div>
                        <UIButton onPress={() => handleRemoveMember(m.id)} className="text-red-600 hover:text-red-800 p-0 min-w-0 h-auto" variant="tertiary" size="sm">
                          移除
                        </UIButton>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">添加成员</div>
                {users.length === 0 ? (
                  <div className="text-sm text-gray-500">
                    无法加载用户列表（可能需要管理员权限）
                  </div>
                ) : (
                  <>
                    <UIInput
                      type="text"
                      placeholder="搜索用户名或邮箱"
                      className="mb-3"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                    <div className="max-h-56 overflow-y-auto border rounded">
                      {filteredAvailableUsers.length === 0 ? (
                        <div className="p-3 text-sm text-gray-500">没有可添加的用户</div>
                      ) : (
                        filteredAvailableUsers.map(u => (
                          <UICheckbox key={u.id}
                          className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer max-w-full m-0" isSelected={pendingAddIds.includes(u.id)} onChange={() => togglePendingAdd(u.id)}><div className="flex items-center gap-2">
                            <span className="text-sm text-gray-900">{u.username}</span>
                            <span className="text-xs text-gray-500">{u.email}</span>
                          </div></UICheckbox>
                        ))
                      )}
                    </div>
                    <UIButton type="button" onPress={handleAddMembers} isDisabled={pendingAddIds.length === 0} variant="primary" className="mt-3">
                      添加到用户组
                    </UIButton>
                  </>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-200">应用权限</div>
                  <UIButton type="button" onPress={handleUpdateAppPermissions} variant="primary" isDisabled={appPermissionsLoading} >
                    保存权限
                  </UIButton>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  优先级：用户拒绝 &gt; 用户允许 &gt; 用户组拒绝 &gt; 用户组允许 &gt; 应用默认
                </p>
                <UIInput
                  type="text"
                  value={appSearch}
                  onChange={(e) => setAppSearch(e.target.value)}
                  placeholder="搜索应用名称..."
                  className="mb-3"
                />
                {appPermissionsLoading ? (
                  <div className="text-sm text-gray-500">加载中...</div>
                ) : apps.length === 0 ? (
                  <div className="text-sm text-gray-500">暂无应用</div>
                ) : (
                  <div className="max-h-64 overflow-y-auto border rounded dark:border-gray-700">
                    {apps
                      .filter(app => !appSearch || app.name.toLowerCase().includes(appSearch.toLowerCase()))
                      .map(app => (
                      <div key={app.id} className="flex items-center justify-between px-3 py-2 border-b last:border-b-0 dark:border-gray-700">
                        <div className="flex items-center gap-2 min-w-0">
                          {app.logo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={app.logo}
                              alt={app.name}
                              className="h-6 w-6 rounded border border-gray-200 dark:border-gray-700"
                            />
                          ) : (
                            <div className="h-6 w-6 rounded bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 text-xs">
                              {app.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className="text-sm text-gray-900 dark:text-gray-100 truncate">{app.name}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <UICheckbox  isSelected={selectedGroupAllowedApps.includes(app.id)} onChange={() => toggleAllowedApp(app.id)}
                          className="max-w-full m-0"><span className="text-xs text-green-600 dark:text-green-400">允许</span></UICheckbox>
                          <UICheckbox  isSelected={selectedGroupDeniedApps.includes(app.id)} onChange={() => toggleDeniedApp(app.id)}
                          className="max-w-full m-0"><span className="text-xs text-red-600 dark:text-red-400">拒绝</span></UICheckbox>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t">
                <UIButton  onPress={() => handleDelete(selectedGroup.id)} variant="danger">
                  删除用户组
                </UIButton>
              </div>
            </div>
          )}
        </SidePanel>
      </div>
    </div>
  );
}
