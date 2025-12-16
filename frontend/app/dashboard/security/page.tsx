'use client';

import { useEffect, useState } from 'react';
import { userApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { isAdmin } from '@/lib/authz';
import Link from 'next/link';

interface SecuritySettings {
  max_sessions: number;
  notify_new_login: boolean;
}

interface LoginLog {
  id: number;
  success: boolean;
  failure_reason?: string;
  ip_address?: string;
  device_type?: string;
  device_name?: string;
  country?: string;
  city?: string;
  is_suspicious: boolean;
  login_method: string;
  created_at: string;
}

export default function SecurityPage() {
  const { user } = useAuthStore();
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [loginHistory, setLoginHistory] = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Password change form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const adminUser = user && isAdmin(user);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [settingsRes, historyRes] = await Promise.all([
        userApi.getSecuritySettings(),
        userApi.getLoginHistory(0, 10)
      ]);
      setSettings(settingsRes.data);
      setLoginHistory(historyRes.data);
    } catch (err) {
      console.error('Failed to load data', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSettings = async (updates: Partial<SecuritySettings>) => {
    if (!settings) return;

    setSaving(true);
    try {
      const response = await userApi.updateSecuritySettings(updates);
      setSettings(response.data);
    } catch (err) {
      alert('更新设置失败');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword.length < 6) {
      setPasswordError('新密码至少需要 6 个字符');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的密码不一致');
      return;
    }

    setChangingPassword(true);
    try {
      await userApi.changePassword(currentPassword, newPassword);
      setPasswordSuccess('密码修改成功');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setPasswordError(err.response?.data?.detail || '修改密码失败');
    } finally {
      setChangingPassword(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getStatusBadge = (log: LoginLog) => {
    if (!log.success) {
      return (
        <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 dark:bg-red-950 dark:text-red-200 dark:border-red-900">
          失败
        </span>
      );
    }
    if (log.is_suspicious) {
      return (
        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200 dark:bg-yellow-950 dark:text-yellow-200 dark:border-yellow-900">
          可疑
        </span>
      );
    }
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-900">
        成功
      </span>
    );
  };

  const getLoginMethodText = (method: string) => {
    switch (method) {
      case 'passkey': return '通行密钥';
      case 'oauth': return 'OAuth';
      default: return '密码';
    }
  };

  if (loading) {
    return <div className="text-center py-12">加载中...</div>;
  }

  return (
    <div className="px-4 sm:px-0 animate-fade-in space-y-8">
      <div>
        <h1 className="text-3xl font-bold">安全设置</h1>
        <p className="text-gray-600 mt-1">
          管理您的账户安全设置和查看登录历史。
        </p>
      </div>

      {/* 会话限制设置 */}
      <div className="surface p-6">
        <h2 className="text-xl font-semibold mb-4">会话设置</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              最大并发会话数
            </label>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              同时保持登录状态的设备数量。超出限制时，最早的会话将被自动登出。
            </p>
            {adminUser ? (
              <select
                value={settings?.max_sessions || 3}
                onChange={(e) => handleUpdateSettings({ max_sessions: Number(e.target.value) })}
                disabled={saving}
                className="input w-32"
              >
                {[1, 2, 3, 4, 5].map(n => (
                  <option key={n} value={n}>{n} 个设备</option>
                ))}
              </select>
            ) : (
              <div className="text-sm text-gray-700 dark:text-gray-300">
                {settings?.max_sessions || 3} 个设备
                <span className="ml-2 text-xs text-gray-500">（由管理员设置）</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="notify_new_login"
              checked={settings?.notify_new_login || false}
              onChange={(e) => handleUpdateSettings({ notify_new_login: e.target.checked })}
              disabled={saving}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
            />
            <div>
              <label htmlFor="notify_new_login" className="block text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                新设备登录通知
              </label>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                当有新设备登录您的账户时发送通知
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 修改密码 */}
      <div className="surface p-6">
        <h2 className="text-xl font-semibold mb-4">修改密码</h2>
        <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
          {passwordError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg dark:bg-red-950 dark:border-red-900">
              <p className="text-sm text-red-600 dark:text-red-200">{passwordError}</p>
            </div>
          )}
          {passwordSuccess && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg dark:bg-green-950 dark:border-green-900">
              <p className="text-sm text-green-600 dark:text-green-200">{passwordSuccess}</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              当前密码
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={changingPassword}
              className="input w-full"
              placeholder="请输入当前密码"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              新密码
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={changingPassword}
              className="input w-full"
              placeholder="至少 6 个字符"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              确认新密码
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={changingPassword}
              className="input w-full"
              placeholder="再次输入新密码"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={changingPassword}
              className="btn btn-primary disabled:opacity-50"
            >
              {changingPassword ? '修改中...' : '修改密码'}
            </button>
          </div>
        </form>
      </div>

      {/* 快捷链接 */}
      <div className="surface p-6">
        <h2 className="text-xl font-semibold mb-4">安全管理</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/dashboard/sessions"
            className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">活跃会话</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">管理您的登录设备</p>
            </div>
          </Link>

          <Link
            href="/dashboard/passkeys"
            className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            <div className="p-2 bg-green-100 dark:bg-green-900 rounded-lg">
              <svg className="w-5 h-5 text-green-600 dark:text-green-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <div>
              <h3 className="font-medium text-gray-900 dark:text-gray-100">通行密钥</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">管理无密码登录方式</p>
            </div>
          </Link>
        </div>
      </div>

      {/* 登录历史 */}
      <div className="surface overflow-hidden">
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold">近期登录</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            您账户的最近登录记录
          </p>
        </div>

        {loginHistory.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">暂无登录记录</p>
          </div>
        ) : (
          <ul className="list">
            {loginHistory.map((log) => (
              <li key={log.id} className="list-item">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getStatusBadge(log)}
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {log.device_name || '未知设备'}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {getLoginMethodText(log.login_method)}
                      </span>
                    </div>
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2 flex-wrap">
                      {log.ip_address && <span>IP: {log.ip_address}</span>}
                      {(log.city || log.country) && (
                        <>
                          <span className="text-gray-400">·</span>
                          <span>{[log.city, log.country].filter(Boolean).join(', ')}</span>
                        </>
                      )}
                    </div>
                    {!log.success && log.failure_reason && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        失败原因：{log.failure_reason === 'invalid_password' ? '密码错误' :
                          log.failure_reason === 'user_not_found' ? '用户不存在' :
                          log.failure_reason === 'account_suspended' ? '账户已停用' :
                          log.failure_reason}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {formatDate(log.created_at)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
