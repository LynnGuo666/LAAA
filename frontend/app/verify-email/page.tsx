'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { buttonVariants, cn, Spinner } from '@heroui/react';
import { authApi } from '@/lib/api';
import { CheckCircle, XCircle, Mail } from 'lucide-react';

type VerificationStatus = 'loading' | 'success' | 'error' | 'no-token';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<VerificationStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('no-token');
      return;
    }

    const verifyEmail = async () => {
      try {
        await authApi.verifyEmail(token);
        setStatus('success');
      } catch (err: any) {
        setStatus('error');
        setErrorMessage(err.response?.data?.detail || '验证失败，请重试');
      }
    };

    verifyEmail();
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="max-w-md w-full space-y-8 animate-fade-in">
        <div className="surface p-8 text-center">
          {status === 'loading' && (
            <>
              <div className="w-16 h-16 mx-auto mb-6 flex items-center justify-center">
                <Spinner size="lg" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                正在验证邮箱
              </h2>
              <p className="text-gray-600 dark:text-gray-300">
                请稍候...
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 mx-auto mb-6 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
                <CheckCircle className="w-10 h-10 text-green-500" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                邮箱验证成功
              </h2>
              <p className="text-gray-600 dark:text-gray-300 mb-6">
                您的邮箱已验证，现在可以使用全部功能了。
              </p>
              <div className="space-y-3">
                <Link href="/dashboard" className={cn(buttonVariants({ variant: 'primary', size: 'md', fullWidth: true }))}>前往控制台</Link>
                <Link href="/login" className={cn(buttonVariants({ variant: 'secondary', size: 'md', fullWidth: true }))}>登录账号</Link>
              </div>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 mx-auto mb-6 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center">
                <XCircle className="w-10 h-10 text-red-500" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                验证失败
              </h2>
              <p className="text-gray-600 dark:text-gray-300 mb-6">
                {errorMessage}
              </p>
              <div className="space-y-3">
                <Link href="/dashboard" className={cn(buttonVariants({ variant: 'primary', size: 'md', fullWidth: true }))}>前往控制台重新发送</Link>
                <Link href="/login" className={cn(buttonVariants({ variant: 'secondary', size: 'md', fullWidth: true }))}>返回登录</Link>
              </div>
            </>
          )}

          {status === 'no-token' && (
            <>
              <div className="w-16 h-16 mx-auto mb-6 bg-yellow-100 dark:bg-yellow-900/30 rounded-full flex items-center justify-center">
                <Mail className="w-10 h-10 text-yellow-500" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                缺少验证令牌
              </h2>
              <p className="text-gray-600 dark:text-gray-300 mb-6">
                请通过邮件中的链接访问此页面。
              </p>
              <div className="space-y-3">
                <Link href="/dashboard" className={cn(buttonVariants({ variant: 'primary', size: 'md', fullWidth: true }))}>前往控制台</Link>
                <Link href="/login" className={cn(buttonVariants({ variant: 'secondary', size: 'md', fullWidth: true }))}>返回登录</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <p className="text-sm text-default-500">加载中...</p>
          </div>
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
