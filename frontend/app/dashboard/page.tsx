'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageLoadingState } from '@/components/ui/loading';

export default function DashboardPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard/my-apps');
  }, [router]);

  return <PageLoadingState label="正在跳转..." />;
}
