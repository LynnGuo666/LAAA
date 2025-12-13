'use client';

import { useEffect } from 'react';

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
          <button className="btn btn-primary" onClick={() => reset()}>
            重试
          </button>
          <a className="btn btn-secondary" href="/dashboard">
            返回控制台
          </a>
        </div>
      </div>
    </div>
  );
}

