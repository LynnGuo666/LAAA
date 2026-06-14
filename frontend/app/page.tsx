'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { buttonVariants, cn } from '@heroui/react';
import { siteApi } from '@/lib/api';

export default function Home() {
  const [siteName, setSiteName] = useState('OAuth 服务器');

  useEffect(() => {
    siteApi.get()
      .then((res) => setSiteName(res.data?.site_name || 'OAuth 服务器'))
      .catch(() => {
        // ignore
      });
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-8 text-center">
        <h1 className="text-6xl font-bold">{siteName}</h1>
        <p className="text-xl text-default-600">
          个人 OAuth 2.0 认证授权服务器
        </p>

        <div className="flex gap-4 justify-center pt-8">
          <Link href="/login" className={buttonVariants({ variant: 'primary' })}>登录</Link>
          <Link href="/register" className={cn(buttonVariants({ variant: 'secondary' }))}>邀请码注册</Link>
        </div>

        <div className="pt-12 text-sm text-default-500">
          <p>为你的应用提供安全的认证和授权服务</p>
        </div>
      </div>
    </main>
  );
}
