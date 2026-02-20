'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { buttonVariants } from '@heroui/react';
import { UIButton } from '@/components/ui/primitives';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep console logging for debugging in production exports
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card max-w-lg w-full">
        <h1 className="text-2xl font-bold mb-2">页面出错了</h1>
        <p className="text-gray-600 mb-6">
          请刷新重试，或返回控制台继续使用。
        </p>
        <div className="flex gap-3">
          <UIButton  variant="primary" onPress={() => reset()}>
            重试
          </UIButton>
          <Link href="/dashboard" className={buttonVariants({ variant: 'secondary' })}>返回控制台</Link>
        </div>
      </div>
    </div>
  );
}
