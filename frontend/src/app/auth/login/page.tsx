'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { apiClient } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import Link from 'next/link';

const loginSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
  totp_token: z.string().optional(),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [requiresMfa, setRequiresMfa] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const router = useRouter();

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setIsLoading(true);
    setError('');

    try {
      const response = await apiClient.login(data);
      
      if (response.requires_mfa) {
        setRequiresMfa(true);
        setError('需要输入TOTP验证码');
      } else if (response.access_token && response.refresh_token) {
        apiClient.setTokens(response.access_token, response.refresh_token);
        // 给用户一点时间看到登录成功的反馈
        setTimeout(() => {
          router.push('/dashboard');
        }, 100);
      }
    } catch (err: any) {
      console.error('Login error:', err);
      const errorMsg = err.response?.data?.detail || err.message || '登录失败，请检查用户名和密码';
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-500 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <span className="text-white text-2xl font-bold">L</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">登录</h1>
            <p className="text-gray-500">欢迎回到 LAAA</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div>
              <label htmlFor="username" className="block text-sm font-semibold text-gray-800 mb-2">
                用户名或邮箱
              </label>
              <div className="relative">
                <input
                  {...register('username')}
                  type="text"
                  autoComplete="username"
                  className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 placeholder-gray-400"
                  placeholder="输入用户名或邮箱"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              </div>
              {errors.username && (
                <p className="mt-2 text-sm text-red-500 flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {errors.username.message}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-gray-800 mb-2">
                密码
              </label>
              <div className="relative">
                <input
                  {...register('password')}
                  type="password"
                  autoComplete="current-password"
                  className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 placeholder-gray-400 pr-10"
                  placeholder="输入密码"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
              </div>
              {errors.password && (
                <p className="mt-2 text-sm text-red-500 flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {errors.password.message}
                </p>
              )}
            </div>

            {requiresMfa && (
              <div>
                <label htmlFor="totp_token" className="block text-sm font-semibold text-gray-800 mb-2">
                  🔐 TOTP 验证码
                </label>
                <input
                  {...register('totp_token')}
                  type="text"
                  className="w-full px-4 py-3 bg-yellow-50 border-2 border-yellow-200 rounded-2xl focus:ring-2 focus:ring-yellow-500 focus:border-yellow-500 transition-all duration-200 placeholder-gray-400 text-center text-lg font-mono tracking-wider"
                  placeholder="输入6位验证码"
                  maxLength={6}
                />
              </div>
            )}

            {error && (
              <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
                <div className="flex items-center">
                  <svg className="w-5 h-5 text-red-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm font-medium text-red-700">{error}</p>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white py-3 px-4 rounded-2xl font-bold hover:from-blue-600 hover:to-purple-700 focus:ring-4 focus:ring-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] shadow-lg hover:shadow-xl"
            >
              {isLoading ? (
                <div className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  登录中...
                </div>
              ) : (
                <div className="flex items-center justify-center">
                  <span>登录</span>
                  <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>
              )}
            </button>
          </form>

          <div className="mt-8 text-center">
            <div className="flex items-center justify-center space-x-2 text-sm">
              <span className="text-gray-500">还没有账户？</span>
              <Link href="/auth/register" className="text-blue-600 hover:text-purple-600 font-semibold transition-colors duration-200 hover:underline">
                立即注册 →
              </Link>
            </div>
          </div>
        </div>

        {/* 底部信息 */}
        <div className="mt-8 text-center text-xs text-gray-400">
          <p>© 2025 LAAA • 现代化身份认证服务</p>
        </div>
      </div>
    </div>
  );
}