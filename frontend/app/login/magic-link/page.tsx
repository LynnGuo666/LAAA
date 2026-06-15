'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, Spinner, toast } from '@heroui/react';
import Link from 'next/link';
import { verificationApi, authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full surface p-6 sm:p-8 animate-fade-in text-center">
        {/* Verifying */}
        {status === 'verifying' && (
          <>
            <div className="w-16 h-16 mx-auto mb-6 bg-primary/10 rounded-full flex items-center justify-center">
              <Spinner size="md" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-2">
              正在验证
            </h1>
            <p className="text-default-600">
              请稍候，我们正在验证您的链接...
            </p>
          </>
        )}

        {/* Success */}
        {status === 'success' && (
          <>
            <div className="w-16 h-16 mx-auto mb-6 bg-success/10 rounded-full flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-success" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-2">
              验证成功
            </h1>
            <p className="text-default-600 mb-4">
              您已成功登录，{countdown} 秒后自动跳转...
            </p>
            <Link
              href="/dashboard"
              className="text-primary hover:text-primary font-medium"
            >
              立即跳转
            </Link>
          </>
        )}

        {/* Device Mismatch */}
        {status === 'device_mismatch' && (
          <>
            <div className="w-16 h-16 mx-auto mb-6 bg-warning/10 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-warning" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-2">
              设备不匹配
            </h1>
            <p className="text-default-600 mb-6">
              {error}
            </p>
            <Alert status="warning" className="text-left">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description>
                  <p><strong>安全提示：</strong>为了保护您的账户安全，Magic Link 必须在请求它的同一浏览器中打开。</p>
                  <ul className="mt-2 list-disc list-inside space-y-1">
                    <li>请在原设备的浏览器中点击邮件中的链接</li>
                    <li>确保没有使用不同的浏览器或无痕模式</li>
                    <li>如果无法访问原设备，请重新登录并请求新链接</li>
                  </ul>
                </Alert.Description>
              </Alert.Content>
            </Alert>
            <div className="mt-6">
              <Link
                href="/login"
                className="text-primary hover:text-primary font-medium"
              >
                ← 返回登录
              </Link>
            </div>
          </>
        )}

        {/* Error */}
        {status === 'error' && (
          <>
            <div className="w-16 h-16 mx-auto mb-6 bg-danger/10 rounded-full flex items-center justify-center">
              <XCircle className="w-8 h-8 text-danger" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-2">
              验证失败
            </h1>
            <p className="text-default-600 mb-6">
              {error}
            </p>
            <Button variant="primary" className="w-full">
              <Link href="/login">返回登录</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function MagicLinkPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
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
