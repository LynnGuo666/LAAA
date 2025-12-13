'use client';

import { useEffect, useState } from 'react';
import { userApi } from '@/lib/api';

interface AppItem {
  id: number;
  client_id: string;
  name: string;
  description?: string;
  logo?: string;
  website_url?: string;
  created_at: string;
}

export default function MyAppsPage() {
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadApps();
  }, []);

  const loadApps = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await userApi.listApps();
      setApps(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      setError(err.response?.data?.detail || '加载应用列表失败');
      setApps([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">我的应用</h1>
            <p className="text-gray-600 mt-1">你当前有权限访问的应用列表。</p>
          </div>
          <button onClick={loadApps} className="btn btn-secondary" disabled={loading}>
            刷新
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="text-gray-600">加载中...</div>
        ) : apps.length === 0 ? (
          <div className="text-gray-600">暂无可访问应用</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {apps.map((app) => (
              <div key={app.id} className="surface p-4 flex gap-4 items-start">
                {app.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={app.logo} alt={app.name} className="h-12 w-12 rounded-lg object-cover shrink-0" />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-gray-200 dark:bg-gray-800 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {app.name}
                    </div>
                    <span className="text-xs text-gray-500 font-mono">{app.client_id}</span>
                  </div>
                  {app.description ? (
                    <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                      {app.description}
                    </div>
                  ) : null}
                  <div className="mt-3 flex gap-3 flex-wrap">
                    {app.website_url ? (
                      <a className="btn btn-secondary text-xs" href={app.website_url} target="_blank" rel="noreferrer">
                        官网
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
