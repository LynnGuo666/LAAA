'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/lib/store';
import { authApi } from '@/lib/api';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, setUser, logout } = useAuthStore();

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

  const navLinks = [
    { href: '/dashboard', label: '控制台' },
    { href: '/dashboard/apps', label: '我的应用' },
    { href: '/dashboard/groups', label: '用户组' },
    { href: '/dashboard/sessions', label: '会话管理' },
    { href: '/dashboard/profile', label: '个人资料' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <Link href="/dashboard" className="flex items-center px-2 py-2 text-xl font-bold">
                OAuth 服务器
              </Link>

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
                          : 'text-gray-500 border-transparent hover:border-gray-300'
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center">
              <span className="text-sm text-gray-700 mr-4">
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
        {children}
      </main>
    </div>
  );
}
