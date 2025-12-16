'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/lib/store';
import { authApi, siteApi } from '@/lib/api';
import { isAdmin } from '@/lib/authz';

type NavItem = { href: string; label: string };
type NavGroup = { label: string; items: NavItem[] };

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, setUser, logout } = useAuthStore();
  const [siteName, setSiteName] = useState('OAuth 服务器');

  useEffect(() => {
    // Check if user is authenticated
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }

    // Load user if not already loaded
    if (!user) {
      authApi.getMe()
        .then((response) => {
          setUser(response.data);
        })
        .catch(() => {
          router.push('/login');
        });
    }
  }, [user, setUser, router]);

  useEffect(() => {
    siteApi.get()
      .then((res) => setSiteName(res.data?.site_name || 'OAuth 服务器'))
      .catch(() => {
        // ignore
      });
  }, []);

  // Admin permission check
  useEffect(() => {
    if (!user) return;

    if (!isAdmin(user)) {
      router.replace('/dashboard');
    }
  }, [user, router]);

  const handleLogout = async () => {
    const refreshToken = localStorage.getItem('refresh_token');
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch (err) {
        // Ignore errors
      }
    }
    logout();
    router.push('/login');
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  // Non-admin users should not see admin panel
  if (!isAdmin(user)) {
    return null;
  }

  const adminNavGroups: NavGroup[] = [
    { label: '总览', items: [{ href: '/admin', label: '控制台' }] },
    {
      label: '应用',
      items: [
        { href: '/admin/apps', label: '应用管理' },
      ],
    },
    {
      label: '用户与权限',
      items: [
        { href: '/admin/users', label: '用户管理' },
        { href: '/admin/groups', label: '用户组' },
        { href: '/admin/invites', label: '邀请码' },
      ],
    },
    {
      label: '系统',
      items: [
        { href: '/admin/settings', label: '站点设置' },
      ],
    },
  ];

  const isActiveHref = (href: string) => {
    if (href === '/admin') return pathname === '/admin';
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const AdminNavContent = () => (
    <div className="space-y-3">
      {adminNavGroups.map((group) => (
        <div key={group.label}>
          <div className="px-3 py-2 text-xs font-semibold tracking-wide text-gray-500 dark:text-gray-400">
            {group.label}
          </div>
          <div className="space-y-1">
            {group.items.map((item) => {
              const active = isActiveHref(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block px-3 py-2 rounded-lg text-sm ${
                    active
                      ? 'bg-blue-600/10 text-blue-700 dark:text-blue-300'
                      : 'text-gray-700 dark:text-gray-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  const AdminSideNav = ({ className = '' }: { className?: string }) => (
    <aside className={className}>
      <div className="surface p-3">
        <AdminNavContent />
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Navigation */}
      <nav className="bg-white dark:bg-gray-900 shadow-sm border-b border-transparent dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <Link
                href="/admin"
                className="flex items-center px-2 py-2 text-xl font-bold"
              >
                {siteName}
                <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">管理</span>
              </Link>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/dashboard/my-apps"
                className="btn btn-secondary text-sm"
              >
                返回用户面板
              </Link>
              <span className="text-sm text-gray-700 dark:text-gray-200">
                {user.username}
              </span>
              <button
                onClick={handleLogout}
                className="btn btn-secondary text-sm"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          {/* Mobile menu */}
          <div className="md:hidden">
            <details className="surface p-3">
              <summary className="cursor-pointer select-none text-sm font-medium text-gray-700 dark:text-gray-200 px-2 py-1">
                菜单
              </summary>
              <div className="mt-3 px-1">
                <AdminNavContent />
              </div>
            </details>
          </div>
          {/* Desktop sidebar */}
          <AdminSideNav className="hidden md:block w-full md:w-64 shrink-0" />
          {/* Content */}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </main>
    </div>
  );
}
