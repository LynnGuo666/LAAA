'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export default function OAuthCallbackPage() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  useEffect(() => {
    if (error) {
      setStatus('error');
      setMessage(`授权被拒绝: ${error}`);
    } else if (code) {
      setStatus('success');
      setMessage(`授权成功！授权码: ${code.substring(0, 10)}...`);
    } else {
      setStatus('error');
      setMessage('无效的回调参数');
    }
  }, [code, error]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          {status === 'loading' && (
            <>
              <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">处理授权回调...</h2>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">授权成功！</h2>
              <p className="text-gray-600 mb-4">{message}</p>
              {state && (
                <p className="text-sm text-gray-500 mb-4">状态参数: {state}</p>
              )}
              <div className="bg-green-50 p-3 rounded-lg mb-4">
                <p className="text-sm text-green-800">
                  应用现在可以使用此授权码获取访问令牌，然后访问您授权的资源。
                </p>
              </div>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">授权失败</h2>
              <p className="text-gray-600 mb-4">{message}</p>
            </>
          )}

          <div className="space-y-2">
            <button
              onClick={() => window.close()}
              className="w-full bg-gray-100 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-200 transition-colors"
            >
              关闭窗口
            </button>
            <button
              onClick={() => window.history.back()}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition-colors"
            >
              返回
            </button>
          </div>

          {code && (
            <div className="mt-6 p-3 bg-gray-50 rounded-lg">
              <h3 className="font-medium text-gray-900 mb-2">开发者信息</h3>
              <p className="text-xs text-gray-600">
                在实际应用中，应用服务器会使用此授权码向 /oauth/token 端点请求访问令牌。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}