'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [formData, setFormData] = useState({
    username: '',
    password: '',
    rememberMe: false,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

      // 跳转到控制台
      router.push('/dashboard');
    } catch (err: any) {
      console.error('登录错误:', err);
      const errorMsg = err.response?.data?.detail || err.message || '登录失败，请重试';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-bold">登录</h2>
          <p className="mt-2 text-gray-600">登录到你的 OAuth 账号</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
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
              className="input"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              disabled={loading}
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
              className="input"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              disabled={loading}
            />
          </div>

          <div className="flex items-center">
            <input
              id="remember-me"
              type="checkbox"
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              checked={formData.rememberMe}
              onChange={(e) => setFormData({ ...formData, rememberMe: e.target.checked })}
              disabled={loading}
            />
            <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-700">
              记住我 30 天
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '登录中...' : '登录'}
          </button>

          <div className="text-center text-sm">
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
