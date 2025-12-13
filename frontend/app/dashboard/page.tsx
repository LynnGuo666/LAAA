'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { userApi, clientApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { isAdmin } from '@/lib/authz';
import { AppWindow, ChevronRight, ExternalLink, Lock, Monitor } from 'lucide-react';

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState({
    apps: 0,
    authorizations: 0,
    sessions: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    void loadStats();
  }, [user]);

  const loadStats = async () => {
    try {
      const canManageClients = isAdmin(user);
      const [authsResponse, sessionsResponse, appsResponse] = await Promise.all([
        userApi.getAuthorizations(),
        userApi.getSessions(),
        canManageClients ? clientApi.list() : Promise.resolve({ data: [] as any[] }),
      ]);

      setStats({
        apps: appsResponse.data.length,
        authorizations: authsResponse.data.length,
        sessions: sessionsResponse.data.length,
      });
    } catch (err) {
      console.error('加载统计数据失败', err);
    } finally {
      setLoading(false);
    }
  };

  const canManageClients = isAdmin(user);

  return (
    <div className="px-4 sm:px-0 animate-fade-in">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">控制台</h1>

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      ) : (
        <>
          <div className="surface overflow-hidden mb-8">
            <ul className="list">
              {canManageClients && (
                <li className="list-item list-item-pressable">
                  <Link href="/dashboard/apps" className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-600 dark:text-gray-300">应用管理</p>
                      <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                        {stats.apps}
                      </p>
                    </div>
                    <AppWindow className="h-6 w-6 text-gray-500 dark:text-gray-300 shrink-0" aria-hidden />
                  </Link>
                </li>
              )}

              <li className="list-item list-item-pressable">
                <Link href="/dashboard/authorizations" className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-600 dark:text-gray-300">已授权应用</p>
                    <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                      {stats.authorizations}
                    </p>
                  </div>
                  <Lock className="h-6 w-6 text-gray-500 dark:text-gray-300 shrink-0" aria-hidden />
                </Link>
              </li>

              <li className="list-item list-item-pressable">
                <Link href="/dashboard/sessions" className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-600 dark:text-gray-300">活跃会话</p>
                    <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                      {stats.sessions}
                    </p>
                  </div>
                  <Monitor className="h-6 w-6 text-gray-500 dark:text-gray-300 shrink-0" aria-hidden />
                </Link>
              </li>
            </ul>
          </div>

          <div className="surface overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">快速操作</h2>
            </div>
            <ul className="list">
              {canManageClients && (
                <li className="list-item list-item-pressable">
                  <Link href="/dashboard/apps" className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100">创建新应用</p>
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">注册一个新的 OAuth 2.0 应用</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" aria-hidden />
                  </Link>
                </li>
              )}

              <li className="list-item list-item-pressable">
                <Link href="/dashboard/profile" className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100">更新资料</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">管理你的账号设置</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" aria-hidden />
                </Link>
              </li>

              <li className="list-item list-item-pressable">
                <Link href="/dashboard/sessions" className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100">管理会话</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">查看和撤销活跃会话</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" aria-hidden />
                </Link>
              </li>

              {isAdmin(user) && (
                <li className="list-item">
                  <a
                    href="/api/docs"
                    target="_blank"
                    className="flex items-center justify-between gap-4"
                    rel="noreferrer"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100">API 文档</p>
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">查看 API 参考和示例</p>
                    </div>
                    <ExternalLink className="h-5 w-5 text-gray-400 dark:text-gray-500" aria-hidden />
                  </a>
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
