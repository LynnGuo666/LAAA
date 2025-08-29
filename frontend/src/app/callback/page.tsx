'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';
import Cookies from 'js-cookie';

function CallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const code = searchParams.get('code');
        const error = searchParams.get('error');
        const errorDescription = searchParams.get('error_description');
        const state = searchParams.get('state');

        if (error) {
          setResult({
            success: false,
            error: error,
            error_description: errorDescription,
            state: state
          });
          setLoading(false);
          return;
        }

        if (!code) {
          setResult({
            success: false,
            error: 'invalid_request',
            error_description: 'No authorization code received'
          });
          setLoading(false);
          return;
        }

        // 如果是dashboard登录，自动交换token并跳转
        if (state === 'dashboard_login') {
          try {
            const clientId = process.env.NEXT_PUBLIC_LAAA_DASHBOARD_CLIENT_ID;
            const redirectUri = `${window.location.origin}/callback`;

            const tokenData = {
              grant_type: 'authorization_code',
              code: code,
              redirect_uri: redirectUri,
              client_id: clientId
            };

            const response = await fetch('/oauth/token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams(tokenData)
            });

            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.detail || '令牌交换失败');
            }

            const tokens = await response.json();

            // 保存tokens
            Cookies.set('access_token', tokens.access_token, { expires: 1 });
            if (tokens.refresh_token) {
              Cookies.set('refresh_token', tokens.refresh_token, { expires: 7 });
            }

            // 跳转到dashboard
            router.push('/dashboard');
            return;
          } catch (err: any) {
            setResult({
              success: false,
              error: 'token_exchange_failed',
              error_description: err.message || '令牌交换失败'
            });
            setLoading(false);
            return;
          }
        }

        // 对于其他授权，只显示结果
        setResult({
          success: true,
          code: code,
          state: state
        });
      } catch (err) {
        setResult({
          success: false,
          error: 'client_error',
          error_description: 'Failed to parse callback parameters'
        });
      }
      
      setLoading(false);
    };

    handleCallback();
  }, [searchParams, router]);

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">处理回调...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="card">
          <div className="text-center mb-6">
            <div className={`mx-auto h-12 w-12 flex items-center justify-center rounded-full ${
              result?.success ? 'bg-green-100' : 'bg-red-100'
            }`}>
              {result?.success ? (
                <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              )}
            </div>
            <h2 className="mt-4 text-xl font-bold text-gray-900">
              {result?.success ? 'OAuth授权成功' : 'OAuth授权失败'}
            </h2>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-medium text-gray-900 mb-2">回调信息：</h3>
            <div className="text-sm space-y-1">
              {result?.success ? (
                <>
                  <div><span className="font-medium">授权码:</span> <code className="bg-gray-200 px-1 rounded text-xs">{result.code}</code></div>
                  {result.state && <div><span className="font-medium">State:</span> {result.state}</div>}
                  <div className="mt-3 text-green-700 text-xs">
                    ✅ 授权成功！现在可以使用这个授权码换取访问令牌。
                  </div>
                </>
              ) : (
                <>
                  <div><span className="font-medium">错误:</span> <span className="text-red-600">{result.error}</span></div>
                  {result.error_description && (
                    <div><span className="font-medium">描述:</span> {result.error_description}</div>
                  )}
                  {result.state && <div><span className="font-medium">State:</span> {result.state}</div>}
                </>
              )}
            </div>
          </div>

          {result?.success && (
            <div className="mt-6">
              <h4 className="font-medium text-gray-900 mb-2">下一步：</h4>
              <div className="text-sm text-gray-600 space-y-2">
                <p>使用以下信息向令牌端点发送请求：</p>
                <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">
{`POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
code=${result.code}
redirect_uri=http://localhost:8000/callback
client_id=YOUR_CLIENT_ID`}
                </pre>
              </div>
            </div>
          )}

          <div className="mt-6 text-center">
            <button
              onClick={() => window.location.href = '/'}
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

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    }>
      <CallbackContent />
    </Suspense>
  );
}