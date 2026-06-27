'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Spinner } from '@heroui/react';
import { authApi } from '@/lib/api';
import { CheckCircle, XCircle, Mail } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@heroui/react';

type VerificationStatus = 'loading' | 'success' | 'error' | 'no-token';

type ResultTone = 'loading' | 'success' | 'danger' | 'warning';

const STATUS_CONFIG: Record<
  VerificationStatus,
  {
    icon: LucideIcon;
    tone: ResultTone;
    title: string;
    description: string;
    primary?: { label: string; href: string; variant: 'primary' | 'secondary' };
    secondary?: { label: string; href: string; variant: 'primary' | 'secondary' };
  }
> = {
  loading: {
    icon: CheckCircle,
    tone: 'loading',
    title: '正在验证邮箱',
    description: '请稍候...',
  },
  success: {
    icon: CheckCircle,
    tone: 'success',
    title: '邮箱验证成功',
    description: '您的邮箱已验证，现在可以使用全部功能了。',
    primary: { label: '前往控制台', href: '/dashboard', variant: 'primary' },
    secondary: { label: '登录账号', href: '/login', variant: 'secondary' },
  },
  error: {
    icon: XCircle,
    tone: 'danger',
    title: '验证失败',
    description: '',
    primary: { label: '重新登录', href: '/login', variant: 'primary' },
    secondary: { label: '返回首页', href: '/', variant: 'secondary' },
  },
  'no-token': {
    icon: Mail,
    tone: 'warning',
    title: '缺少验证令牌',
    description: '请通过邮件中的链接访问此页面。',
    primary: { label: '前往控制台', href: '/dashboard', variant: 'primary' },
    secondary: { label: '返回登录', href: '/login', variant: 'secondary' },
  },
};

const toneBg: Record<ResultTone, string> = {
  loading: '',
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
};

function ResultState({
  status,
  description,
}: {
  status: VerificationStatus;
  description: string;
}) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div
      className="surface p-8 text-center animate-fade-in"
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          'w-16 h-16 mx-auto mb-6 rounded-full flex items-center justify-center',
          toneBg[config.tone],
        )}
      >
        {status === 'loading' ? (
          <Spinner size="lg" />
        ) : (
          <Icon className="w-10 h-10" />
        )}
      </div>
      <h2 className="text-2xl font-bold text-foreground mb-2">{config.title}</h2>
      <p className="text-default-600 mb-6">
        {description || config.description}
      </p>
      {(config.primary || config.secondary) && (
        <div className="space-y-3">
          {config.primary && (
            <Link href={config.primary.href}>
              <Button variant={config.primary.variant} className="w-full">
                {config.primary.label}
              </Button>
            </Link>
          )}
          {config.secondary && (
            <Link href={config.secondary.href}>
              <Button variant={config.secondary.variant} className="w-full">
                {config.secondary.label}
              </Button>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

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
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full">
        <ResultState status={status} description={status === 'error' ? errorMessage : ''} />
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
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
