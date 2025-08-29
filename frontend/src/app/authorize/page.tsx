'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api';
import { ClientApplication, AuthorizationRequest, User } from '@/types';
import { Suspense } from 'react';

function AuthorizeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clientInfo, setClientInfo] = useState<ClientApplication | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [authRequest, setAuthRequest] = useState<AuthorizationRequest | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);
  
  // 从URL参数提取OAuth请求信息
  const username = searchParams.get('username') || '';
  const password = searchParams.get('password') || '';
  const autoLogin = searchParams.get('auto_login') === 'true';

  useEffect(() => {
    try {
      const responseType = searchParams.get('response_type');
      const clientId = searchParams.get('client_id');
      const redirectUri = searchParams.get('redirect_uri');
      
      if (!responseType || !clientId || !redirectUri || !username || !password) {
        setError('缺少必要的授权参数');
        return;
      }
      
      const authReq: AuthorizationRequest = {
        response_type: responseType,
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: searchParams.get('scope') || 'openid',
        state: searchParams.get('state') || undefined,
        code_challenge: searchParams.get('code_challenge') || undefined,
        code_challenge_method: searchParams.get('code_challenge_method') || undefined,
        nonce: searchParams.get('nonce') || undefined,
      };
      
      setAuthRequest(authReq);
      setScopes(authReq.scope ? authReq.scope.split(' ') : ['openid']);
      
      // 获取客户端信息
      authApi.getClientInfo(clientId)
        .then(client => {
          setClientInfo(client);
          
          // 如果是自动登录（比如LAAA Dashboard），直接授权
          if (autoLogin) {
            handleAuthorize(true);
          }
        })
        .catch(err => {
          console.error('Failed to fetch client info:', err);
          setError('无效的客户端应用');
        });
    } catch (err) {
      setError('解析授权参数失败');
    }
  }, [searchParams, username, password, autoLogin]);

  const getScopeDescription = (scope: string): string => {
    const descriptions: Record<string, string> = {
      'openid': '验证您的身份',
      'profile': '访问您的基本资料信息（姓名、用户名等）',
      'email': '访问您的邮箱地址',
      'phone': '访问您的手机号码',
      'address': '访问您的地址信息',
    };
    return descriptions[scope] || `访问 ${scope} 权限`;
  };

  const handleAuthorize = async (consent: boolean) => {
    if (!authRequest) return;
    
    setLoading(true);
    setError('');

    try {
      const authData = {
        username,
        password,
        client_id: authRequest.client_id,
        redirect_uri: authRequest.redirect_uri,
        scope: authRequest.scope || 'openid',
        state: authRequest.state,
        code_challenge: authRequest.code_challenge,
        code_challenge_method: authRequest.code_challenge_method,
        nonce: authRequest.nonce,
        consent,
      };

      const response = await authApi.authorize(authData);
      
      // 如果是重定向响应，提取Location头并重定向
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        window.location.href = response.headers.location;
      } else {
        // 如果没有重定向，检查响应数据
        setError('授权处理异常，请稍后重试');
      }
    } catch (err: any) {
      if (err.response?.status >= 300 && err.response?.status < 400 && err.response.headers.location) {
        // axios将重定向视为错误，但我们需要处理重定向
        window.location.href = err.response.headers.location;
      } else {
        setError(err.response?.data?.detail || '授权失败，请重试');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeny = () => {
    handleAuthorize(false);
  };

  const handleAllow = () => {
    handleAuthorize(true);
  };

  if (error) {
    return (
      <div className="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-md w-full">
          <div className="card">
            <div className="text-center">
              <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-red-100">
                <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h2 className="mt-4 text-xl font-bold text-gray-900">授权错误</h2>
              <p className="mt-2 text-sm text-gray-600">{error}</p>
              <button
                onClick={() => router.push('/login')}
                className="mt-4 btn-primary"
              >
                返回登录
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!clientInfo || !authRequest) {
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
          <div className="text-center mb-6">
            <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-primary-100">
              <svg className="h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="mt-4 text-xl font-bold text-gray-900">授权请求</h2>
          </div>

          {/* 应用信息 */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
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
            {clientInfo.client_uri && (
              <a 
                href={clientInfo.client_uri} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-sm text-primary-600 hover:text-primary-500 mt-2 inline-block"
              >
                访问官网 →
              </a>
            )}
          </div>

          {/* 权限列表 */}
          <div className="mb-6">
            <h4 className="font-medium text-gray-900 mb-3">此应用将获得以下权限：</h4>
            <ul className="space-y-2">
              {scopes.map((scope) => (
                <li key={scope} className="flex items-center text-sm text-gray-700">
                  <svg className="h-4 w-4 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {getScopeDescription(scope)}
                </li>
              ))}
            </ul>
          </div>

          {/* 隐私政策和服务条款链接 */}
          <div className="mb-6 text-xs text-gray-500">
            <p>通过授权，您同意该应用按照其隐私政策处理您的数据。</p>
            <div className="mt-2 space-x-4">
              {clientInfo.policy_uri && (
                <a 
                  href={clientInfo.policy_uri} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary-600 hover:text-primary-500"
                >
                  隐私政策
                </a>
              )}
              {clientInfo.tos_uri && (
                <a 
                  href={clientInfo.tos_uri} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-primary-600 hover:text-primary-500"
                >
                  服务条款
                </a>
              )}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex space-x-4">
            <button
              onClick={handleDeny}
              disabled={loading}
              className="btn-secondary"
            >
              拒绝
            </button>
            <button
              onClick={handleAllow}
              disabled={loading}
              className="btn-primary"
            >
              {loading ? '处理中...' : '授权'}
            </button>
          </div>

          <div className="mt-4 text-center">
            <p className="text-xs text-gray-500">
              作为 <span className="font-medium">{username}</span> 登录
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense fallback={
      <div className="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    }>
      <AuthorizeContent />
    </Suspense>
  );
}