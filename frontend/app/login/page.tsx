'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [loadingClient, setLoadingClient] = useState(true);

  // 获取 redirect 参数
  const redirectUrl = searchParams.get('redirect');

  useEffect(() => {
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        {/* 应用信息展示 */}
        <div className="text-center mb-8">
          {clientInfo?.logo && (
            <img
              src={clientInfo.logo}
              alt={clientInfo.name}
              className="w-16 h-16 mx-auto mb-4 rounded"
            />
          )}
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            登录
          </h1>
          <p className="text-gray-600">
            {clientInfo ? (
              <>
                您正在登录到 <strong className="text-gray-900">{clientInfo.name}</strong>
              </>
            ) : (
              <>
                您正在登录到 <strong className="text-gray-900">LAAA</strong>
              </>
            )}
          </p>
          {clientInfo?.description && (
            <p className="text-sm text-gray-500 mt-2">{clientInfo.description}</p>
          )}
        </div>

        {/* 登录表单 */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
              用户名
            </label>
            <input
              id="username"
              type="text"
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              disabled={loading}
              placeholder="请输入用户名"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
              密码
            </label>
            <input
              id="password"
              type="password"
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
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
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '登录中...' : '登录'}
          </button>

          <div className="text-center text-sm pt-2">
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
