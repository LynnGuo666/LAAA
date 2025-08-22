'use client';

import { useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { useRouter } from 'next/navigation';

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      if (user) {
        router.push('/dashboard');
      } else {
        router.push('/auth/login');
      }
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-4">
            <div className="w-8 h-8 bg-blue-600 rounded-lg animate-pulse"></div>
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">LAAA</h1>
          <p className="text-gray-600 mb-4">统一身份认证系统</p>
          <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-16 h-16 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-4">
          <div className="w-8 h-8 bg-blue-600 rounded-lg"></div>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">LAAA</h1>
        <p className="text-gray-600 mb-4">统一身份认证系统</p>
        <p className="text-gray-500">正在重定向...</p>
      </div>
    </div>
  );
}