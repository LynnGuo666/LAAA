'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Button, ListBox, ListBoxItem, Popover, Spinner, Tabs } from '@heroui/react';
import { useAuthStore } from '@/lib/store';
import { authApi, siteApi } from '@/lib/api';
import { isAdmin } from '@/lib/authz';
import RestrictedModeOverlay from '@/components/RestrictedModeOverlay';
import { ThemeToggle } from '@/components/ThemeToggle';

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
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

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
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-sm text-default-500">加载中...</p>
        </div>
      </div>
    );
  }

  const navLinks: NavItem[] = [
    { href: '/dashboard/my-apps', label: '我的应用' },
    { href: '/dashboard/authorizations', label: '授权管理' },
    { href: '/dashboard/security', label: '账户安全' },
    { href: '/dashboard/profile', label: '个人资料' },
  ];

  const userIsAdmin = isAdmin(user);
  const legacySecurityRoutes = ['/dashboard/sessions', '/dashboard/passkeys', '/dashboard/security/totp'];
  const normalizedPathname = legacySecurityRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))
    ? '/dashboard/security'
    : pathname;
  const activeDesktopNav = navLinks.find((link) => normalizedPathname === link.href || normalizedPathname.startsWith(`${link.href}/`))?.href || navLinks[0].href;

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
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="bg-background shadow-sm border-b border-default-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <Link
                href="/dashboard/my-apps"
                className="flex items-center px-2 py-2 text-xl font-bold"
              >
                {siteName}
              </Link>

              <div className="hidden sm:ml-6 sm:flex sm:items-center">
                <Tabs
                  className="w-full"
                  selectedKey={activeDesktopNav}
                  variant="primary"
                  onSelectionChange={(key) => {
                    router.push(String(key));
                  }}
                >
                  <Tabs.ListContainer>
                    <Tabs.List aria-label="Dashboard Navigation" className="flex-nowrap">
                      {navLinks.map((link) => (
                        <Tabs.Tab key={link.href} id={link.href} className="whitespace-nowrap">
                          {link.label}
                          <Tabs.Indicator />
                        </Tabs.Tab>
                      ))}
                    </Tabs.List>
                  </Tabs.ListContainer>
                </Tabs>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <ThemeToggle />
              <Popover isOpen={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
                <Popover.Trigger>
                  <Button variant="tertiary" className="px-2 sm:px-3 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {user.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={user.avatar} alt={user.username} className="h-7 w-7 rounded-full object-cover border border-default-300" />
                      ) : (
                        <div className="h-7 w-7 rounded-full bg-default-300 text-default-700 flex items-center justify-center text-xs font-semibold">
                          {user.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="hidden sm:inline text-sm text-default-600 truncate">{user.username}</span>
                    </div>
                  </Button>
                </Popover.Trigger>
                <Popover.Content className="w-44 p-1">
                  <ListBox
                    aria-label="账户菜单"
                    onAction={(key) => {
                      const action = String(key);
                      setAccountMenuOpen(false);
                      if (action === 'profile') {
                        router.push('/dashboard/profile');
                      } else if (action === 'admin') {
                        router.push('/admin');
                      } else if (action === 'logout') {
                        void handleLogout();
                      }
                    }}
                  >
                    <ListBoxItem id="profile">个人资料</ListBoxItem>
                    {userIsAdmin && <ListBoxItem id="admin">管理面板</ListBoxItem>}
                    <ListBoxItem id="logout" className="text-danger">退出登录</ListBoxItem>
                  </ListBox>
                </Popover.Content>
              </Popover>
            </div>
          </div>
        </div>

        {/* Mobile navigation */}
        <div className="sm:hidden border-t border-default-200">
          <div className="flex overflow-x-auto px-4 py-2 gap-4">
               {navLinks.map((link) => {
               const isActive = normalizedPathname === link.href || normalizedPathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm whitespace-nowrap px-2 py-1 rounded ${
                    isActive
                      ? 'text-primary bg-primary/10'
                      : 'text-default-600'
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
