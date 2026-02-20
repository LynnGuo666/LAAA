'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { buttonVariants, cn } from '@heroui/react';
import { useAuthStore } from '@/lib/store';
import { authApi, siteApi } from '@/lib/api';
import { isAdmin } from '@/lib/authz';
import { UIButton } from '@/components/ui/primitives';
import RestrictedModeOverlay from '@/components/RestrictedModeOverlay';

type NavItem = { href: string; label: string };

export default function DashboardLayout({
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

  const handleRestrictedModeComplete = () => {
    // Refresh user data to check if restriction is lifted
    authApi.getMe()
      .then((response) => {
        setUser(response.data);
      })
      .catch(() => {
        // ignore
      });
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

  const navLinks: NavItem[] = [
    { href: '/dashboard/my-apps', label: '我的应用' },
    { href: '/dashboard/authorizations', label: '授权管理' },
    { href: '/dashboard/sessions', label: '会话管理' },
    { href: '/dashboard/security', label: '安全设置' },
    { href: '/dashboard/passkeys', label: '通行密钥' },
    { href: '/dashboard/profile', label: '个人资料' },
  ];

  const userIsAdmin = isAdmin(user);

  // Show restricted mode overlay if user is restricted
  if (user.is_restricted) {
    return (
      <RestrictedModeOverlay
        user={user}
        onComplete={handleRestrictedModeComplete}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Navigation */}
      <nav className="bg-white dark:bg-gray-900 shadow-sm border-b border-transparent dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <Link
                href="/dashboard/my-apps"
                className="flex items-center px-2 py-2 text-xl font-bold"
              >
                {siteName}
              </Link>

              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                {navLinks.map((link) => {
                  const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
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
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              {userIsAdmin && (
                <Link
                  href="/admin"
                  className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'text-xs sm:text-sm px-2 sm:px-3')}
                >
                  <span className="hidden sm:inline">管理面板</span>
                  <span className="sm:hidden">管理</span>
                </Link>
              )}
              <span className="hidden sm:inline text-sm text-gray-700 dark:text-gray-200">
                {user.username}
              </span>
              <UIButton onPress={handleLogout} variant="tertiary" className="text-xs sm:text-sm px-2 sm:px-3"><span className="hidden sm:inline">退出登录</span>
              <span className="sm:hidden">退出</span></UIButton>
            </div>
          </div>
        </div>

        {/* Mobile navigation */}
        <div className="sm:hidden border-t border-gray-200 dark:border-gray-800">
          <div className="flex overflow-x-auto px-4 py-2 gap-4">
            {navLinks.map((link) => {
              const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm whitespace-nowrap px-2 py-1 rounded ${
                    isActive
                      ? 'text-blue-600 bg-blue-50 dark:bg-blue-950'
                      : 'text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
