'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Tabs, buttonVariants, toast } from '@heroui/react';
import { adminApi, groupApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { isAdmin } from '@/lib/authz';
import { formatDateTime } from '@/lib/date';
import { UIButton, UICheckbox, UIInput, UIListBox, UISelect, UISelectItem } from '@/components/ui/primitives';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';

interface User {
  id: number;
  username: string;
  email: string;
  avatar?: string;
  status: string;
  created_at: string;
  updated_at: string;
  groups: string[];
  roles: string[];
}

interface Group {
  id: number;
  name: string;
  description?: string;
}

interface Role {
  id: number;
  name: string;
  description?: string;
  level: number;
}

interface LoginLog {
  id: number;
  username: string;
  success: boolean;
  failure_reason?: string;
  ip_address?: string;
  device_type?: string;
  country?: string;
  city?: string;
  login_method?: string;
  is_suspicious: boolean;
  created_at: string;
}

interface Session {
  id: number;
  device_id: string;
  device_name?: string;
  device_type?: string;
  ip_address?: string;
  country?: string;
  city?: string;
  last_active: string;
  expires_at: string;
  created_at: string;
  is_trusted: boolean;
}

interface Passkey {
  id: number;
  name: string;
  credential_id: string;
  created_at: string;
  last_used_at?: string;
  backup_eligible: boolean;
  aaguid?: string;
}

interface Authorization {
  id: number;
  client_id: string;
  client_name: string;
  client_logo?: string;
  scope: string;
  created_at: string;
  updated_at: string;
}

interface SecurityMethods {
  totp_enabled: boolean;
  totp_created_at?: string;
  passkey_count: number;
  email_verified: boolean;
  email_verified_at?: string;
}

type Tab = 'info' | 'logs' | 'sessions' | 'passkeys' | 'authorizations';

export default function UserDetailPage() {
  const confirmDialog = useConfirmDialog();
  const searchParams = useSearchParams();
  const router = useRouter();
  const userId = Number(searchParams.get('id'));
  const currentUser = useAuthStore((s) => s.user);
  const canManageUsers = isAdmin(currentUser);

  const [user, setUser] = useState<User | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('info');

  // Tab data
  const [loginLogs, setLoginLogs] = useState<LoginLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [authorizations, setAuthorizations] = useState<Authorization[]>([]);
  const [securityMethods, setSecurityMethods] = useState<SecurityMethods | null>(null);

  // Edit states
  const [editForm, setEditForm] = useState({ email: '', avatar: '', status: 'active', password: '' });
  const [selectedGroups, setSelectedGroups] = useState<number[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<number[]>([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showGroupsModal, setShowGroupsModal] = useState(false);
  const [showRolesModal, setShowRolesModal] = useState(false);

  const loadUser = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const response = await adminApi.getUser(userId);
      setUser(response.data);
      setEditForm({
        email: response.data.email,
        avatar: response.data.avatar || '',
        status: response.data.status,
        password: '',
      });
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载用户失败');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const loadGroups = async () => {
    try {
      const response = await groupApi.list();
      setGroups(response.data);
    } catch (err) {
      console.error('加载用户组失败:', err);
    }
  };

  const loadRoles = async () => {
    try {
      const response = await adminApi.listRoles();
      setRoles(response.data);
    } catch (err) {
      console.error('加载角色失败:', err);
    }
  };

  const loadLoginLogs = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await adminApi.getUserLoginLogs(userId, { skip: logsPage * 20, limit: 20 });
      setLoginLogs(response.data.items);
      setLogsTotal(response.data.total);
    } catch (err) {
      console.error('加载登录日志失败:', err);
    }
  }, [userId, logsPage]);

  const loadSessions = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await adminApi.getUserSessions(userId);
      setSessions(response.data);
    } catch (err) {
      console.error('加载会话失败:', err);
    }
  }, [userId]);

  const loadPasskeys = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await adminApi.getUserPasskeys(userId);
      setPasskeys(response.data);
    } catch (err) {
      console.error('加载通行密钥失败:', err);
    }
  }, [userId]);

  const loadAuthorizations = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await adminApi.getUserAuthorizations(userId);
      setAuthorizations(response.data);
    } catch (err) {
      console.error('加载授权记录失败:', err);
    }
  }, [userId]);

  const loadSecurityMethods = useCallback(async () => {
    if (!userId) return;
    try {
      const response = await adminApi.getUserSecurityMethods(userId);
      setSecurityMethods(response.data);
    } catch (err) {
      console.error('加载安全验证方式失败:', err);
    }
  }, [userId]);

  useEffect(() => {
    if (!canManageUsers || !userId) return;
    loadUser();
    loadGroups();
    loadRoles();
    loadSecurityMethods();
  }, [canManageUsers, userId, loadUser, loadSecurityMethods]);

  useEffect(() => {
    if (!canManageUsers || !user) return;
    if (activeTab === 'logs') loadLoginLogs();
    else if (activeTab === 'sessions') loadSessions();
    else if (activeTab === 'passkeys') loadPasskeys();
    else if (activeTab === 'authorizations') loadAuthorizations();
  }, [canManageUsers, user, activeTab, loadLoginLogs, loadSessions, loadPasskeys, loadAuthorizations]);

  if (!canManageUsers) {
    return (
      <div className="surface p-6">
        <h1 className="text-xl font-semibold mb-2">无权限</h1>
        <p className="text-gray-600">该页面仅管理员可访问。</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="surface p-6">
        <h1 className="text-xl font-semibold mb-2">参数错误</h1>
        <p className="text-gray-600">缺少用户 ID 参数。</p>
        <UIButton  onPress={() => router.push('/admin/users')} variant="primary" className="mt-4">
          返回用户列表
        </UIButton>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="surface p-6">
        <h1 className="text-xl font-semibold mb-2">错误</h1>
        <p className="text-red-600">{error || '用户不存在'}</p>
        <Link href="/admin/users" className={`${buttonVariants({ variant: 'secondary' })} mt-4`}>返回用户列表</Link>
      </div>
    );
  }

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data: any = { email: editForm.email, avatar: editForm.avatar || null, status: editForm.status };
      if (editForm.password) data.password = editForm.password;
      await adminApi.updateUser(userId, data);
      setShowEditModal(false);
      loadUser();
    } catch (err: any) {
      toast(err.response?.data?.detail || '更新失败');
    }
  };

  const openGroupsModal = () => {
    const userGroupIds = groups.filter(g => user.groups.includes(g.name)).map(g => g.id);
    setSelectedGroups(userGroupIds);
    setShowGroupsModal(true);
  };

  const handleUpdateGroups = async () => {
    try {
      await adminApi.updateUserGroups(userId, selectedGroups);
      setShowGroupsModal(false);
      loadUser();
    } catch (err: any) {
      toast(err.response?.data?.detail || '更新用户组失败');
    }
  };

  const openRolesModal = () => {
    const userRoleIds = roles.filter(r => user.roles.includes(r.name)).map(r => r.id);
    setSelectedRoles(userRoleIds);
    setShowRolesModal(true);
  };

  const handleUpdateRoles = async () => {
    try {
      await adminApi.updateUserRoles(userId, selectedRoles);
      setShowRolesModal(false);
      loadUser();
    } catch (err: any) {
      toast(err.response?.data?.detail || '更新角色失败');
    }
  };

  const handleRevokeSession = async (sessionId: number) => {
    const shouldRevoke = await confirmDialog({
      title: '确认强制登出',
      description: '确定要强制登出此会话吗？',
      confirmText: '确认登出',
      cancelText: '取消',
      status: 'warning',
      confirmVariant: 'danger',
    });
    if (!shouldRevoke) return;
    try {
      await adminApi.revokeUserSession(userId, sessionId);
      loadSessions();
    } catch (err: any) {
      toast(err.response?.data?.detail || '操作失败');
    }
  };

  const handleRevokeAllSessions = async () => {
    const shouldRevokeAll = await confirmDialog({
      title: '确认登出所有会话',
      description: '确定要登出该用户的所有会话吗？',
      confirmText: '全部登出',
      cancelText: '取消',
      status: 'danger',
      confirmVariant: 'danger',
    });
    if (!shouldRevokeAll) return;
    try {
      const response = await adminApi.revokeAllUserSessions(userId);
      toast(response.data.message);
      loadSessions();
    } catch (err: any) {
      toast(err.response?.data?.detail || '操作失败');
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      active: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
      inactive: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100',
      suspended: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
    };
    const labels: Record<string, string> = { active: '激活', inactive: '未激活', suspended: '暂停' };
    return <span className={`px-2 py-1 text-xs rounded-full ${styles[status]}`}>{labels[status]}</span>;
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'info', label: '基本信息' },
    { key: 'logs', label: '登录日志' },
    { key: 'sessions', label: '活跃会话' },
    { key: 'passkeys', label: '通行密钥' },
    { key: 'authorizations', label: '应用授权' },
  ];

  return (
    <div className="px-4 sm:px-6 lg:px-8 animate-fade-in">
      {/* Header */}
      <div className="mb-6">
        <Link href="/admin/users" className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 mb-2 inline-block">
          ← 返回用户列表
        </Link>
        <div className="flex items-center gap-4">
          {user.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar} alt={user.username} className="h-16 w-16 rounded-full border" />
          ) : (
            <div className="h-16 w-16 rounded-full bg-blue-500 flex items-center justify-center text-white text-2xl">
              {user.username.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              {user.username}
              {getStatusBadge(user.status)}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">{user.email}</p>
            <p className="text-sm text-gray-500">ID: {user.id} · 创建于 {formatDateTime(user.created_at)}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6">
        <Tabs
          aria-label="用户详情标签"
          selectedKey={activeTab}
          onSelectionChange={(key) => setActiveTab(String(key) as Tab)}
          variant="primary"
        >
          <Tabs.List>
            {tabs.map((tab) => (
              <Tabs.Tab key={tab.key} id={tab.key}>{tab.label}</Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
      </div>

      {/* Tab Content */}
      <div className="surface p-6">
        {activeTab === 'info' && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-3">
              <UIButton onPress={() => setShowEditModal(true)} variant="primary" >编辑信息</UIButton>
              <UIButton onPress={openGroupsModal} variant="secondary" >管理用户组</UIButton>
              <UIButton onPress={openRolesModal} variant="secondary" >管理角色</UIButton>
              <UIButton onPress={() => router.push(`/admin/users/permissions?id=${userId}`)} variant="secondary" >应用权限</UIButton>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">用户组：</span>{user.groups.length ? user.groups.join(', ') : '无'}</div>
              <div><span className="text-gray-500">角色：</span>{user.roles.length ? user.roles.join(', ') : '无'}</div>
              <div><span className="text-gray-500">更新时间：</span>{formatDateTime(user.updated_at)}</div>
            </div>

            {/* 已绑定验证方式 */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <h3 className="text-lg font-medium mb-4">已绑定验证方式</h3>
              {securityMethods ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* 邮箱验证 */}
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${securityMethods.email_verified ? 'bg-green-100 dark:bg-green-900' : 'bg-gray-100 dark:bg-gray-800'}`}>
                        <svg className={`w-4 h-4 ${securityMethods.email_verified ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-gray-100">邮箱验证</div>
                        <div className={`text-xs ${securityMethods.email_verified ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                          {securityMethods.email_verified ? '已验证' : '未验证'}
                        </div>
                      </div>
                    </div>
                    {securityMethods.email_verified && securityMethods.email_verified_at && (
                      <div className="text-xs text-gray-500 mt-1">
                        验证于 {formatDateTime(securityMethods.email_verified_at)}
                      </div>
                    )}
                  </div>

                  {/* 身份验证器 (TOTP) */}
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${securityMethods.totp_enabled ? 'bg-green-100 dark:bg-green-900' : 'bg-gray-100 dark:bg-gray-800'}`}>
                        <svg className={`w-4 h-4 ${securityMethods.totp_enabled ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-gray-100">身份验证器</div>
                        <div className={`text-xs ${securityMethods.totp_enabled ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                          {securityMethods.totp_enabled ? '已启用' : '未启用'}
                        </div>
                      </div>
                    </div>
                    {securityMethods.totp_enabled && securityMethods.totp_created_at && (
                      <div className="text-xs text-gray-500 mt-1">
                        启用于 {formatDateTime(securityMethods.totp_created_at)}
                      </div>
                    )}
                  </div>

                  {/* 通行密钥 */}
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${securityMethods.passkey_count > 0 ? 'bg-green-100 dark:bg-green-900' : 'bg-gray-100 dark:bg-gray-800'}`}>
                        <svg className={`w-4 h-4 ${securityMethods.passkey_count > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                        </svg>
                      </div>
                      <div>
                        <div className="font-medium text-gray-900 dark:text-gray-100">通行密钥</div>
                        <div className={`text-xs ${securityMethods.passkey_count > 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                          {securityMethods.passkey_count > 0 ? `已绑定 ${securityMethods.passkey_count} 个` : '未绑定'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-gray-500">加载中...</div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'logs' && (
          <div>
            <h3 className="text-lg font-medium mb-4">登录日志 ({logsTotal})</h3>
            {loginLogs.length === 0 ? (
              <p className="text-gray-500">暂无登录记录</p>
            ) : (
              <>
                <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                  {loginLogs.map((log) => (
                    <li key={log.id} className="py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-2 py-0.5 text-xs rounded ${log.success ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'}`}>
                              {log.success ? '成功' : '失败'}
                            </span>
                            {log.is_suspicious && <span className="px-2 py-0.5 text-xs rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">可疑</span>}
                            {log.login_method && <span className="text-xs text-gray-500">{log.login_method}</span>}
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {log.ip_address && <span>{log.ip_address}</span>}
                            {(log.city || log.country) && <span> · {[log.city, log.country].filter(Boolean).join(', ')}</span>}
                            {log.device_type && <span> · {log.device_type}</span>}
                          </div>
                          {!log.success && log.failure_reason && (
                            <div className="text-xs text-red-600 dark:text-red-400 mt-1">原因：{log.failure_reason}</div>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 shrink-0">{formatDateTime(log.created_at)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
                {logsTotal > 20 && (
                  <div className="mt-4 flex justify-between items-center">
                    <span className="text-sm text-gray-500">第 {logsPage + 1} / {Math.ceil(logsTotal / 20)} 页</span>
                    <div className="flex gap-2">
                      <UIButton onPress={() => setLogsPage(p => Math.max(0, p - 1))} isDisabled={logsPage === 0} variant="secondary" className="disabled:opacity-50">上一页</UIButton>
                      <UIButton onPress={() => setLogsPage(p => p + 1)} isDisabled={(logsPage + 1) * 20 >= logsTotal} variant="secondary" className="disabled:opacity-50">下一页</UIButton>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'sessions' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">活跃会话 ({sessions.length})</h3>
              {sessions.length > 0 && (
                <UIButton onPress={handleRevokeAllSessions} variant="danger" >登出全部</UIButton>
              )}
            </div>
            {sessions.length === 0 ? (
              <p className="text-gray-500">暂无活跃会话</p>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {sessions.map((session) => (
                  <li key={session.id} className="py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{session.device_name || '未知设备'}</span>
                          {session.is_trusted && <span className="px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200">可信</span>}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          {session.device_type && <span>{session.device_type === 'mobile' ? '手机' : session.device_type === 'tablet' ? '平板' : '电脑'}</span>}
                          {session.ip_address && <span> · {session.ip_address}</span>}
                          {(session.city || session.country) && <span> · {[session.city, session.country].filter(Boolean).join(', ')}</span>}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          最后活跃：{formatDateTime(session.last_active)} · 过期：{formatDateTime(session.expires_at)}
                        </div>
                      </div>
                      <UIButton onPress={() => handleRevokeSession(session.id)} variant="danger" size="sm">登出</UIButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'passkeys' && (
          <div>
            <h3 className="text-lg font-medium mb-4">通行密钥 ({passkeys.length})</h3>
            {passkeys.length === 0 ? (
              <p className="text-gray-500">暂无通行密钥</p>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {passkeys.map((passkey) => (
                  <li key={passkey.id} className="py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{passkey.name}</span>
                      {passkey.backup_eligible && <span className="px-2 py-0.5 text-xs rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200">可同步</span>}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      创建：{formatDateTime(passkey.created_at)}
                      {passkey.last_used_at && <span> · 最后使用：{formatDateTime(passkey.last_used_at)}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'authorizations' && (
          <div>
            <h3 className="text-lg font-medium mb-4">应用授权 ({authorizations.length})</h3>
            {authorizations.length === 0 ? (
              <p className="text-gray-500">暂无授权记录</p>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                {authorizations.map((auth) => (
                  <li key={auth.id} className="py-3">
                    <div className="flex items-center gap-3">
                      {auth.client_logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={auth.client_logo} alt={auth.client_name} className="h-10 w-10 rounded" />
                      ) : (
                        <div className="h-10 w-10 rounded bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500">
                          {auth.client_name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-medium">{auth.client_name}</div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          权限：{auth.scope} · 授权于 {formatDateTime(auth.created_at)}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={(e) => e.target === e.currentTarget && setShowEditModal(false)}>
          <div className="surface max-w-md w-full p-6">
            <h3 className="text-lg font-medium mb-4">编辑用户</h3>
            <form onSubmit={handleEditUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">邮箱</label>
                <UIInput type="email" required value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">头像URL</label>
                <UIInput type="url" value={editForm.avatar} onChange={(e) => setEditForm({ ...editForm, avatar: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">状态</label>
                <UISelect selectedKey={editForm.status} onSelectionChange={(key) => setEditForm({ ...editForm, status: String(key ?? 'active') })}>
                  <UISelect.Trigger>
                    <UISelect.Value />
                    <UISelect.Indicator />
                  </UISelect.Trigger>
                  <UISelect.Popover>
                    <UIListBox>
                      <UISelectItem id="active">激活</UISelectItem>
                      <UISelectItem id="inactive">未激活</UISelectItem>
                      <UISelectItem id="suspended">暂停</UISelectItem>
                    </UIListBox>
                  </UISelect.Popover>
                </UISelect>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">新密码（留空不修改）</label>
                <UIInput type="password" minLength={6} value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} />
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <UIButton type="button" onPress={() => setShowEditModal(false)} variant="secondary" >取消</UIButton>
                <UIButton type="submit" variant="primary" >保存</UIButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Groups Modal */}
      {showGroupsModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={(e) => e.target === e.currentTarget && setShowGroupsModal(false)}>
          <div className="surface max-w-md w-full p-6">
            <h3 className="text-lg font-medium mb-4">管理用户组</h3>
            <div className="max-h-96 overflow-y-auto space-y-2">
              {groups.map((group) => (
                <UICheckbox key={group.id}
                className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer max-w-full m-0" isSelected={selectedGroups.includes(group.id)} onChange={() => setSelectedGroups(prev => prev.includes(group.id) ? prev.filter(id => id !== group.id) : [...prev, group.id])}><div>
                  <div className="font-medium">{group.name}</div>
                  {group.description && <div className="text-xs text-gray-500">{group.description}</div>}
                </div></UICheckbox>
              ))}
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <UIButton onPress={() => setShowGroupsModal(false)} variant="secondary" >取消</UIButton>
              <UIButton onPress={handleUpdateGroups} variant="primary" >保存</UIButton>
            </div>
          </div>
        </div>
      )}

      {/* Roles Modal */}
      {showRolesModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50" onClick={(e) => e.target === e.currentTarget && setShowRolesModal(false)}>
          <div className="surface max-w-md w-full p-6">
            <h3 className="text-lg font-medium mb-4">管理角色</h3>
            <div className="max-h-96 overflow-y-auto space-y-2">
              {roles.map((role) => (
                <UICheckbox key={role.id}
                className="flex items-center gap-3 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer max-w-full m-0" isSelected={selectedRoles.includes(role.id)} onChange={() => setSelectedRoles(prev => prev.includes(role.id) ? prev.filter(id => id !== role.id) : [...prev, role.id])}><div>
                  <div className="font-medium">{role.name}</div>
                  {role.description && <div className="text-xs text-gray-500">{role.description}</div>}
                  <div className="text-xs text-gray-400">等级: {role.level}</div>
                </div></UICheckbox>
              ))}
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <UIButton onPress={() => setShowRolesModal(false)} variant="secondary" >取消</UIButton>
              <UIButton onPress={handleUpdateRoles} variant="primary" >保存</UIButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
