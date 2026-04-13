'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Spinner, toast } from '@heroui/react';
import Link from 'next/link';
import { verificationApi, authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

function MagicLinkContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'device_mismatch'>('verifying');
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(3);

  const token = searchParams.get('token');
  const sessionToken = searchParams.get('session');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('无效的验证链接');
      toast.danger('无效的验证链接');
      return;
    }

    verifyMagicLink();
  }, [token, sessionToken]);

  // Countdown for redirect
  useEffect(() => {
    if (status === 'success' && countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else if (status === 'success' && countdown === 0) {
      // Get redirect URL from sessionStorage or default to dashboard
      const storedSession = sessionStorage.getItem('verification_session');
      let redirectUrl = '/dashboard';
      if (storedSession) {
        try {
          const data = JSON.parse(storedSession);
          redirectUrl = data.redirect || '/dashboard';
        } catch {
          // ignore
        }
        sessionStorage.removeItem('verification_session');
      }
      router.push(redirectUrl);
    }
  }, [status, countdown, router]);

  const verifyMagicLink = async () => {
    try {
      if (sessionToken) {
        // Verification flow magic link
        const response = await verificationApi.verifyMagicLink(token!, sessionToken);

        // Check if verification is complete
        if (response.data.verification_complete && response.data.access_token) {
          // Save tokens
          localStorage.setItem('access_token', response.data.access_token);
          localStorage.setItem('refresh_token', response.data.refresh_token);

          // Also set session cookie for OAuth authorize endpoint
          const maxAge = 60 * 60 * 24 * 7; // 7 days
          document.cookie = `session_token=${response.data.access_token}; path=/; max-age=${maxAge}; SameSite=Lax`;

          // Get user info
          const userResponse = await authApi.getMe(response.data.access_token);
          const user = userResponse.data;

          // Set auth state
          setAuth(user, response.data.access_token, response.data.refresh_token);

          setStatus('success');
        } else {
          // Verification step completed but more steps needed
          // Update session storage and redirect to verification page
          const storedSession = sessionStorage.getItem('verification_session');
          if (storedSession) {
            const data = JSON.parse(storedSession);
            const updatedSession = {
              ...data,
              completed_verifications: response.data.completed_verifications,
              completed_methods: response.data.completed_methods,
              available_methods: response.data.remaining_methods || data.available_methods.filter(
                (m: any) => m.method !== 'magic_link'
              ),
            };
            sessionStorage.setItem('verification_session', JSON.stringify(updatedSession));
          }

          // Redirect to verification page for next step
          router.push('/login/verify');
        }
      } else {
        // Independent magic link login
        const response = await verificationApi.verifyMagicLinkLogin(token!);

        const { access_token, refresh_token } = response.data;

        // Save tokens
        localStorage.setItem('access_token', access_token);
        localStorage.setItem('refresh_token', refresh_token);

        // Also set session cookie for OAuth authorize endpoint
        const maxAge = 60 * 60 * 24 * 7; // 7 days
        document.cookie = `session_token=${access_token}; path=/; max-age=${maxAge}; SameSite=Lax`;

        // Get user info
        const userResponse = await authApi.getMe(access_token);
        const user = userResponse.data;

        // Set auth state
        setAuth(user, access_token, refresh_token);

        setStatus('success');
      }
    } catch (err: any) {
      console.error('Magic link verification failed:', err);

      const errorDetail = err.response?.data?.detail || '';

      if (errorDetail.includes('device') || errorDetail.includes('设备')) {
        setStatus('device_mismatch');
        setError('此链接必须在请求它的同一设备上打开。请在原设备上重新点击链接。');
        toast.warning('此链接必须在请求它的同一设备上打开。请在原设备上重新点击链接。');

        // Notify the original tab about device mismatch (for verification flow)
        if (sessionToken) {
          try {
            localStorage.setItem('magic_link_device_mismatch', sessionToken);
          } catch {
            // ignore localStorage errors
          }
        }
      } else if (errorDetail.includes('expired') || errorDetail.includes('过期')) {
        setStatus('error');
        setError('验证链接已过期，请重新请求');
        toast.danger('验证链接已过期，请重新请求');
      } else if (errorDetail.includes('used') || errorDetail.includes('已使用')) {
        setStatus('error');
        setError('此验证链接已被使用');
        toast.danger('此验证链接已被使用');
      } else {
        setStatus('error');
        const message = errorDetail || '验证失败，请重试';
        setError(message);
        toast.danger(message);
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <div className="max-w-md w-full surface p-6 sm:p-8 animate-fade-in text-center">
        {/* Verifying */}
        {status === 'verifying' && (
          <>
            <div className="w-16 h-16 mx-auto mb-6 bg-primary/10 rounded-full flex items-center justify-center">
              <Spinner size="md" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              正在验证
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              请稍候，我们正在验证您的链接...
            </p>
          </>
        )}

        {/* Success */}
        {status === 'success' && (
          <>
            <div className="w-16 h-16 mx-auto mb-6 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              验证成功
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-4">
              您已成功登录，{countdown} 秒后自动跳转...
            </p>
            <Link
              href="/dashboard"
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              立即跳转
            </Link>
          </>
        )}

        {/* Device Mismatch */}
        {status === 'device_mismatch' && (
          <>
            <div className="w-16 h-16 mx-auto mb-6 bg-yellow-100 dark:bg-yellow-900 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              设备不匹配
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {error}
            </p>
            <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 text-left">
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                <strong>安全提示：</strong>为了保护您的账户安全，Magic Link 必须在请求它的同一浏览器中打开。
              </p>
              <ul className="mt-2 text-sm text-yellow-600 dark:text-yellow-400 list-disc list-inside space-y-1">
                <li>请在原设备的浏览器中点击邮件中的链接</li>
                <li>确保没有使用不同的浏览器或无痕模式</li>
                <li>如果无法访问原设备，请重新登录并请求新链接</li>
              </ul>
            </div>
            <div className="mt-6">
              <Link
                href="/login"
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                ← 返回登录
              </Link>
            </div>
          </>
        )}

        {/* Error */}
        {status === 'error' && (
          <>
            <div className="w-16 h-16 mx-auto mb-6 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              验证失败
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mb-6">
              {error}
            </p>
            <Link
              href="/login"
              className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
            >
              返回登录
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function MagicLinkPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-sm text-default-500">加载中...</p>
        </div>
      </div>
    }>
      <MagicLinkContent />
    </Suspense>
  );
}
