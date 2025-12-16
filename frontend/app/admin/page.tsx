'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminApi, clientApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { isAdmin } from '@/lib/authz';
import { AppWindow, ChevronRight, ExternalLink, Users, UserPlus, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function AdminDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const [stats, setStats] = useState({
    apps: 0,
    users: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    if (!isAdmin(user)) {
      router.replace('/dashboard');
      return;
    }
    void loadStats();
  }, [user, router]);

  const loadStats = async () => {
    try {
      const [appsResponse, usersResponse] = await Promise.all([
        clientApi.list(),
        adminApi.listUsers({ limit: 1 }),
      ]);

      setStats({
        apps: appsResponse.data.length,
        users: usersResponse.data.total || 0,
      });
    } catch (err) {
      console.error('加载统计数据失败', err);
    } finally {
      setLoading(false);
    }
  };

  if (!user || !isAdmin(user)) {
    return null;
  }

  return (
    <div className="px-4 sm:px-0 animate-fade-in">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-8">管理控制台</h1>

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      ) : (
        <>
          <div className="surface overflow-hidden mb-8">
            <ul className="list">
              <li className="list-item list-item-pressable">
                <Link href="/admin/apps" className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-600 dark:text-gray-300">应用总数</p>
                    <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                      {stats.apps}
                    </p>
                  </div>
                  <AppWindow className="h-6 w-6 text-gray-500 dark:text-gray-300 shrink-0" aria-hidden />
                </Link>
              </li>

              <li className="list-item list-item-pressable">
                <Link href="/admin/users" className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-600 dark:text-gray-300">用户总数</p>
                    <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                      {stats.users}
                    </p>
                  </div>
                  <Users className="h-6 w-6 text-gray-500 dark:text-gray-300 shrink-0" aria-hidden />
                </Link>
              </li>
            </ul>
          </div>

          <div className="surface overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">快速操作</h2>
            </div>
            <ul className="list">
              <li className="list-item list-item-pressable">
                <Link href="/admin/apps" className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100">管理应用</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">创建和管理 OAuth 2.0 应用</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" aria-hidden />
                </Link>
              </li>

              <li className="list-item list-item-pressable">
                <Link href="/admin/users" className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100">用户管理</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">管理系统用户</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-gray-400 dark:text-gray-500" aria-hidden />
                </Link>
              </li>

              <li className="list-item list-item-pressable">
                <Link href="/admin/invites" className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100">邀请码</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">创建和管理邀请码</p>
                  </div>
                  <UserPlus className="h-5 w-5 text-gray-400 dark:text-gray-500" aria-hidden />
                </Link>
              </li>

              <li className="list-item list-item-pressable">
                <Link href="/admin/settings" className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100">站点设置</p>
                    <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">配置系统参数</p>
                  </div>
                  <Settings className="h-5 w-5 text-gray-400 dark:text-gray-500" aria-hidden />
                </Link>
              </li>

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
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
