'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Input, ListBox, ListBoxItem, Select } from '@heroui/react';
import { adminApi, groupApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { isAdmin } from '@/lib/authz';
import { formatDateTime } from '@/lib/date';

interface Group {
  id: number;
  name: string;
}

interface Invite {
  id: number;
  code: string;
  note?: string | null;
  group_id: number;
  group_name: string;
  is_active: boolean;
  expires_at?: string | null;
  max_uses?: number | null;
  used_count: number;
  created_by_user_id?: number | null;
  used_by_user_id?: number | null;
  used_at?: string | null;
  created_at: string;
  updated_at: string;
}

export default function InvitesPage() {
  const user = useAuthStore((s) => s.user);
  const canManage = isAdmin(user);

  const [groups, setGroups] = useState<Group[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createForm, setCreateForm] = useState({
    groupId: 0,
    note: '',
    expiresAtLocal: '',
    maxUses: '',
  });
  const [creating, setCreating] = useState(false);
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('active');

  useEffect(() => {
    if (!canManage) return;
    void loadAll();
  }, [canManage]);

  const loadAll = async () => {
    setError(null);
    setLoading(true);
    try {
      const [groupsRes, invitesRes] = await Promise.all([
        groupApi.list(),
        adminApi.listInvites({ limit: 200 }),
      ]);
      setGroups(Array.isArray(groupsRes.data) ? groupsRes.data : []);
      setInvites(Array.isArray(invitesRes.data) ? invitesRes.data : []);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载邀请码失败');
      setGroups([]);
      setInvites([]);
    } finally {
      setLoading(false);
    }
  };

  const filteredInvites = useMemo(() => {
    if (filterActive === 'all') return invites;
    const target = filterActive === 'active';
    return invites.filter((i) => i.is_active === target);
  }, [invites, filterActive]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!createForm.groupId) {
      setError('请选择用户组');
      return;
    }

    let maxUses: number | undefined;
    if (createForm.maxUses.trim()) {
      maxUses = Number(createForm.maxUses.trim());
      if (!Number.isFinite(maxUses) || maxUses < 1) {
        setError('使用次数必须为正整数，或留空表示不限制');
        return;
      }
    }

    setCreating(true);
    try {
      const expiresAt = createForm.expiresAtLocal
        ? new Date(createForm.expiresAtLocal).toISOString()
        : undefined;
      const res = await adminApi.createInvite({
        group_id: createForm.groupId,
        note: createForm.note.trim() || undefined,
        expires_at: expiresAt,
        max_uses: maxUses,
      });

      setInvites((prev) => [res.data, ...prev]);
      setCreateForm({ groupId: createForm.groupId, note: '', expiresAtLocal: '', maxUses: '' });
    } catch (err: any) {
      setError(err.response?.data?.detail || '创建邀请码失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDeactivate = async (inviteId: number) => {
    setError(null);
    try {
      const res = await adminApi.updateInvite(inviteId, { is_active: false });
      setInvites((prev) => prev.map((i) => (i.id === inviteId ? res.data : i)));
    } catch (err: any) {
      setError(err.response?.data?.detail || '停用邀请码失败');
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  };

  if (!canManage) {
    return (
      <div className="card">
        <h1 className="text-xl font-semibold mb-2">无权限</h1>
        <p className="text-gray-600">该页面仅管理员可访问。</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">邀请码</h1>
            <p className="text-gray-600 mt-1">邀请制注册：邀请码决定新用户所属用户组。</p>
          </div>
          <Button onPress={loadAll} variant="secondary" isDisabled={loading} >
            刷新
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="card">
        <h2 className="text-lg font-semibold mb-4">生成邀请码</h2>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">用户组</label>
            <Select
              placeholder="请选择"
              selectedKey={createForm.groupId ? String(createForm.groupId) : ''}
              onSelectionChange={(key) => setCreateForm((p) => ({ ...p, groupId: Number(String(key ?? '')) }))}
              isDisabled={creating}
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <SelectItem id="">请选择</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} id={String(g.id)}>{g.name}</SelectItem>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">过期时间（可选）</label>
            <Input
              type="datetime-local"
              value={createForm.expiresAtLocal}
              onChange={(e) => setCreateForm((p) => ({ ...p, expiresAtLocal: e.target.value }))}
              disabled={creating}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">使用次数（可选）</label>
            <Input
              type="number"
              min={1}
              value={createForm.maxUses}
              onChange={(e) => setCreateForm((p) => ({ ...p, maxUses: e.target.value }))}
              disabled={creating}
              placeholder="留空表示不限制"
            />
          </div>

          <div className="flex items-end md:justify-end">
            <Button className="w-full md:w-auto" variant="primary" type="submit" isDisabled={creating} >{creating ? '生成中...' : '生成'}</Button>
          </div>
        </form>
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">备注（可选）</label>
          <Input
            value={createForm.note}
            onChange={(e) => setCreateForm((p) => ({ ...p, note: e.target.value }))}
            disabled={creating}
            placeholder="例如：发给某位同学"
          />
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h2 className="text-lg font-semibold">邀请码列表</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">筛选：</span>
            <Select
              className="w-32"
              selectedKey={filterActive}
              onSelectionChange={(key) => setFilterActive(String(key) as any)}
              isDisabled={loading}
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <SelectItem id="active">仅有效</SelectItem>
                  <SelectItem id="inactive">仅无效</SelectItem>
                  <SelectItem id="all">全部</SelectItem>
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="text-gray-600">加载中...</div>
        ) : filteredInvites.length === 0 ? (
          <div className="text-gray-600">暂无邀请码</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2 pr-4">邀请码</th>
                  <th className="py-2 pr-4">用户组</th>
                  <th className="py-2 pr-4">状态</th>
                  <th className="py-2 pr-4">使用情况</th>
                  <th className="py-2 pr-4">备注</th>
                  <th className="py-2 pr-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvites.map((i) => {
                  const usedCount = i.used_count ?? 0;
                  const limitText = i.max_uses ? `${usedCount}/${i.max_uses}` : `${usedCount}/∞`;
                  return (
                  <tr key={i.id} className="border-t border-gray-100">
                    <td className="py-2 pr-4 font-mono">
                      {i.code}
                      <Button className="ml-2 text-blue-600 hover:text-blue-700 h-auto p-0 min-w-0" onPress={() => copy(i.code)} type="button" variant="tertiary" size="sm">
                        复制
                      </Button>
                    </td>
                    <td className="py-2 pr-4">{i.group_name || `#${i.group_id}`}</td>
                    <td className="py-2 pr-4">
                      {i.is_active ? (
                        <span className="text-green-700">有效</span>
                      ) : (
                        <span className="text-gray-500">无效</span>
                      )}
                      {i.expires_at ? (
                        <span className="text-gray-500 ml-2">({formatDateTime(i.expires_at)})</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="text-gray-700">{limitText}</span>
                      {i.used_at ? (
                        <span className="text-gray-500 ml-2">最后一次：{formatDateTime(i.used_at)}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 text-gray-700">{i.note || ''}</td>
                    <td className="py-2 pr-4">
                      <Button variant="secondary" type="button" isDisabled={!i.is_active} onPress={() => handleDeactivate(i.id)} size="sm">
                        停用
                      </Button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
