'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SessionsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/security#sessions');
  }, [router]);

  return <div className="text-center py-12">跳转中...</div>;
}
