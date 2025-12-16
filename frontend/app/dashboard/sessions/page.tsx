'use client';

import { useEffect, useState } from 'react';
import { userApi } from '@/lib/api';

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

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const response = await userApi.getSessions();
      setSessions(response.data);
    } catch (err) {
      console.error('Failed to load sessions', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (id: number, deviceName: string) => {
    if (!confirm(`确定要撤销 "${deviceName}" 的会话吗？`)) return;

    try {
      await userApi.revokeSession(id);
      loadSessions();
    } catch (err) {
      alert('撤销会话失败');
    }
  };

  const handleRevokeOthers = async () => {
    if (!confirm('确定要登出所有其他设备吗？')) return;

    setRevoking(true);
    try {
      const response = await userApi.revokeOtherSessions();
      const { kicked_count } = response.data;
      if (kicked_count > 0) {
        alert(`已登出 ${kicked_count} 个设备`);
      } else {
        alert('没有其他设备需要登出');
      }
      loadSessions();
    } catch (err) {
      alert('操作失败');
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
      loadSessions();
    } catch (err) {
      alert('操作失败');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getDeviceIcon = (deviceType?: string) => {
    if (deviceType === 'mobile') {
      return (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
    }
    if (deviceType === 'tablet') {
      return (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    );
  };

  if (loading) {
    return <div className="text-center py-12">加载中...</div>;
  }

  const otherSessionsCount = sessions.filter(s => !s.is_current).length;

  return (
    <div className="px-4 sm:px-0 animate-fade-in">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h1 className="text-3xl font-bold">活跃会话</h1>
          <p className="text-gray-600 mt-1">
            管理您的登录设备，最多可同时保持 3 个会话。
          </p>
        </div>
        {otherSessionsCount > 0 && (
          <button
            onClick={handleRevokeOthers}
            disabled={revoking}
            className="btn btn-danger text-sm shrink-0"
          >
            {revoking ? '处理中...' : `登出其他设备 (${otherSessionsCount})`}
          </button>
        )}
      </div>

      {sessions.length === 0 ? (
        <div className="surface text-center py-12">
          <p className="text-gray-500">暂无活跃会话</p>
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <ul className="list">
            {sessions.map((session) => (
              <li key={session.id} className="list-item">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="p-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-600 dark:text-gray-300">
                      {getDeviceIcon(session.device_type)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                          {session.device_name || '未知设备'}
                        </h3>
                        {session.is_current && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-900 shrink-0">
                            当前设备
                          </span>
                        )}
                        {session.is_trusted && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-900 shrink-0">
                            可信设备
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-sm text-gray-600 dark:text-gray-300 flex items-center gap-2 flex-wrap">
                        <span>
                          {session.device_type === 'mobile'
                            ? '手机'
                            : session.device_type === 'tablet'
                            ? '平板'
                            : '电脑'}
                        </span>
                        {session.ip_address && (
                          <>
                            <span className="text-gray-400">·</span>
                            <span>IP: {session.ip_address}</span>
                          </>
                        )}
                        {(session.city || session.country) && (
                          <>
                            <span className="text-gray-400">·</span>
                            <span>{[session.city, session.country].filter(Boolean).join(', ')}</span>
                          </>
                        )}
                      </div>

                      <div className="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                        <p>最后活跃：{formatDate(session.last_active)}</p>
                        <p>过期时间：{formatDate(session.expires_at)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!session.is_current && (
                      <button
                        onClick={() => handleToggleTrust(session)}
                        className="btn btn-secondary text-sm"
                        title={session.is_trusted ? '取消信任' : '标记为可信'}
                      >
                        {session.is_trusted ? '取消信任' : '信任'}
                      </button>
                    )}
                    <button
                      onClick={() => handleRevoke(session.id, session.device_name || '当前设备')}
                      className="btn btn-danger text-sm"
                    >
                      撤销
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
