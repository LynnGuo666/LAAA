'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authApi, passkeyApi, API_URL } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import axios from 'axios';
import {
  isWebAuthnSupported,
  parseAuthenticationOptions,
  getPasskeyCredential,
  serializeAuthenticationCredential,
} from '@/lib/webauthn';

interface ClientInfo {
  name: string;
  description?: string;
  logo?: string;
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [formData, setFormData] = useState({
    username: '',
    password: '',
    rememberMe: false,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [loadingClient, setLoadingClient] = useState(true);
  const [mounted, setMounted] = useState(false);

  // 获取 redirect 参数
  const redirectUrl = searchParams.get('redirect');

  useEffect(() => {
    setMounted(true);
    // Check WebAuthn support
    setWebAuthnSupported(isWebAuthnSupported());
    // 检查是否是从 OAuth 授权页面跳转过来的
    if (redirectUrl && redirectUrl.includes('/oauth/authorize')) {
      // 从 redirect URL 中提取 client_id
      try {
        const url = new URL(redirectUrl, window.location.origin);
        const clientId = url.searchParams.get('client_id');

        if (clientId) {
          fetchClientInfo(clientId);
        } else {
          setLoadingClient(false);
        }
      } catch (err) {
        console.error('解析 redirect URL 失败:', err);
        setLoadingClient(false);
      }
    } else {
      setLoadingClient(false);
    }
  }, [redirectUrl]);

  const fetchClientInfo = async (clientId: string) => {
    try {
      const response = await axios.get(`${API_URL}/api/oauth/client/${clientId}`);
      setClientInfo({
        name: response.data.name,
        description: response.data.description,
        logo: response.data.logo,
      });
    } catch (err) {
      console.error('获取客户端信息失败:', err);
    } finally {
      setLoadingClient(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);

    try {
      const deviceName = `${navigator.userAgent.split(')')[0]})`;
      const response = await authApi.login(
        formData.username,
        formData.password,
        formData.rememberMe,
        formData.rememberMe ? deviceName : undefined
      );

      const { access_token, refresh_token } = response.data;

      // 先获取用户信息（直接传入 token）
      const userResponse = await authApi.getMe(access_token);
      const user = userResponse.data;

      // 然后保存 token 和用户信息
      localStorage.setItem('access_token', access_token);
      localStorage.setItem('refresh_token', refresh_token);

      // 设置认证状态
      setAuth(user, access_token, refresh_token);

      // 如果有 redirect 参数，跳转到指定页面；否则跳转到控制台
      if (redirectUrl) {
        // 安全检查：确保 redirect URL 是内部路径
        if (redirectUrl.startsWith('/')) {
          router.push(redirectUrl);
        } else {
          router.push('/dashboard');
        }
      } else {
        router.push('/dashboard');
      }
    } catch (err: any) {
      console.error('登录错误:', err);
      const errorMsg = err.response?.data?.detail || err.message || '登录失败，请重试';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    if (!webAuthnSupported) {
      setError('您的浏览器不支持通行密钥');
      return;
    }

    setError('');
    setPasskeyLoading(true);

    try {
      // Step 1: Get authentication options
      const optionsResponse = await passkeyApi.getAuthenticationOptions();
      const options = parseAuthenticationOptions(optionsResponse.data);

      // Step 2: Get credential from authenticator
      const credential = await getPasskeyCredential(options);

      // Step 3: Serialize and verify
      const serialized = serializeAuthenticationCredential(credential);
      const deviceName = `${navigator.userAgent.split(')')[0]})`;
      const response = await passkeyApi.verifyAuthentication({
        ...serialized as any,
        remember_me: formData.rememberMe,
        device_name: formData.rememberMe ? deviceName : undefined,
      });

      const { access_token, refresh_token } = response.data;

      // Get user info
      const userResponse = await authApi.getMe(access_token);
      const user = userResponse.data;

      // Save tokens
      localStorage.setItem('access_token', access_token);
      localStorage.setItem('refresh_token', refresh_token);

      // Set auth state
      setAuth(user, access_token, refresh_token);

      // Redirect
      if (redirectUrl && redirectUrl.startsWith('/')) {
        router.push(redirectUrl);
      } else {
        router.push('/dashboard');
      }
    } catch (err: any) {
      console.error('Passkey login failed', err);
      if (err.name === 'NotAllowedError') {
        setError('用户取消了操作');
      } else if (err.response?.data?.detail) {
        setError(err.response.data.detail);
      } else {
        setError('通行密钥登录失败，请重试');
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  if (loadingClient) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <div className="max-w-md w-full surface p-6 sm:p-8 animate-fade-in">
        {/* 应用信息展示 */}
        <div className="text-center mb-6">
          {clientInfo?.logo && (
            <img
              src={clientInfo.logo}
              alt={clientInfo.name}
              className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 rounded"
            />
          )}
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
            登录
          </h1>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300">
            {clientInfo ? (
              <>
                您正在登录到 <strong className="text-gray-900 dark:text-gray-100">{clientInfo.name}</strong>
              </>
            ) : (
              <>
                您正在登录到 <strong className="text-gray-900 dark:text-gray-100">LAAA</strong>
              </>
            )}
          </p>
          {clientInfo?.description && (
            <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-1">{clientInfo.description}</p>
          )}
        </div>

        {/* 登录表单 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1.5">
              用户名
            </label>
            <input
              id="username"
              type="text"
              required
              className="input"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              disabled={loading}
              placeholder="请输入用户名"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
              密码
            </label>
            <input
              id="password"
              type="password"
              required
              className="input"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              disabled={loading}
              placeholder="请输入密码"
            />
          </div>

          <div className="flex items-center">
            <input
              id="remember-me"
              type="checkbox"
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded cursor-pointer"
              checked={formData.rememberMe}
              onChange={(e) => setFormData({ ...formData, rememberMe: e.target.checked })}
              disabled={loading}
            />
            <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-700 cursor-pointer">
              记住我 30 天
            </label>
          </div>

          <button
            type="submit"
            disabled={loading || passkeyLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {loading ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                登录中...
              </span>
            ) : (
              '登录'
            )}
          </button>

          {webAuthnSupported && (
            <>
              <div className="relative my-3">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">或</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handlePasskeyLogin}
                disabled={loading || passkeyLoading}
                className="w-full bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
              >
                {passkeyLoading ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-gray-600" />
                    验证中...
                  </span>
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M12 2C9.24 2 7 4.24 7 7C7 9.76 9.24 12 12 12C14.76 12 17 9.76 17 7C17 4.24 14.76 2 12 2ZM12 10C10.34 10 9 8.66 9 7C9 5.34 10.34 4 12 4C13.66 4 15 5.34 15 7C15 8.66 13.66 10 12 10Z" fill="currentColor"/>
                      <path d="M12 14C7.58 14 4 16.58 4 20V22H20V20C20 16.58 16.42 14 12 14ZM18 20H6V20C6 17.79 8.69 16 12 16C15.31 16 18 17.79 18 20Z" fill="currentColor"/>
                    </svg>
                    使用通行密钥登录
                  </>
                )}
              </button>
            </>
          )}

          <div className="text-center text-sm pt-1">
            <span className="text-gray-600">还没有账号？ </span>
            <Link href="/register" className="text-blue-600 hover:text-blue-700 font-medium">
              注册
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
