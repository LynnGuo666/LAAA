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
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

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
      alert('Failed to revoke session');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  if (loading) {
    return <div className="text-center py-12">加载中...</div>;
  }

  return (
    <div className="px-4 sm:px-0 animate-fade-in">
      <h1 className="text-3xl font-bold mb-4">活跃会话</h1>
      <p className="text-gray-600 mb-8">
        这里列出开启“记住我”后仍保持登录的设备。
      </p>

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
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {session.device_name || '未知设备'}
                      </h3>
                      {session.is_current && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-900 shrink-0">
                          当前
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      {session.device_type === 'mobile'
                        ? '手机'
                        : session.device_type === 'tablet'
                        ? '平板'
                        : '电脑'}
                      {session.ip_address ? ` · IP: ${session.ip_address}` : ''}
                    </div>

                    <div className="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                      <p>最后活跃：{formatDate(session.last_active)}</p>
                      <p>过期时间：{formatDate(session.expires_at)}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleRevoke(session.id, session.device_name || '当前设备')}
                    className="btn btn-danger text-sm shrink-0"
                  >
                    撤销
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
