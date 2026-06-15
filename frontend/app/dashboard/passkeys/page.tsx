'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PasskeysPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/security#passkeys');
  }, [router]);

  return <div className="text-center py-12">跳转中...</div>;
}
