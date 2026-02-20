'use client';

import { useEffect, useState } from 'react';
import { siteApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { isAdmin } from '@/lib/authz';
import { UIButton, UIInput, UILabel, UITextField } from '@/components/ui/primitives';

export default function SiteSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const canManage = isAdmin(user);

  const [siteName, setSiteName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    setLoading(true);
    siteApi.get()
      .then((res) => setSiteName(res.data?.site_name || ''))
      .catch((err) => setError(err.response?.data?.detail || '加载站点配置失败'))
      .finally(() => setLoading(false));
  }, [canManage]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const trimmed = siteName.trim();
    if (!trimmed) {
      setError('站点名称不能为空');
      return;
    }
    setSaving(true);
    try {
      const res = await siteApi.update(trimmed);
      setSiteName(res.data?.site_name || trimmed);
      setSuccess('已保存');
      window.setTimeout(() => setSuccess(null), 1500);
    } catch (err: any) {
      setError(err.response?.data?.detail || '保存失败');
    } finally {
      setSaving(false);
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
        <h1 className="text-2xl font-bold">站点设置</h1>
        <p className="text-gray-600 mt-1">修改网站昵称（用于前端显示）。</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
          {success}
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="text-gray-600">加载中...</div>
        ) : (
          <form onSubmit={save} className="space-y-4 max-w-lg">
            <div>
              <UITextField isDisabled={saving}>
                <UILabel>网站昵称</UILabel>
                <UIInput value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="例如：LAAA OAuth" />
              </UITextField>
            </div>
            <UIButton variant="primary" type="submit" isDisabled={saving} isPending={saving}>{saving ? '保存中...' : '保存'}</UIButton>
          </form>
        )}
      </div>
    </div>
  );
}
