'use client';

/**
 * 根布局挂载的会话恢复组件（token A2 方案）。
 *
 * - 首次挂载时调一次 bootstrapAuth（静默迁移 localStorage 残留 /
 *   cookie silent refresh，见 lib/bootstrap.ts）
 * - 期间渲染轻量 skeleton；zustand persist 已 rehydrate 出 user 时
 *   做乐观显示（bootstrap 完成后会校正）
 * - 同时挂上多 tab 登出同步监听
 */
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/store';
import { bootstrapAuth, attachCrossTabLogoutListener } from '@/lib/bootstrap';
import { PageLoadingState } from '@/components/ui/loading';

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  // persist 的 user 在首次客户端渲染前就已 rehydrate（同步 localStorage），
  // 有 user 时直接乐观渲染，避免每次刷新都闪一下 loading
  const hasPersistedUser = useAuthStore((state) => state.isAuthenticated);
  const [ready, setReady] = useState(hasPersistedUser);

  useEffect(() => {
    attachCrossTabLogoutListener();
    let cancelled = false;
    bootstrapAuth().finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return <PageLoadingState />;
  }

  return <>{children}</>;
}
