'use client';

import { useEffect, useState } from 'react';
import { userApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { isAdmin } from '@/lib/authz';
import { Button, Card } from '@heroui/react';
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
  const user = useAuthStore((s) => s.user);
  const adminView = user ? isAdmin(user) : false;
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

  const openApp = (app: AppItem) => {
    if (!app.website_url) return;
    window.open(app.website_url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="px-4 sm:px-0 space-y-6 animate-fade-in">
      <div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100">
              {adminView ? '应用列表' : '我的应用'}
            </h1>
          </div>
          <Button onPress={loadApps} variant="tertiary" isDisabled={loading} >
            刷新
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div>
        {loading ? (
          <div className="p-6 text-gray-600 dark:text-gray-300">加载中...</div>
        ) : apps.length === 0 ? (
          <div className="p-6 text-gray-600 dark:text-gray-300">暂无可访问应用</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {apps.map((app) => (
              <Card key={app.id} className="border border-default-200 bg-content2">
                <div className="p-3 space-y-3">
                  <div className="flex items-start gap-3">
                    {app.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={app.logo}
                        alt={app.name}
                        className="h-9 w-9 rounded-md object-cover shrink-0 border border-default-200"
                      />
                    ) : (
                      <div className="h-9 w-9 rounded-md bg-default-200 shrink-0" />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground truncate">{app.name}</span>
                        {app.website_url && <ExternalLink className="h-4 w-4 text-default-500 shrink-0" aria-hidden />}
                      </div>
                      <p className="text-xs text-default-600 mt-1 line-clamp-2 min-h-8">
                        {app.description || '该应用暂未提供描述'}
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      onPress={() => openApp(app)}
                      variant={app.website_url ? 'primary' : 'tertiary'}
                      isDisabled={!app.website_url}
                      className="w-auto px-3 text-sm"
                    >
                      {app.website_url ? '进入应用' : '暂无入口'}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
