'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { buttonVariants, toast } from '@heroui/react';
import { userApi, totpApi } from '@/lib/api';
import { formatDateTime } from '@/lib/date';
import { useAuthStore } from '@/lib/store';
import { isAdmin } from '@/lib/authz';
import { UIButton, UICheckbox, UIInput, UILabel, UIListBox, UISelect, UISelectItem, UITextField } from '@/components/ui/primitives';

interface SecuritySettings {
  max_sessions: number;
  notify_new_login: boolean;
}

interface TOTPStatus {
  enabled: boolean;
  created_at?: string;
  backup_codes_remaining?: number;
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
  const [totpStatus, setTotpStatus] = useState<TOTPStatus | null>(null);
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
      const [settingsRes, historyRes, totpRes] = await Promise.all([
        userApi.getSecuritySettings(),
        userApi.getLoginHistory(0, 10),
        totpApi.getStatus()
      ]);
      setSettings(settingsRes.data);
      setLoginHistory(historyRes.data);
      setTotpStatus(totpRes.data);
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
      toast('更新设置失败');
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
    <div className="px-4 sm:px-0 animate-fade-in space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">安全设置</h1>
        <p className="text-gray-600 mt-1 text-sm sm:text-base">
          管理您的账户安全设置和查看登录历史。
        </p>
      </div>

      {/* 会话限制设置 */}
      <div className="surface p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-semibold mb-4">会话设置</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              最大并发会话数
            </label>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              同时保持登录状态的设备数量。超出限制时，最早的会话将被自动登出。
            </p>
            {adminUser ? (
              <UISelect
                aria-label="最大并发会话数"
                value={String(settings?.max_sessions || 3)}
                onChange={(value) => handleUpdateSettings({ max_sessions: Number(value ?? '3') })}
                isDisabled={saving}
                className="w-32"
              >
                <UISelect.Trigger>
                  <UISelect.Value />
                  <UISelect.Indicator />
                </UISelect.Trigger>
                <UISelect.Popover>
                  <UIListBox>
                    {[1, 2, 3, 4, 5].map(n => (
                      <UISelectItem key={n} id={String(n)}>{n} 个设备</UISelectItem>
                    ))}
                  </UIListBox>
                </UISelect.Popover>
              </UISelect>
            ) : (
              <div className="text-sm text-gray-700 dark:text-gray-300">
                {settings?.max_sessions || 3} 个设备
                <span className="ml-2 text-xs text-gray-500">（由管理员设置）</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <UICheckbox
              id="notify_new_login"
              isSelected={settings?.notify_new_login || false}
              onChange={(isSelected) => handleUpdateSettings({ notify_new_login: isSelected })}
              isDisabled={saving}
              className="w-full max-w-full items-start m-0"
            ><div className="w-full">
              <div className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                新设备登录通知
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                当有新设备登录您的账户时发送通知
              </div>
            </div></UICheckbox>
          </div>
        </div>
      </div>

      {/* 两步验证 */}
      <div className="surface p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-semibold mb-4">两步验证</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          启用两步验证后，当检测到可疑登录时，需要额外的验证步骤才能登录。
        </p>

        {/* 身份验证器 */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                totpStatus?.enabled
                  ? 'bg-green-100 dark:bg-green-900'
                  : 'bg-gray-100 dark:bg-gray-800'
              }`}>
                <svg className={`w-5 h-5 ${
                  totpStatus?.enabled
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-gray-400 dark:text-gray-500'
                }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">
                  身份验证器 (TOTP)
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {totpStatus?.enabled
                    ? `已启用 · 剩余 ${totpStatus.backup_codes_remaining || 0} 个备用码`
                    : '使用 Google Authenticator 等应用生成验证码'}
                </p>
              </div>
            </div>
            <Link href="/dashboard/security/totp" className={buttonVariants({ variant: 'secondary' })}>
              {totpStatus?.enabled ? '管理' : '设置'}
            </Link>
          </div>
        </div>
      </div>

      {/* 修改密码 */}
      <div className="surface p-4 sm:p-6">
        <h2 className="text-lg sm:text-xl font-semibold mb-4">修改密码</h2>
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
            <UITextField isRequired isDisabled={changingPassword}>
              <UILabel>当前密码</UILabel>
              <UIInput type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="请输入当前密码" />
            </UITextField>
          </div>

          <div>
            <UITextField isRequired isDisabled={changingPassword}>
              <UILabel>新密码</UILabel>
              <UIInput type="password" minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="至少 6 个字符" />
            </UITextField>
          </div>

          <div>
            <UITextField isRequired isDisabled={changingPassword}>
              <UILabel>确认新密码</UILabel>
              <UIInput type="password" minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="再次输入新密码" />
            </UITextField>
          </div>

          <div className="pt-2">
            <UIButton type="submit" isDisabled={changingPassword} variant="primary" isPending={changingPassword}>{changingPassword ? '修改中...' : '修改密码'}</UIButton>
          </div>
        </form>
      </div>

      {/* 登录历史 */}
      <div className="surface overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg sm:text-xl font-semibold">近期登录</h2>
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
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {getStatusBadge(log)}
                      <span className="text-xs sm:text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {log.device_name || '未知设备'}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {getLoginMethodText(log.login_method)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs sm:text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1 sm:gap-2 flex-wrap">
                      {log.ip_address && <span className="break-all">{log.ip_address}</span>}
                      {(log.city || log.country) && (
                        <>
                          <span className="text-gray-400">·</span>
                          <span>{[log.city, log.country].filter(Boolean).join(', ')}</span>
                        </>
                      )}
                    </div>
                    {!log.success && log.failure_reason && (
                      <p className="mt-1 text-xs sm:text-sm text-red-600 dark:text-red-400">
                        失败原因：{log.failure_reason === 'invalid_password' ? '密码错误' :
                          log.failure_reason === 'user_not_found' ? '用户不存在' :
                          log.failure_reason === 'account_suspended' ? '账户已停用' :
                          log.failure_reason}
                      </p>
                    )}
                  </div>
                  <div className="text-left sm:text-right shrink-0">
                    <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                      {formatDateTime(log.created_at)}
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
