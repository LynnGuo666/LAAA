'use client';

import { useEffect, useState } from 'react';
import { userApi } from '@/lib/api';
import { ExternalLink } from 'lucide-react';

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
    <div className="space-y-6 animate-fade-in">
      <div className="surface p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">我的应用</h1>
            <p className="text-gray-600 dark:text-gray-300 mt-1">你当前有权限访问的应用列表。</p>
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

      <div className="surface overflow-hidden">
        {loading ? (
          <div className="p-6 text-gray-600 dark:text-gray-300">加载中...</div>
        ) : apps.length === 0 ? (
          <div className="p-6 text-gray-600 dark:text-gray-300">暂无可访问应用</div>
        ) : (
          <ul className="list">
            {apps.map((app) => (
              <li key={app.id} className="list-item">
                <div className="flex items-start gap-4">
                  {app.website_url ? (
                    <a href={app.website_url} target="_blank" rel="noreferrer" className="shrink-0">
                      {app.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={app.logo}
                          alt={app.name}
                          className="h-12 w-12 rounded-xl object-cover border border-gray-200 dark:border-gray-800"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-xl bg-gray-200 dark:bg-gray-800" />
                      )}
                    </a>
                  ) : app.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={app.logo}
                      alt={app.name}
                      className="h-12 w-12 rounded-xl object-cover shrink-0 border border-gray-200 dark:border-gray-800"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-xl bg-gray-200 dark:bg-gray-800 shrink-0" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      {app.website_url ? (
                        <a
                          href={app.website_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-100 truncate hover:underline"
                        >
                          <span className="truncate">{app.name}</span>
                          <ExternalLink className="h-4 w-4 text-gray-400 dark:text-gray-500 shrink-0" aria-hidden />
                        </a>
                      ) : (
                        <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                          {app.name}
                        </div>
                      )}
                    </div>

                    {app.description ? (
                      <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                        {app.description}
                      </div>
                    ) : null}
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
