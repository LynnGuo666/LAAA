'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    checkLoginStatus();
  }, []);

  const checkLoginStatus = async () => {
    const token = document.cookie.match(/access_token=([^;]+)/)?.[1];
    if (token) {
      try {
        const response = await fetch('/api/v1/dashboard/profile', {
          headers: {
            'Authorization': `Bearer ${token}`,
          }
        });

        if (response.ok) {
          const userData = await response.json();
          setUser(userData);
          setIsLoggedIn(true);
        }
      } catch (error) {
        console.error('Failed to check login status:', error);
      }
    }
  };

  const logout = () => {
    document.cookie = 'access_token=; Max-Age=0; path=/';
    document.cookie = 'refresh_token=; Max-Age=0; path=/';
    setIsLoggedIn(false);
    setUser(null);
  };

  return (
    <div className="min-h-full">
      {/* Navigation */}
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-gray-900">OAuth 2.0 服务器</h1>
            </div>
            <div className="flex items-center space-x-4">
              {isLoggedIn ? (
                <>
                  <span className="text-sm text-gray-600">
                    欢迎，{user?.full_name || user?.username}
                    {user?.is_admin && (
                      <span className="ml-1 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        管理员
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => router.push('/dashboard')}
                    className="text-sm font-medium text-gray-700 hover:text-gray-900"
                  >
                    仪表盘
                  </button>
                  {user?.is_admin && (
                    <button
                      onClick={() => router.push('/admin/dashboard')}
                      className="text-sm font-medium text-gray-700 hover:text-gray-900"
                    >
                      管理后台
                    </button>
                  )}
                  <button
                    onClick={logout}
                    className="text-sm font-medium text-gray-700 hover:text-gray-900"
                  >
                    退出登录
                  </button>
                </>
              ) : (
                <>
                  <a
                    href="/login"
                    className="text-sm font-medium text-gray-700 hover:text-gray-900"
                  >
                    登录
                  </a>
                  <a
                    href="/register"
                    className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
                  >
                    注册
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="bg-white">
        <div className="max-w-7xl mx-auto py-16 px-4 sm:py-24 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-4xl font-extrabold text-gray-900 sm:text-5xl sm:tracking-tight lg:text-6xl">
              OAuth 2.0 授权服务器
            </h1>
            <p className="max-w-xl mt-5 mx-auto text-xl text-gray-500">
              安全、可靠的OAuth 2.0和OpenID Connect身份认证与授权服务
            </p>
            <div className="mt-8 flex justify-center space-x-4">
              {!isLoggedIn ? (
                <>
                  <a
                    href="/login"
                    className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                  >
                    用户登录
                  </a>
                  <a
                    href="/register"
                    className="inline-flex items-center px-6 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                  >
                    注册账户
                  </a>
                </>
              ) : (
                <button
                  onClick={() => router.push('/dashboard')}
                  className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  进入仪表盘
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="bg-gray-50 py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold text-gray-900">核心功能</h2>
            <p className="mt-4 text-lg text-gray-500">
              完整实现OAuth 2.0和OpenID Connect规范
            </p>
          </div>
          
          <div className="mt-12 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {/* OAuth 2.0 */}
            <div className="bg-white rounded-lg shadow px-6 py-8">
              <div className="text-center">
                <div className="h-12 w-12 mx-auto bg-primary-100 rounded-lg flex items-center justify-center">
                  <svg className="h-6 w-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium text-gray-900">OAuth 2.0</h3>
                <p className="mt-2 text-sm text-gray-500">
                  支持授权码流程、PKCE、客户端认证等完整OAuth 2.0功能
                </p>
              </div>
            </div>

            {/* OpenID Connect */}
            <div className="bg-white rounded-lg shadow px-6 py-8">
              <div className="text-center">
                <div className="h-12 w-12 mx-auto bg-primary-100 rounded-lg flex items-center justify-center">
                  <svg className="h-6 w-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium text-gray-900">OpenID Connect</h3>
                <p className="mt-2 text-sm text-gray-500">
                  提供身份认证、用户信息、ID令牌等OIDC标准功能
                </p>
              </div>
            </div>

            {/* Permission Management */}
            <div className="bg-white rounded-lg shadow px-6 py-8">
              <div className="text-center">
                <div className="h-12 w-12 mx-auto bg-primary-100 rounded-lg flex items-center justify-center">
                  <svg className="h-6 w-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium text-gray-900">权限管理</h3>
                <p className="mt-2 text-sm text-gray-500">
                  细粒度权限控制，应用拥有者可配置用户访问权限
                </p>
              </div>
            </div>

            {/* Security */}
            <div className="bg-white rounded-lg shadow px-6 py-8">
              <div className="text-center">
                <div className="h-12 w-12 mx-auto bg-primary-100 rounded-lg flex items-center justify-center">
                  <svg className="h-6 w-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className="mt-4 text-lg font-medium text-gray-900">安全保障</h3>
                <p className="mt-2 text-sm text-gray-500">
                  JWT签名验证、HTTPS传输、安全的密钥管理、登录日志追踪
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* API Documentation */}
      <div className="bg-white py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h2 className="text-3xl font-extrabold text-gray-900">开发者资源</h2>
            <p className="mt-4 text-lg text-gray-500">
              快速集成和开发指南
            </p>
            <div className="mt-8 flex justify-center space-x-4">
              <a
                href="/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700"
              >
                API文档
              </a>
              <a
                href="/oauth/.well-known/openid_configuration"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                OIDC Discovery
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}