'use client';

import { useEffect, useState } from 'react';
import { AlertDialog, Alert, Button, Card, Chip, Input, Label, Table, Tabs, TextField, toast } from '@heroui/react';
import { userApi, totpApi, passkeyApi } from '@/lib/api';
import { formatDateTime } from '@/lib/date';
import { useAuthStore } from '@/lib/store';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { TotpManageModal } from '@/components/security/TotpManageModal';
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

function getApiErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') return fallback;
  const error = err as ApiErrorLike;
  return error.response?.data?.detail || error.message || fallback;
}

export default function SecurityPage() {
  const confirmDialog = useConfirmDialog();
  const { user } = useAuthStore();
  const [totpStatus, setTotpStatus] = useState<TOTPStatus | null>(null);
  const [loginHistory, setLoginHistory] = useState<LoginLog[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);

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
    const shouldDelete = await confirmDialog({
      title: '确认删除通行密钥',
      description: `确定要删除通行密钥 "${name}" 吗？删除后将无法使用此通行密钥登录。`,
      confirmText: '删除',
      cancelText: '取消',
      status: 'danger',
      confirmVariant: 'danger',
    });
    if (!shouldDelete) return;

    try {
      await passkeyApi.delete(id);
      await loadPasskeys();
    } catch {
      toast('删除失败');
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
    return <div className="text-center py-12">加载中...</div>;
  }

  const otherSessionsCount = sessions.filter((session) => !session.is_current).length;

  return (
    <div className="px-4 sm:px-0 animate-fade-in space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">安全设置</h1>
        <p className="text-default-600 mt-1 text-sm sm:text-base">
          管理您的账户安全设置和查看登录历史。
        </p>
      </div>

      {/* 两步验证 */}
      <div className="surface p-4 sm:p-6">
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

          <Card className="min-w-0 border border-default-200 bg-content2 p-3 sm:p-4">

          <Tabs.Panel id="totp" className="pt-4">
            <h2 className="text-lg sm:text-xl font-semibold text-foreground mb-2">验证方式</h2>
            <p className="text-sm text-default-500 mb-4">
              启用两步验证后，当检测到可疑登录时，需要额外的验证步骤才能登录。
            </p>
            <div className="border border-default-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    totpStatus?.enabled
                      ? 'bg-success/10'
                      : 'bg-default-100'
                  }`}>
                    <ShieldCheck className={`w-5 h-5 ${
                      totpStatus?.enabled
                        ? 'text-success'
                        : 'text-default-400'
                    }`} />
                  </div>
                  <div>
                    <h3 className="font-medium text-foreground">身份验证器 (TOTP)</h3>
                    <p className="text-sm text-default-500">
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
            <p className="text-sm text-default-500 mt-1">管理当前登录设备和会话状态</p>
          </div>
          {otherSessionsCount > 0 && (
            <Button onPress={handleRevokeOtherSessions} isDisabled={revoking} variant="danger" className="text-sm shrink-0 w-full sm:w-auto">
              {revoking ? '处理中...' : `登出其他设备 (${otherSessionsCount})`}
            </Button>
          )}
        </div>
        {sessions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-default-500">暂无活跃会话</p>
          </div>
        ) : (
          <div className="overflow-hidden">
          <ul className="list">
            {sessions.map((session) => (
              <li key={session.id} className="list-item">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2 bg-default-100 rounded-lg text-default-600 shrink-0">
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
                      <div className="mt-1 text-xs sm:text-sm text-default-600 flex items-center gap-1 sm:gap-2 flex-wrap">
                        <span>
                          {session.device_type === 'mobile' ? '手机' : session.device_type === 'tablet' ? '平板' : '电脑'}
                        </span>
                        <span className="text-default-400">·</span>
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
              <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="请输入当前密码" />
            </TextField>
          </div>

          <div>
            <TextField isRequired isDisabled={changingPassword}>
              <Label>新密码</Label>
              <Input type="password" minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="至少 6 个字符" />
            </TextField>
          </div>

          <div>
            <TextField isRequired isDisabled={changingPassword}>
              <Label>确认新密码</Label>
              <Input type="password" minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="再次输入新密码" />
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
          <p className="text-sm text-default-500 mt-1">
            您账户的最近登录行为记录
          </p>
        </div>

        {loginHistory.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-default-500">暂无登录记录</p>
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
                      <Table.Cell className="text-default-600">{getLoginMethodText(log.login_method)}</Table.Cell>
                      <Table.Cell className="text-default-600">
                        <div className="break-all">{log.ip_address || '-'}</div>
                        {(log.city || log.country) && (
                          <div className="text-xs text-default-500 mt-1">
                            {[log.city, log.country].filter(Boolean).join(', ')}
                          </div>
                        )}
                      </Table.Cell>
                      <Table.Cell className="text-xs sm:text-sm text-default-500 whitespace-nowrap">{formatDateTime(log.created_at)}</Table.Cell>
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
        <p className="text-sm text-default-500 mb-4">
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
          <div className="text-center py-8 text-default-500">暂无通行密钥</div>
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
                <p className="text-sm text-default-600 mb-4">
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
                  <div className="space-y-3 text-sm text-default-600">
                    <div>
                      <span className="text-default-500">名称：</span>
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
                    <div><span className="text-default-500">创建时间：</span>{formatDateTime(selectedPasskey.created_at)}</div>
                    <div><span className="text-default-500">最后使用：</span>{selectedPasskey.last_used_at ? formatDateTime(selectedPasskey.last_used_at) : '-'}</div>
                    <div><span className="text-default-500">传输方式：</span>{selectedPasskey.transports && selectedPasskey.transports.length > 0 ? selectedPasskey.transports.join(', ') : '-'}</div>
                    <div><span className="text-default-500">可同步：</span>{selectedPasskey.backup_eligible ? '是' : '否'}</div>
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
                  <div className="space-y-2 text-sm text-default-600">
                    <div><span className="text-default-500">设备名称：</span>{selectedSession.device_name || '未知设备'}</div>
                    <div><span className="text-default-500">设备类型：</span>{selectedSession.device_type === 'mobile' ? '手机' : selectedSession.device_type === 'tablet' ? '平板' : '电脑'}</div>
                    <div><span className="text-default-500">状态：</span>{selectedSession.is_current ? '当前会话' : '历史会话'}{selectedSession.is_trusted ? ' · 已信任' : ''}</div>
                    <div><span className="text-default-500">IP 地址：</span>{selectedSession.ip_address || '-'}</div>
                    <div><span className="text-default-500">位置：</span>{[selectedSession.city, selectedSession.country].filter(Boolean).join(', ') || '-'}</div>
                    <div><span className="text-default-500">设备 ID：</span><span className="font-mono break-all">{selectedSession.device_id || '-'}</span></div>
                    <div><span className="text-default-500">最后活跃：</span>{formatDateTime(selectedSession.last_active)}</div>
                    <div><span className="text-default-500">过期时间：</span>{formatDateTime(selectedSession.expires_at)}</div>
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

      <TotpManageModal
        isOpen={showTotpManageModal}
        onOpenChange={setShowTotpManageModal}
        onStatusUpdated={(nextStatus) => setTotpStatus(nextStatus)}
      />
    </div>
  );
}
