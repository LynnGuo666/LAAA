'use client';

import { useEffect, useState } from 'react';
import { toast } from '@heroui/react';
import { userApi } from '@/lib/api';
import { formatDateTime } from '@/lib/date';
import { UIButton } from '@/components/ui/primitives';
import { AppWindow } from 'lucide-react';

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
      toast('撤销授权失败');
    }
  };

  if (loading) {
    return <div className="text-center py-12">加载中...</div>;
  }

  return (
    <div className="px-4 sm:px-0 animate-fade-in">
      <h1 className="text-2xl sm:text-3xl font-bold mb-2 sm:mb-4">授权管理</h1>
      <p className="text-gray-600 mb-6 sm:mb-8 text-sm sm:text-base">
        这里列出你已授权过的应用，你可以随时撤回授权。
      </p>

      {authorizations.length === 0 ? (
        <div className="surface text-center py-12">
          <p className="text-gray-500">暂无已授权应用</p>
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <ul className="list">
            {authorizations.map((auth) => (
              <li key={auth.id} className="list-item">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    {auth.client_logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={auth.client_logo}
                        alt={auth.client_name}
                        className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl object-cover border border-gray-200 dark:border-gray-800 shrink-0"
                      />
                  ) : (
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center border border-gray-200 dark:border-gray-800 shrink-0">
                      <AppWindow className="h-5 w-5 sm:h-6 sm:w-6 text-gray-500 dark:text-gray-300" aria-hidden />
                    </div>
                  )}

                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {auth.client_name}
                      </h3>
                      <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 mt-1 truncate">
                        授权范围：{auth.scope || '-'}
                      </p>
                      <div className="mt-2 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                        <p>首次授权：{formatDateTime(auth.created_at)}</p>
                        <p>最近使用：{formatDateTime(auth.last_used_at)}</p>
                      </div>
                    </div>
                  </div>

                  <UIButton onPress={() => handleRevoke(auth)} variant="danger" className="text-xs sm:text-sm shrink-0 ml-13 sm:ml-0">
                    撤回
                  </UIButton>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
