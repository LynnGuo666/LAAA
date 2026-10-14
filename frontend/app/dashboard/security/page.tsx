'use client';

import { useEffect, useState } from 'react';
import { AlertDialog, Alert, Button, Card, Chip, Description, Input, Label, Table, Tabs, TextField, toast } from '@heroui/react';
import { authApi, userApi, totpApi, passkeyApi } from '@/lib/api';
import { formatDateTime } from '@/lib/date';
import { useAuthStore } from '@/lib/store';
import { extractErrorMessage } from '@/lib/errors';
import { PASSWORD_REQUIREMENT_HINT, validatePasswordStrength } from '@/lib/validation';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { TotpManageModal } from '@/components/security/TotpManageModal';
import { SkeletonRows } from '@/components/ui/loading';
import { Check, AlertTriangle, Smartphone, Tablet, Monitor, ShieldCheck } from 'lucide-react';
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  parseRegistrationOptions,
  createPasskeyCredential,
  serializeRegistrationCredential,
  suggestPasskeyName,
  PasskeyCredential,
} from '@/lib/webauthn';

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

interface Session {
  id: number;
  device_id: string;
  device_name?: string;
  device_type?: string;
  ip_address?: string;
  last_active: string;
  expires_at: string;
  is_current: boolean;
  country?: string;
  city?: string;
  is_trusted: boolean;
}

interface PasskeyRegistrationPayload {
  id: string;
  rawId: string;
  response: object;
  type: string;
  clientExtensionResults?: object;
  authenticatorAttachment?: string;
  challenge_id?: number;
}

interface ApiErrorLike {
  message?: string;
  name?: string;
  response?: {
    data?: {
      detail?: string;
    };
  };
}

type SecurityTabKey = 'totp' | 'sessions' | 'password' | 'history' | 'passkeys';

// 兼容 422 数组形态 detail 等结构，统一走共享工具（lib/errors.ts）
function getApiErrorMessage(err: unknown, fallback: string): string {
  return extractErrorMessage(err, fallback);
}

export default function SecurityPage() {
  const confirmDialog = useConfirmDialog();
  const { user, setUser } = useAuthStore();
  const [totpStatus, setTotpStatus] = useState<TOTPStatus | null>(null);
  const [loginHistory, setLoginHistory] = useState<LoginLog[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // Password change form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const [platformAvailable, setPlatformAvailable] = useState(false);
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [newPasskeyName, setNewPasskeyName] = useState('');
  const [pendingCredential, setPendingCredential] = useState<PasskeyRegistrationPayload | null>(null);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [selectedPasskey, setSelectedPasskey] = useState<PasskeyCredential | null>(null);
  const [detailPasskeyName, setDetailPasskeyName] = useState('');
  const [renamingPasskey, setRenamingPasskey] = useState(false);
  const [showPasskeyDetailModal, setShowPasskeyDetailModal] = useState(false);
  const [pendingDeletePasskey, setPendingDeletePasskey] = useState<{ id: number; name: string } | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletingPasskey, setDeletingPasskey] = useState(false);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [showSessionDetailModal, setShowSessionDetailModal] = useState(false);
  const [showTotpManageModal, setShowTotpManageModal] = useState(false);
  const [activeTab, setActiveTab] = useState<SecurityTabKey>('totp');

  useEffect(() => {
    checkWebAuthnSupport();
    loadData();
  }, []);

  useEffect(() => {
    const syncTabFromHash = () => {
      if (typeof window === 'undefined') return;
      const hash = window.location.hash.replace('#', '') as SecurityTabKey;
      if (['totp', 'sessions', 'password', 'history', 'passkeys'].includes(hash)) {
        setActiveTab(hash);
      }
    };

    syncTabFromHash();
    window.addEventListener('hashchange', syncTabFromHash);
    return () => window.removeEventListener('hashchange', syncTabFromHash);
  }, []);

  const handleTabChange = (key: string) => {
    const nextKey = key as SecurityTabKey;
    setActiveTab(nextKey);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${nextKey}`);
    }
  };

  const checkWebAuthnSupport = async () => {
    const supported = isWebAuthnSupported();
    setWebAuthnSupported(supported);
    if (supported) {
      const platform = await isPlatformAuthenticatorAvailable();
      setPlatformAvailable(platform);
    }
  };

  const loadData = async () => {
    try {
      setPageError(null);
      const [historyRes, totpRes, sessionsRes, passkeysRes] = await Promise.all([
        userApi.getLoginHistory(0, 10),
        totpApi.getStatus(),
        userApi.getSessions(),
        passkeyApi.list(),
      ]);
      setLoginHistory(historyRes.data);
      setTotpStatus(totpRes.data);
      setSessions(sessionsRes.data);
      setPasskeys(passkeysRes.data);
    } catch (err) {
      console.error('Failed to load data', err);
      setPageError('加载安全信息失败，请刷新页面重试');
    } finally {
      setLoading(false);
    }
  };

  const loadSessions = async () => {
    try {
      const response = await userApi.getSessions();
      setSessions(response.data);
    } catch (err) {
      console.error('Failed to load sessions', err);
    }
  };

  const loadPasskeys = async () => {
    try {
      const response = await passkeyApi.list();
      setPasskeys(response.data);
    } catch (err) {
      console.error('Failed to load passkeys', err);
    }
  };

  const handleRevokeSession = async (id: number, deviceName: string) => {
    const shouldRevoke = await confirmDialog({
      title: '确认撤销会话',
      description: `确定要撤销 "${deviceName}" 的会话吗？`,
      confirmText: '撤销',
      cancelText: '取消',
      status: 'warning',
      confirmVariant: 'danger',
    });
    if (!shouldRevoke) return;

    try {
      await userApi.revokeSession(id);
      await loadSessions();
    } catch {
      toast('撤销会话失败');
    }
  };

  const handleRevokeOtherSessions = async () => {
    const shouldRevokeOthers = await confirmDialog({
      title: '确认登出其他设备',
      description: '确定要登出所有其他设备吗？',
      confirmText: '确认登出',
      cancelText: '取消',
      status: 'warning',
      confirmVariant: 'danger',
    });
    if (!shouldRevokeOthers) return;

    setRevoking(true);
    try {
      const response = await userApi.revokeOtherSessions();
      const kickedCount = response.data?.kicked_count ?? 0;
      toast(kickedCount > 0 ? `已登出 ${kickedCount} 个设备` : '没有其他设备需要登出');
      await loadSessions();
    } catch {
      toast('操作失败');
    } finally {
      setRevoking(false);
    }
  };

  const handleToggleTrust = async (session: Session) => {
    try {
      if (session.is_trusted) {
        await userApi.unmarkSessionTrusted(session.id);
      } else {
        await userApi.markSessionTrusted(session.id);
      }
      await loadSessions();
    } catch {
      toast('操作失败');
    }
  };

  const handleShowSessionDetail = (session: Session) => {
    setSelectedSession(session);
    setShowSessionDetailModal(true);
  };

  const handleCloseSessionDetail = () => {
    setShowSessionDetailModal(false);
    setSelectedSession(null);
  };

  const handleRegisterPasskey = async () => {
    if (!webAuthnSupported) {
      setPasskeyError('您的浏览器不支持通行密钥');
      return;
    }

    setPasskeyError(null);
    setRegisteringPasskey(true);
    try {
      const optionsResponse = await passkeyApi.getRegistrationOptions();
      const options = parseRegistrationOptions(optionsResponse.data);
      const credential = await createPasskeyCredential(options);
      const serialized = serializeRegistrationCredential(credential) as PasskeyRegistrationPayload;
      // challenge_id 绑定本次注册对应的 challenge(verify 精确按 id 取)
      serialized.challenge_id = optionsResponse.data.challenge_id;
      setPendingCredential(serialized);
      setNewPasskeyName(suggestPasskeyName());
      setShowNameModal(true);
    } catch (err: unknown) {
      const error = err as ApiErrorLike;
      if (error.name === 'NotAllowedError') {
        setPasskeyError('用户取消了操作或设备不支持');
      } else if (error.name === 'InvalidStateError') {
        setPasskeyError('此设备已经注册过通行密钥');
      } else {
        setPasskeyError(getApiErrorMessage(err, '注册通行密钥失败'));
      }
    } finally {
      setRegisteringPasskey(false);
    }
  };

  const handleConfirmPasskeyRegistration = async () => {
    if (!pendingCredential || !newPasskeyName.trim()) return;

    setRegisteringPasskey(true);
    try {
      await passkeyApi.verifyRegistration({
        ...pendingCredential,
        name: newPasskeyName.trim(),
      });
      setShowNameModal(false);
      setPendingCredential(null);
      setNewPasskeyName('');
      await loadPasskeys();
    } catch (err: unknown) {
      setPasskeyError(getApiErrorMessage(err, '验证通行密钥失败'));
    } finally {
      setRegisteringPasskey(false);
    }
  };

  const handleRenameSelectedPasskey = async () => {
    if (!selectedPasskey || !detailPasskeyName.trim()) return;
    setRenamingPasskey(true);
    try {
      await passkeyApi.rename(selectedPasskey.id, detailPasskeyName.trim());
      await loadPasskeys();
      setSelectedPasskey((previous) => {
        if (!previous) return previous;
        return { ...previous, name: detailPasskeyName.trim() };
      });
    } catch {
      toast('重命名失败');
    } finally {
      setRenamingPasskey(false);
    }
  };

  const handleDeletePasskey = async (id: number, name: string) => {
    setDeletePassword('');
    setDeletingPasskey(false);
    setPendingDeletePasskey({ id, name });
  };

  const handleConfirmDeletePasskey = async () => {
    if (!pendingDeletePasskey) return;
    if (!deletePassword) {
      toast('请输入密码');
      return;
    }

    setDeletingPasskey(true);
    try {
      await passkeyApi.delete(pendingDeletePasskey.id, deletePassword);
      setPendingDeletePasskey(null);
      setDeletePassword('');
      await loadPasskeys();
    } catch (err) {
      toast(getApiErrorMessage(err, '删除失败'));
    } finally {
      setDeletingPasskey(false);
    }
  };

  const handleShowPasskeyDetail = (passkey: PasskeyCredential) => {
    setSelectedPasskey(passkey);
    setDetailPasskeyName(passkey.name);
    setShowPasskeyDetailModal(true);
  };

  const handleClosePasskeyDetail = () => {
    setShowPasskeyDetailModal(false);
    setSelectedPasskey(null);
    setDetailPasskeyName('');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    // 新密码强度校验（与后端策略一致：12 位 + 3 类）
    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      setPasswordError(strength.message);
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
      // 改密成功后刷新用户信息:清除 must_change_password 标志
      // (首登/管理员重置后的强引导提示条随之消失)
      try {
        const meRes = await authApi.getMe();
        setUser(meRes.data);
      } catch {
        // 刷新失败不影响主流程;下次 getMe 会拿到最新标志
      }
    } catch (err: any) {
      setPasswordError(extractErrorMessage(err, '修改密码失败'));
    } finally {
      setChangingPassword(false);
    }
  };

  const getStatusBadge = (log: LoginLog) => {
    if (!log.success) {
      return <Chip color="danger" variant="soft" size="sm">失败</Chip>;
    }
    if (log.is_suspicious) {
      return <Chip color="warning" variant="soft" size="sm">可疑</Chip>;
    }
    return <Chip color="success" variant="soft" size="sm">成功</Chip>;
  };

  const getLoginMethodText = (method: string) => {
    switch (method) {
      case 'passkey': return '通行密钥';
      case 'oauth': return 'OAuth';
      default: return '密码';
    }
  };

  const getDeviceIcon = (deviceType?: string) => {
    if (deviceType === 'mobile') {
      return <Smartphone className="w-5 h-5" />;
    }
    if (deviceType === 'tablet') {
      return <Tablet className="w-5 h-5" />;
    }
    return <Monitor className="w-5 h-5" />;
  };

  if (loading) {
    return (
      <div className="px-4 sm:px-0 animate-fade-in space-y-6 sm:space-y-8" role="status" aria-live="polite">
        <div>
          <div className="h-8 w-44 animate-pulse rounded bg-surface-secondary/70" />
          <div className="mt-2 h-4 w-64 animate-pulse rounded bg-surface-secondary/70" />
        </div>
        <div className="card card--default p-4 sm:p-6">
          <div className="grid grid-cols-1 lg:grid-cols-[180px_minmax(0,1fr)] gap-3 sm:gap-4">
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="h-8 animate-pulse rounded bg-surface-secondary/70" />
              ))}
            </div>
            <SkeletonRows rows={8} rowClassName="h-10" />
          </div>
        </div>
        <span className="sr-only">加载中...</span>
      </div>
    );
  }

  const otherSessionsCount = sessions.filter((session) => !session.is_current).length;

  return (
    <div className="px-4 sm:px-0 animate-fade-in space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">安全设置</h1>
        <p className="text-muted mt-1 text-sm sm:text-base">
          管理您的账户安全设置和查看登录历史。
        </p>
      </div>

      {pageError && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content><Alert.Description>{pageError}</Alert.Description></Alert.Content>
        </Alert>
      )}

      {/* 两步验证 */}
      <div className="card card--default p-4 sm:p-6">
        <Tabs selectedKey={activeTab} onSelectionChange={(key) => handleTabChange(String(key))} className="w-full">
          <div className="grid grid-cols-1 lg:grid-cols-[180px_minmax(0,1fr)] gap-3 sm:gap-4">
          <Tabs.ListContainer className="lg:pr-1">
            <Tabs.List aria-label="安全栏目" className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
              <Tabs.Tab id="totp" className="text-sm font-medium whitespace-nowrap justify-start">验证方式<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="sessions" className="text-sm font-medium whitespace-nowrap justify-start">设备会话<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="password" className="text-sm font-medium whitespace-nowrap justify-start">密码安全<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="history" className="text-sm font-medium whitespace-nowrap justify-start">登录记录<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="passkeys" className="text-sm font-medium whitespace-nowrap justify-start">通行密钥<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          <Card className="min-w-0 border border-border bg-surface-secondary p-3 sm:p-4">

          <Tabs.Panel id="totp" className="pt-4">
            <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-2">验证方式</h2>
            <p className="text-sm text-muted mb-4">
              启用两步验证后，当检测到可疑登录时，需要额外的验证步骤才能登录。
            </p>
            <div className="border border-border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    totpStatus?.enabled
                      ? 'bg-success/10'
                      : 'bg-default'
                  }`}>
                    <ShieldCheck className={`w-5 h-5 ${
                      totpStatus?.enabled
                        ? 'text-success'
                        : 'text-foreground/60'
                    }`} />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">身份验证器 (TOTP)</h3>
                    <p className="text-sm text-muted">
                      {totpStatus?.enabled
                        ? `已启用 · 剩余 ${totpStatus.backup_codes_remaining || 0} 个备用码`
                        : '使用 Google Authenticator 等应用生成验证码'}
                    </p>
                  </div>
                </div>
                <Button onPress={() => setShowTotpManageModal(true)} variant="secondary">
                  {totpStatus?.enabled ? '管理' : '设置'}
                </Button>
              </div>
            </div>
          </Tabs.Panel>

          <Tabs.Panel id="sessions" className="pt-4">
            <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold text-foreground">设备会话</h2>
            <p className="text-sm text-muted mt-1">管理当前登录设备和会话状态</p>
          </div>
          {otherSessionsCount > 0 && (
            <Button onPress={handleRevokeOtherSessions} isDisabled={revoking} variant="danger" className="text-sm shrink-0 w-full sm:w-auto">
              {revoking ? '处理中...' : `登出其他设备 (${otherSessionsCount})`}
            </Button>
          )}
        </div>
        {sessions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted">暂无活跃会话</p>
          </div>
        ) : (
          <div className="overflow-hidden">
          <ul className="list">
            {sessions.map((session) => (
              <li key={session.id} className="list-item">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2 bg-default rounded-lg text-muted shrink-0">
                      {getDeviceIcon(session.device_type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm sm:text-base font-semibold text-foreground break-all">
                          {session.device_name || '未知设备'}
                        </h3>
                        {session.is_current && (
                          <Chip color="success" variant="soft" size="sm">当前</Chip>
                        )}
                        {session.is_trusted && (
                          <Chip color="accent" variant="soft" size="sm">可信</Chip>
                        )}
                      </div>
                      <div className="mt-1 text-xs sm:text-sm text-muted flex items-center gap-1 sm:gap-2 flex-wrap">
                        <span>
                          {session.device_type === 'mobile' ? '手机' : session.device_type === 'tablet' ? '平板' : '电脑'}
                        </span>
                        <span className="text-foreground/60">·</span>
                        <span>点击详情查看完整信息</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-10 sm:ml-0">
                    <Button onPress={() => handleShowSessionDetail(session)} variant="tertiary" className="text-xs sm:text-sm">
                      详情
                    </Button>
                    {!session.is_current && (
                      <Button onPress={() => handleToggleTrust(session)} variant={session.is_trusted ? 'tertiary' : 'primary'} className="text-xs sm:text-sm" aria-label={session.is_trusted ? '取消信任' : '标记为可信'}>
                        {session.is_trusted ? '取消信任' : '信任'}
                      </Button>
                    )}
                    <Button onPress={() => handleRevokeSession(session.id, session.device_name || '当前设备')} variant="danger" className="text-xs sm:text-sm">
                      撤销
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          </div>
        )}
      </div>
          </Tabs.Panel>

          <Tabs.Panel id="password" className="pt-4">
        <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-4">密码安全</h2>
        {user?.must_change_password && (
          <Alert status="warning" className="mb-4 max-w-md">
            <Alert.Indicator />
            <Alert.Content><Alert.Description>
              当前密码为初始密码或由管理员重置，请立即修改密码。修改成功前，系统会在各页面持续提醒。
            </Alert.Description></Alert.Content>
          </Alert>
        )}
        <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
          {passwordError && (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content><Alert.Description>{passwordError}</Alert.Description></Alert.Content>
            </Alert>
          )}
          {passwordSuccess && (
            <Alert status="success">
              <Alert.Indicator />
              <Alert.Content><Alert.Description>{passwordSuccess}</Alert.Description></Alert.Content>
            </Alert>
          )}

          <div>
            <TextField isRequired isDisabled={changingPassword}>
              <Label>当前密码</Label>
              <Input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="请输入当前密码" />
            </TextField>
          </div>

          <div>
            <TextField isRequired isDisabled={changingPassword}>
              <Label>新密码</Label>
              <Input type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={PASSWORD_REQUIREMENT_HINT} />
              <Description>{PASSWORD_REQUIREMENT_HINT}</Description>
            </TextField>
          </div>

          <div>
            <TextField isRequired isDisabled={changingPassword}>
              <Label>确认新密码</Label>
              <Input type="password" minLength={12} autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="再次输入新密码" />
            </TextField>
          </div>

          <div className="pt-2">
            <Button type="submit" isDisabled={changingPassword} variant="primary" isPending={changingPassword}>{changingPassword ? '修改中...' : '修改密码'}</Button>
          </div>
        </form>
          </Tabs.Panel>

          <Tabs.Panel id="history" className="pt-4">
            <div className="space-y-4">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-foreground">登录记录</h2>
          <p className="text-sm text-muted mt-1">
            您账户的最近登录行为记录
          </p>
        </div>

        {loginHistory.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted">暂无登录记录</p>
          </div>
        ) : (
          <Table aria-label="登录记录">
            <Table.ScrollContainer>
              <Table.Content>
                <Table.Header>
                  <Table.Column isRowHeader>状态</Table.Column>
                  <Table.Column>设备</Table.Column>
                  <Table.Column>登录方式</Table.Column>
                  <Table.Column>IP / 地点</Table.Column>
                  <Table.Column>时间</Table.Column>
                </Table.Header>
                <Table.Body>
                  {loginHistory.map((log) => (
                    <Table.Row key={log.id} id={String(log.id)}>
                      <Table.Cell>{getStatusBadge(log)}</Table.Cell>
                      <Table.Cell>
                        <div className="text-sm font-medium text-foreground">{log.device_name || '未知设备'}</div>
                        {!log.success && log.failure_reason && (
                          <div className="mt-1 text-xs text-danger">
                            失败原因：{log.failure_reason === 'invalid_password' ? '密码错误' :
                              log.failure_reason === 'user_not_found' ? '用户不存在' :
                              log.failure_reason === 'account_suspended' ? '账户已停用' :
                              log.failure_reason}
                          </div>
                        )}
                      </Table.Cell>
                      <Table.Cell className="text-muted">{getLoginMethodText(log.login_method)}</Table.Cell>
                      <Table.Cell className="text-muted">
                        <div className="break-all">{log.ip_address || '-'}</div>
                        {(log.city || log.country) && (
                          <div className="text-xs text-muted mt-1">
                            {[log.city, log.country].filter(Boolean).join(', ')}
                          </div>
                        )}
                      </Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm text-muted whitespace-nowrap">{formatDateTime(log.created_at)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}
      </div>
          </Tabs.Panel>

          <Tabs.Panel id="passkeys" className="pt-4">
        <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-2">通行密钥</h2>
        <p className="text-sm text-muted mb-4">
          管理用于登录验证的通行密钥
        </p>

        {passkeyError && (
          <Alert status="danger" className="mb-4">
            <Alert.Indicator />
            <Alert.Content><Alert.Description>{passkeyError}</Alert.Description></Alert.Content>
          </Alert>
        )}

        {!webAuthnSupported && (
          <Alert status="warning" className="mb-4">
            <Alert.Indicator />
            <Alert.Content><Alert.Description>您的浏览器不支持通行密钥功能。请使用支持 WebAuthn 的现代浏览器。</Alert.Description></Alert.Content>
          </Alert>
        )}

        {user && !user.email_verified && (
          <Alert status="warning" className="mb-4">
            <Alert.Indicator />
            <Alert.Content><Alert.Description>绑定通行密钥需要先验证邮箱。</Alert.Description></Alert.Content>
          </Alert>
        )}

        <div className="mb-4">
          <Button onPress={handleRegisterPasskey} isDisabled={!webAuthnSupported || registeringPasskey || !user?.email_verified} variant="primary">
            {registeringPasskey ? '正在注册...' : '添加通行密钥'}
          </Button>
          {platformAvailable && (
            <span className="ml-3 text-sm text-success inline-flex items-center gap-1">
              <Check className="w-4 h-4" /> 检测到平台认证器
            </span>
          )}
        </div>

        {passkeys.length === 0 ? (
          <div className="text-center py-8 text-muted">暂无通行密钥</div>
        ) : (
          <div className="overflow-hidden">
            <ul className="list">
              {passkeys.map((passkey) => (
                <li key={passkey.id} className="list-item">
                  <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm sm:text-base font-semibold text-foreground truncate">{passkey.name}</h3>
                          {passkey.backup_eligible && (
                            <Chip color="accent" variant="soft" size="sm">可同步</Chip>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button onPress={() => handleShowPasskeyDetail(passkey)} variant="tertiary" className="text-xs sm:text-sm">
                          详情
                        </Button>
                        <Button onPress={() => void handleDeletePasskey(passkey.id, passkey.name)} variant="danger" className="text-xs sm:text-sm">
                          删除
                        </Button>
                      </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
          </Tabs.Panel>
          </Card>
          </div>
        </Tabs>
      </div>

      <AlertDialog>
        <AlertDialog.Backdrop isOpen={showNameModal} onOpenChange={setShowNameModal}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>为通行密钥命名</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm text-muted mb-4">
                  给这个通行密钥起一个便于识别的名称，例如设备名称
                </p>
                <Input
                  type="text"
                  value={newPasskeyName}
                  onChange={(e) => setNewPasskeyName(e.target.value)}
                  className="w-full"
                  placeholder="例如：MacBook Pro"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void handleConfirmPasskeyRegistration();
                    }
                  }}
                />
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button onPress={() => { setShowNameModal(false); setPendingCredential(null); setNewPasskeyName(''); }} variant="ghost">
                  取消
                </Button>
                <Button onPress={() => void handleConfirmPasskeyRegistration()} isDisabled={!newPasskeyName.trim() || registeringPasskey} variant="primary">
                  {registeringPasskey ? '保存中...' : '保存'}
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog>
        <AlertDialog.Backdrop
          isOpen={showPasskeyDetailModal}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              handleClosePasskeyDetail();
            }
          }}
        >
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>通行密钥详情</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                {selectedPasskey && (
                  <div className="space-y-3 text-sm text-muted">
                    <div>
                      <span className="text-muted">名称：</span>
                      <Input
                        type="text"
                        value={detailPasskeyName}
                        onChange={(e) => setDetailPasskeyName(e.target.value)}
                        className="mt-2"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            void handleRenameSelectedPasskey();
                          }
                        }}
                      />
                    </div>
                    <div><span className="text-muted">创建时间：</span>{formatDateTime(selectedPasskey.created_at)}</div>
                    <div><span className="text-muted">最后使用：</span>{selectedPasskey.last_used_at ? formatDateTime(selectedPasskey.last_used_at) : '-'}</div>
                    <div><span className="text-muted">传输方式：</span>{selectedPasskey.transports && selectedPasskey.transports.length > 0 ? selectedPasskey.transports.join(', ') : '-'}</div>
                    <div><span className="text-muted">可同步：</span>{selectedPasskey.backup_eligible ? '是' : '否'}</div>
                  </div>
                )}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button onPress={() => handleClosePasskeyDetail()} variant="ghost">
                  关闭
                </Button>
                <Button onPress={() => void handleRenameSelectedPasskey()} variant="primary" isDisabled={!detailPasskeyName.trim() || renamingPasskey}>
                  {renamingPasskey ? '保存中...' : '保存名称'}
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog>
        <AlertDialog.Backdrop
          isOpen={showSessionDetailModal}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              handleCloseSessionDetail();
            }
          }}
        >
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>会话详情</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                {selectedSession && (
                  <div className="space-y-2 text-sm text-muted">
                    <div><span className="text-muted">设备名称：</span>{selectedSession.device_name || '未知设备'}</div>
                    <div><span className="text-muted">设备类型：</span>{selectedSession.device_type === 'mobile' ? '手机' : selectedSession.device_type === 'tablet' ? '平板' : '电脑'}</div>
                    <div><span className="text-muted">状态：</span>{selectedSession.is_current ? '当前会话' : '历史会话'}{selectedSession.is_trusted ? ' · 已信任' : ''}</div>
                    <div><span className="text-muted">IP 地址：</span>{selectedSession.ip_address || '-'}</div>
                    <div><span className="text-muted">位置：</span>{[selectedSession.city, selectedSession.country].filter(Boolean).join(', ') || '-'}</div>
                    <div><span className="text-muted">设备 ID：</span><span className="font-mono break-all">{selectedSession.device_id || '-'}</span></div>
                    <div><span className="text-muted">最后活跃：</span>{formatDateTime(selectedSession.last_active)}</div>
                    <div><span className="text-muted">过期时间：</span>{formatDateTime(selectedSession.expires_at)}</div>
                  </div>
                )}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button onPress={handleCloseSessionDetail} variant="primary">
                  知道了
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog>
        <AlertDialog.Backdrop
          isOpen={pendingDeletePasskey !== null}
          onOpenChange={(isOpen) => {
            if (!isOpen) {
              setPendingDeletePasskey(null);
              setDeletePassword('');
            }
          }}
        >
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>确认删除通行密钥</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm text-muted mb-4">
                  确定要删除通行密钥 <strong className="text-foreground">{pendingDeletePasskey?.name}</strong> 吗？删除后将无法使用此通行密钥登录。
                </p>
                <p className="text-sm text-muted mb-3">
                  此操作需要输入密码确认，以防他人盗用会话后移除您的登录凭据。
                </p>
                <Input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full"
                  autoFocus
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void handleConfirmDeletePasskey();
                    }
                  }}
                />
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button onPress={() => { setPendingDeletePasskey(null); setDeletePassword(''); }} variant="ghost">
                  取消
                </Button>
                <Button onPress={() => void handleConfirmDeletePasskey()} isDisabled={!deletePassword || deletingPasskey} variant="danger" isPending={deletingPasskey}>
                  {deletingPasskey ? '删除中...' : '删除'}
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <TotpManageModal
        isOpen={showTotpManageModal}
        onOpenChange={setShowTotpManageModal}
        onStatusUpdated={(nextStatus) => setTotpStatus(nextStatus)}
      />
    </div>
  );
}
