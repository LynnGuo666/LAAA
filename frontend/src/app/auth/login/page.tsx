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
        await login(response.access_token, response.refresh_token);
        router.push('/dashboard');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || '登录失败');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* 左侧品牌区域 */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-blue-600 to-indigo-700 items-center justify-center p-12">
        <div className="text-center text-white max-w-md">
          <div className="w-20 h-20 bg-white bg-opacity-20 rounded-xl flex items-center justify-center mb-8 mx-auto">
            <div className="w-10 h-10 bg-white rounded-lg"></div>
          </div>
          <h1 className="text-4xl font-light mb-4">LAAA</h1>
          <p className="text-xl font-light mb-6">统一身份认证系统</p>
          <p className="text-blue-100 leading-relaxed">
            安全、可靠的企业级身份认证解决方案。支持多因子认证、设备管理和精细化权限控制。
          </p>
        </div>
      </div>

      {/* 右侧登录表单 */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">欢迎回来</h2>
              <p className="text-gray-600">请登录您的账户</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                  用户名或邮箱
                </label>
                <input
                  {...register('username')}
                  type="text"
                  autoComplete="username"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  placeholder="请输入用户名或邮箱"
                />
                {errors.username && (
                  <p className="mt-1 text-sm text-red-600">{errors.username.message}</p>
                )}
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  密码
                </label>
                <input
                  {...register('password')}
                  type="password"
                  autoComplete="current-password"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  placeholder="请输入密码"
                />
                {errors.password && (
                  <p className="mt-1 text-sm text-red-600">{errors.password.message}</p>
                )}
              </div>

              {requiresMfa && (
                <div>
                  <label htmlFor="totp_token" className="block text-sm font-medium text-gray-700 mb-2">
                    验证码
                  </label>
                  <input
                    {...register('totp_token')}
                    type="text"
                    autoComplete="one-time-code"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                    placeholder="请输入6位验证码"
                    maxLength={6}
                  />
                  {errors.totp_token && (
                    <p className="mt-1 text-sm text-red-600">{errors.totp_token.message}</p>
                  )}
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex">
                    <div className="ml-3">
                      <p className="text-sm text-red-700">{error}</p>
                    </div>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? '登录中...' : '登录'}
              </button>
            </form>

            <div className="mt-6 text-center">
              <p className="text-gray-600">
                还没有账户？{' '}
                <Link href="/auth/register" className="text-blue-600 hover:text-blue-700 font-medium">
                  立即注册
                </Link>
              </p>
            </div>
          </div>

          {/* 底部信息 */}
          <div className="mt-8 text-center text-sm text-gray-500">
            <p>使用邀请码注册账户</p>
            <p className="mt-1">© 2025 LAAA. 保留所有权利。</p>
          </div>
        </div>
      </div>
    </div>
  );
}