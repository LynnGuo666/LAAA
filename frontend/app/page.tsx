'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { buttonVariants, cn } from '@heroui/react';
import { ArrowRight, Sparkles, LogIn, UserPlus } from 'lucide-react';
import { siteApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import AnimatedCharacters from '@/components/animated-characters/AnimatedCharacters';

export default function Home() {
  const { user, isAuthenticated } = useAuthStore();
  const [siteName, setSiteName] = useState('OAuth 服务器');

  useEffect(() => {
    siteApi.get()
      .then((res) => setSiteName(res.data?.site_name || 'OAuth 服务器'))
      .catch(() => {
        // ignore
      });
  }, []);

  return (
    <main className="min-h-screen grid lg:grid-cols-2 bg-background">
      {/* ─── 左：品牌 + 动画主视觉 ─── */}
      <section className="relative flex flex-col justify-between overflow-hidden bg-gradient-to-br from-primary-900 via-primary-700 to-primary-500 p-8 lg:p-12">
        {/* 装饰光斑 */}
        <div className="pointer-events-none absolute right-[10%] top-[12%] h-64 w-64 rounded-full bg-white/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-[8%] left-[5%] h-80 w-80 rounded-full bg-black/20 blur-3xl" />
        {/* 网格底纹 */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.15]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.4) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.4) 1px,transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        {/* 顶部品牌 */}
        <div className="relative z-10 flex items-center gap-3 text-white">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/25 bg-white/10 backdrop-blur">
            <Sparkles className="h-5 w-5" />
          </div>
          <span className="text-xl font-bold tracking-wide">{siteName}</span>
        </div>

        {/* 中央动画角色群 */}
        <div className="relative z-10 flex items-end justify-center py-8">
          <AnimatedCharacters />
        </div>

        {/* 底部标语 */}
        <div className="relative z-10 text-white">
          <h2 className="text-2xl font-bold sm:text-3xl">统一身份认证 · 一处登录</h2>
          <p className="mt-2 max-w-md text-sm text-white/70 sm:text-base">
            个人 OAuth 2.0 授权服务器，为你的应用提供授权码流、Passkey、多应用 RBAC、会话管理与登录异常检测。
          </p>
        </div>
      </section>

      {/* ─── 右：操作区 ─── */}
      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm animate-fade-in">
          {isAuthenticated && user ? (
            // 已登录：进入控制台
            <div className="text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 text-primary">
                <Sparkles className="h-8 w-8" />
              </div>
              <h1 className="text-2xl font-bold text-foreground">欢迎回来，{user.username}</h1>
              <p className="mt-2 text-default-600">你已登录，可直接进入控制台。</p>
              <Link
                href="/dashboard"
                className={cn(
                  buttonVariants({ variant: 'primary' }),
                  'mt-8 flex w-full items-center justify-center gap-2'
                )}
              >
                进入控制台 <ArrowRight className="h-4 w-4" />
              </Link>
              <button
                onClick={() => useAuthStore.getState().logout()}
                className="mt-4 text-sm text-default-500 hover:text-foreground"
              >
                退出登录
              </button>
            </div>
          ) : (
            // 未登录：登录 / 注册入口
            <div className="text-center">
              <h1 className="text-2xl font-bold text-foreground">{siteName}</h1>
              <p className="mt-2 text-sm text-default-600">
                个人 OAuth 2.0 认证授权服务器
              </p>

              <div className="mt-10 space-y-3">
                <Link
                  href="/login"
                  className={cn(
                    buttonVariants({ variant: 'primary' }),
                    'flex w-full items-center justify-center gap-2'
                  )}
                >
                  <LogIn className="h-4 w-4" />
                  登录
                </Link>
                <Link
                  href="/register"
                  className={cn(
                    buttonVariants({ variant: 'secondary' }),
                    'flex w-full items-center justify-center gap-2'
                  )}
                >
                  <UserPlus className="h-4 w-4" />
                  邀请码注册
                </Link>
              </div>

              <p className="mt-8 text-sm text-default-500">
                为你的应用提供安全的认证和授权服务
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
