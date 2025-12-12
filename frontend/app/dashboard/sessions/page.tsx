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
    <div className="px-4 sm:px-0">
      <h1 className="text-3xl font-bold mb-4">活跃会话</h1>
      <p className="text-gray-600 mb-8">
        这里列出开启“记住我”后仍保持登录的设备。
      </p>

      <div className="space-y-4">
        {sessions.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-500">暂无活跃会话</p>
          </div>
        ) : (
          sessions.map((session) => (
            <div key={session.id} className="card">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold">
                          {session.device_name || '未知设备'}
                        </h3>
                        {session.is_current && (
                          <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                            当前设备
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">
                        {session.device_type === 'mobile'
                          ? '手机'
                          : session.device_type === 'tablet'
                          ? '平板'
                          : '电脑'}
                      </p>
                      {session.ip_address && (
                        <p className="text-sm text-gray-500">IP: {session.ip_address}</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 space-y-1 text-sm text-gray-600">
                    <p>最后活跃时间：{formatDate(session.last_active)}</p>
                    <p>过期时间：{formatDate(session.expires_at)}</p>
                  </div>
                </div>

                <button
                  onClick={() => handleRevoke(session.id, session.device_name || '当前设备')}
                  className="btn btn-danger text-sm"
                >
                  撤销
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
