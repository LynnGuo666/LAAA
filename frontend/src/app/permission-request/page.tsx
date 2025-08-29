'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api';
import { ClientApplication } from '@/types';
import { Suspense } from 'react';

function PermissionDeniedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [clientInfo, setClientInfo] = useState<ClientApplication | null>(null);
  const [loading, setLoading] = useState(true);
  
  const clientId = searchParams.get('client_id');
  const reason = searchParams.get('reason');

  useEffect(() => {
    if (!clientId) {
      setLoading(false);
      return;
    }
    
    // 获取客户端信息
    authApi.getClientInfo(clientId)
      .then(setClientInfo)
      .catch(err => {
        console.error('Failed to fetch client info:', err);
      })
      .finally(() => setLoading(false));
  }, [clientId]);

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">正在加载...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="card">
          <div className="text-center">
            <div className="mx-auto h-16 w-16 flex items-center justify-center rounded-full bg-red-100">
              <svg className="h-10 w-10 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="mt-6 text-2xl font-bold text-gray-900">访问被拒绝</h2>
            <p className="mt-4 text-gray-600">
              抱歉，您没有权限使用此应用
            </p>
          </div>

          {/* 应用信息 */}
          {clientInfo && (
            <div className="mt-6 bg-gray-50 rounded-lg p-4">
              <div className="flex items-center space-x-3">
                {clientInfo.logo_uri && (
                  <img 
                    src={clientInfo.logo_uri} 
                    alt={clientInfo.client_name}
                    className="h-10 w-10 rounded"
                  />
                )}
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">{clientInfo.client_name}</h3>
                  {clientInfo.client_description && (
                    <p className="text-sm text-gray-600">{clientInfo.client_description}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 原因说明 */}
          {reason && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800">
                <span className="font-medium">原因：</span>{reason}
              </p>
            </div>
          )}

          <div className="mt-6 text-sm text-gray-600 text-center">
            <p>如需访问此应用，请联系应用管理员或系统管理员。</p>
          </div>

          <div className="mt-6 flex justify-center">
            <button
              onClick={() => router.push('/')}
              className="btn-primary"
            >
              返回首页
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PermissionRequestPage() {
  return (
    <Suspense fallback={
      <div className="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    }>
      <PermissionDeniedContent />
    </Suspense>
  );
}