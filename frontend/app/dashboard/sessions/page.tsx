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
    if (!confirm(`Revoke session for "${deviceName}"?`)) return;

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
    return <div className="text-center py-12">Loading...</div>;
  }

  return (
    <div className="px-4 sm:px-0">
      <h1 className="text-3xl font-bold mb-4">Active Sessions</h1>
      <p className="text-gray-600 mb-8">
        These are the devices where you're currently logged in with "Remember Me" enabled.
      </p>

      <div className="space-y-4">
        {sessions.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-500">No active sessions</p>
          </div>
        ) : (
          sessions.map((session) => (
            <div key={session.id} className="card">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">
                      {session.device_type === 'mobile' ? '📱' :
                       session.device_type === 'tablet' ? '📱' : '💻'}
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold">
                        {session.device_name || 'Unknown Device'}
                      </h3>
                      {session.ip_address && (
                        <p className="text-sm text-gray-500">IP: {session.ip_address}</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 space-y-1 text-sm text-gray-600">
                    <p>Last active: {formatDate(session.last_active)}</p>
                    <p>Expires: {formatDate(session.expires_at)}</p>
                  </div>
                </div>

                <button
                  onClick={() => handleRevoke(session.id, session.device_name || 'this device')}
                  className="btn btn-danger text-sm"
                >
                  Revoke
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
