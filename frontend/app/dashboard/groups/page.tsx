'use client';

import { useEffect, useState } from 'react';
import { groupApi } from '@/lib/api';

interface Group {
  id: number;
  name: string;
  description?: string;
  is_default: boolean;
  member_count?: number;
  created_at: string;
  updated_at: string;
}

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    is_default: false,
  });

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      const response = await groupApi.list();
      // Ensure we have an array before setting groups
      if (Array.isArray(response.data)) {
        setGroups(response.data);
      } else {
        console.error('Invalid response format:', response.data);
        setGroups([]);
      }
    } catch (err) {
      console.error('加载用户组失败', err);
      setGroups([]); // Ensure groups is always an array even on error
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await groupApi.create(formData);
      alert('用户组创建成功！');

      setShowCreateForm(false);
      setFormData({
        name: '',
        description: '',
        is_default: false,
      });
      loadGroups();
    } catch (err: any) {
      alert('创建用户组失败: ' + (err.response?.data?.detail || '未知错误'));
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定要删除用户组 "${name}" 吗？`)) return;

    try {
      await groupApi.delete(id);
      loadGroups();
    } catch (err) {
      alert('删除用户组失败');
    }
  };

  const toggleDefault = async (id: number, currentValue: boolean) => {
    try {
      await groupApi.update(id, { is_default: !currentValue });
      loadGroups();
    } catch (err) {
      alert('更新失败');
    }
  };

  if (loading) {
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div className="px-4 sm:px-0">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">用户组管理</h1>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="btn btn-primary"
        >
          {showCreateForm ? '取消' : '+ 创建用户组'}
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreate} className="card mb-8 space-y-4">
          <h2 className="text-xl font-semibold">创建新用户组</h2>

          <div>
            <label className="block text-sm font-medium mb-2">组名称 *</label>
            <input
              type="text"
              required
              className="input"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">描述</label>
            <textarea
              className="input"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_default"
              checked={formData.is_default}
              onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
              className="h-4 w-4"
            />
            <label htmlFor="is_default" className="ml-2 text-sm">
              默认组（新用户自动加入）
            </label>
          </div>

          <button type="submit" className="btn btn-primary">
            创建用户组
          </button>
        </form>
      )}

      <div className="space-y-4">
        {!groups || groups.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-500">还没有用户组，创建一个开始吧！</p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.id} className="card">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold">{group.name}</h3>
                    {group.is_default && (
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        默认组
                      </span>
                    )}
                  </div>
                  {group.description && (
                    <p className="text-sm text-gray-600 mt-1">{group.description}</p>
                  )}
                  <div className="mt-3 text-sm text-gray-500">
                    <span>成员数量: {group.member_count || 0}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleDefault(group.id, group.is_default)}
                    className="btn btn-secondary text-sm"
                  >
                    {group.is_default ? '取消默认' : '设为默认'}
                  </button>
                  <button
                    onClick={() => handleDelete(group.id, group.name)}
                    className="btn btn-danger text-sm"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
