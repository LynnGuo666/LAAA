'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api';
import { ClientApplication, AuthorizationRequest } from '@/types';
import Cookies from 'js-cookie';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clientInfo, setClientInfo] = useState<ClientApplication | null>(null);
  
  // OAuth参数
  const [authRequest, setAuthRequest] = useState<AuthorizationRequest | null>(null);

  useEffect(() => {
    // 检查是否是OAuth授权流程
    const responseType = searchParams.get('response_type');
    const clientId = searchParams.get('client_id');
    const redirectUri = searchParams.get('redirect_uri');
    
    if (responseType && clientId && redirectUri) {
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
      
      // 获取客户端信息
      authApi.getClientInfo(clientId)
        .then(setClientInfo)
        .catch(err => {
          console.error('Failed to fetch client info:', err);
          setError('无效的客户端应用');
        });
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (authRequest) {
        // OAuth授权流程 - 重定向到授权同意页面
        const params = new URLSearchParams({
          ...Object.fromEntries(Object.entries(authRequest).filter(([_, v]) => v !== undefined)),
          username,
          password,
        });
        
        router.push(`/authorize?${params.toString()}`);
      } else {
        // 仪表盘登录 - 使用OAuth授权流程
        const dashboardClientId = process.env.NEXT_PUBLIC_LAAA_DASHBOARD_CLIENT_ID;
        const redirectUri = `${window.location.origin}/callback`;
        
        const oauthParams = new URLSearchParams({
          response_type: 'code',
          client_id: dashboardClientId,
          redirect_uri: redirectUri,
          scope: 'openid profile email',
          state: 'dashboard_login'
        });
        
        // 添加登录信息作为查询参数，这样授权页面可以自动填充
        oauthParams.append('username', username);
        oauthParams.append('password', password);
        oauthParams.append('auto_login', 'true');
        
        // 重定向到OAuth授权页面
        window.location.href = `/oauth/authorize?${oauthParams.toString()}`;
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || '登录失败，请检查用户名和密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-primary-100">
            <svg className="h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            {authRequest ? '登录以授权应用' : '登录您的账户'}
          </h2>
          {authRequest && clientInfo && (
            <div className="mt-4 text-center">
              <p className="text-sm text-gray-600 mb-2">应用程序请求访问您的账户：</p>
              <div className="card max-w-sm mx-auto">
                {clientInfo.logo_uri && (
                  <img 
                    src={clientInfo.logo_uri} 
                    alt={clientInfo.client_name}
                    className="h-12 w-12 mx-auto mb-2 rounded"
                  />
                )}
                <h3 className="font-semibold text-gray-900">{clientInfo.client_name}</h3>
                {clientInfo.client_description && (
                  <p className="text-sm text-gray-600 mt-1">{clientInfo.client_description}</p>
                )}
                {clientInfo.client_uri && (
                  <a 
                    href={clientInfo.client_uri} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-sm text-primary-600 hover:text-primary-500 mt-1 block"
                  >
                    访问官网 →
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700">
                用户名或邮箱
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                className="input-field"
                placeholder="输入用户名或邮箱"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                密码
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="input-field"
                placeholder="输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
            >
              {loading ? '登录中...' : '登录'}
            </button>
          </div>
          
          <div className="text-center">
            <p className="text-sm text-gray-600">
              没有账户？{' '}
              <a 
                href={`/register${authRequest ? `?${searchParams.toString()}` : ''}`}
                className="font-medium text-primary-600 hover:text-primary-500"
              >
                立即注册
              </a>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}