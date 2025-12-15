'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/lib/store';
import { authApi, siteApi } from '@/lib/api';
import { isAdmin } from '@/lib/authz';

type NavItem = { href: string; label: string };
type NavGroup = { label: string; items: NavItem[] };

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, setUser, logout } = useAuthStore();
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

  useEffect(() => {
    if (!user) return;

    const adminOnlyPrefixes = ['/dashboard/apps', '/dashboard/groups', '/dashboard/users', '/dashboard/invites', '/dashboard/settings'];
    const match = adminOnlyPrefixes.find((prefix) => pathname.startsWith(prefix));
    if (match && !isAdmin(user)) {
      router.replace('/dashboard');
    }
  }, [user, pathname, router]);

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

  const adminView = isAdmin(user);

  const navLinks: NavItem[] = adminView
    ? []
    : [
        { href: '/dashboard/my-apps', label: '我的应用' },
        { href: '/dashboard/authorizations', label: '授权管理' },
        { href: '/dashboard/sessions', label: '会话管理' },
        { href: '/dashboard/passkeys', label: '通行密钥' },
        { href: '/dashboard/profile', label: '个人资料' },
      ];

  const adminNavGroups: NavGroup[] = [
    { label: '总览', items: [{ href: '/dashboard', label: '控制台' }] },
    {
      label: '应用',
      items: [
        { href: '/dashboard/my-apps', label: '应用列表' },
        { href: '/dashboard/apps', label: '应用管理' },
      ],
    },
    {
      label: '用户与权限',
      items: [
        { href: '/dashboard/users', label: '用户管理' },
        { href: '/dashboard/groups', label: '用户组' },
        { href: '/dashboard/invites', label: '邀请码' },
      ],
    },
    {
      label: '安全',
      items: [
        { href: '/dashboard/authorizations', label: '授权管理' },
        { href: '/dashboard/sessions', label: '会话管理' },
        { href: '/dashboard/passkeys', label: '通行密钥' },
      ],
    },
    { label: '系统', items: [{ href: '/dashboard/settings', label: '站点设置' }] },
    { label: '个人', items: [{ href: '/dashboard/profile', label: '个人资料' }] },
  ];

  const isActiveHref = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard';
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
                href={isAdmin(user) ? "/dashboard" : "/dashboard/my-apps"}
                className="flex items-center px-2 py-2 text-xl font-bold"
              >
                {siteName}
              </Link>

              {!adminView ? (
                <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                  {navLinks.map((link) => {
                    const isActive = pathname === link.href;
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        className={`inline-flex items-center px-1 pt-1 text-sm font-medium border-b-2 ${
                          isActive
                            ? 'text-blue-600 border-blue-600'
                            : 'text-gray-500 dark:text-gray-300 border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        {link.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="flex items-center">
              <span className="text-sm text-gray-700 dark:text-gray-200 mr-4">
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
        {adminView ? (
          <div className="flex flex-col gap-6 md:flex-row md:items-start">
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
            <AdminSideNav className="hidden md:block w-full md:w-64 shrink-0" />
            <div className="min-w-0 flex-1">{children}</div>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
