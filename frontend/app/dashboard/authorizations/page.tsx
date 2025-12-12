'use client';

import { useEffect, useState } from 'react';
import { userApi } from '@/lib/api';

interface Authorization {
  id: number;
  client_name: string;
  client_logo?: string | null;
  scope: string;
  created_at: string;
  last_used_at: string;
}

export default function AuthorizationsPage() {
  const [authorizations, setAuthorizations] = useState<Authorization[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAuthorizations();
  }, []);

  const loadAuthorizations = async () => {
    try {
      const response = await userApi.getAuthorizations();
      setAuthorizations(response.data);
    } catch (err) {
      console.error('Failed to load authorizations', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (auth: Authorization) => {
    if (!confirm(`确定要撤销对 "${auth.client_name}" 的授权吗？`)) return;
    try {
      await userApi.revokeAuthorization(auth.id);
      loadAuthorizations();
    } catch (err) {
      alert('撤销授权失败');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? '-' : date.toLocaleString();
  };

  if (loading) {
    return <div className="text-center py-12">加载中...</div>;
  }

  return (
    <div className="px-4 sm:px-0">
      <h1 className="text-3xl font-bold mb-4">授权管理</h1>
      <p className="text-gray-600 mb-8">
        这里列出你已授权过的应用，你可以随时撤回授权。
      </p>

      <div className="space-y-4">
        {authorizations.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-500">暂无已授权应用</p>
          </div>
        ) : (
          authorizations.map((auth) => (
            <div key={auth.id} className="card">
              <div className="flex justify-between items-start gap-4">
                <div className="flex items-start gap-3 flex-1">
                  {auth.client_logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={auth.client_logo}
                      alt={auth.client_name}
                      className="w-12 h-12 rounded-lg object-cover border"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center text-xl border">
                      📱
                    </div>
                  )}
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold">{auth.client_name}</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      授权范围：{auth.scope || '-'}
                    </p>
                    <div className="mt-3 space-y-1 text-sm text-gray-600">
                      <p>首次授权时间：{formatDate(auth.created_at)}</p>
                      <p>最近使用时间：{formatDate(auth.last_used_at)}</p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleRevoke(auth)}
                  className="btn btn-danger text-sm shrink-0"
                >
                  撤回授权
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

