'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi, API_URL } from '@/lib/api';
import axios from 'axios';

interface ClientInfo {
  name: string;
  description?: string;
  logo?: string;
}

interface UserInfo {
  username: string;
  email: string;
  avatar?: string;
}

function AuthorizeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  // 获取 URL 参数
  const responseType = searchParams.get('response_type');
  const clientId = searchParams.get('client_id');
  const redirectUri = searchParams.get('redirect_uri');
  const scope = searchParams.get('scope') || 'profile';
  const state = searchParams.get('state');

  useEffect(() => {
    // 验证必需参数
    if (!responseType || !clientId || !redirectUri) {
      setError('缺少必需的授权参数（response_type, client_id, redirect_uri）');
      setLoading(false);
      return;
    }
    checkAuthorization();
  }, []);

  const checkAuthorization = async () => {
    // 检查是否登录
    const token = localStorage.getItem('access_token');
    if (!token) {
      // 未登录，重定向到登录页
      const returnUrl = `/oauth/authorize?${searchParams.toString()}`;
      router.push(`/login?redirect=${encodeURIComponent(returnUrl)}`);
      return;
    }

    try {
      // 获取当前用户信息
      const userResponse = await authApi.getMe(token);
      setCurrentUser(userResponse.data);

      // 获取客户端信息
      const clientResponse = await axios.get(`${API_URL}/api/oauth/client/${clientId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      console.log('Client info from API:', clientResponse.data);
      setClientInfo({
        name: clientResponse.data.name,
        description: clientResponse.data.description,
        logo: clientResponse.data.logo,
      });

      // 验证授权参数
      const response = await axios.get(`${API_URL}/api/oauth/authorize`, {
        params: {
          response_type: responseType,
          client_id: clientId,
          redirect_uri: redirectUri,
          scope: scope,
          state: state,
        },
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      // 如果后端返回 redirect_url，说明已经自动授权（trusted app 或已授权）
      if (response.data?.redirect_url) {
        window.location.href = response.data.redirect_url;
        return;
      }

      setLoading(false);
    } catch (err: any) {
      console.error('授权检查失败', err);

      if (err.response?.status === 403) {
        // 权限被拒绝
        setAccessDenied(true);
        setError(err.response?.data?.detail || '您没有权限访问此应用');
      } else if (err.response?.status === 401) {
        // Token 过期，重新登录
        const returnUrl = `/oauth/authorize?${searchParams.toString()}`;
        router.push(`/login?redirect=${encodeURIComponent(returnUrl)}`);
        return;
      } else {
        setError(err.response?.data?.detail || '授权请求失败');
      }
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (submitting) return;
    const token = localStorage.getItem('access_token');
    if (!token) {
      router.push('/login');
      return;
    }

    try {
      setSubmitting('approve');
      const formData = new URLSearchParams();
      formData.append('response_type', responseType || '');
      formData.append('client_id', clientId || '');
      formData.append('redirect_uri', redirectUri || '');
      formData.append('scope', scope);
      if (state) formData.append('state', state);
      formData.append('action', 'approve');

      const response = await axios.post(
        `${API_URL}/api/oauth/authorize`,
        formData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
        }
      );

      if (response.data?.redirect_url) {
        window.location.href = response.data.redirect_url;
      } else {
        alert('授权失败: 未收到跳转地址');
        setSubmitting(null);
      }
    } catch (err: any) {
      if (err.response?.status === 403) {
        setAccessDenied(true);
        setError(err.response?.data?.detail || '您没有权限访问此应用');
      } else {
        alert('授权失败: ' + (err.response?.data?.detail || '未知错误'));
      }
      setSubmitting(null);
    }
  };

  const handleDeny = () => {
    if (submitting) return;
    setSubmitting('deny');
    if (redirectUri) {
      let url = `${redirectUri}?error=access_denied`;
      if (state) url += `&state=${state}`;
      window.location.href = url;
    } else {
      router.push('/dashboard');
    }
  };

  const handleSwitchAccount = () => {
    // 退出当前账号并重定向回授权页面
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    const returnUrl = `/oauth/authorize?${searchParams.toString()}`;
    router.push(`/login?redirect=${encodeURIComponent(returnUrl)}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">正在验证...</p>
        </div>
      </div>
    );
  }

  if (error && !accessDenied) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
          <div className="text-center">
            <div className="text-6xl mb-4">⚠️</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-4">授权请求错误</h1>
            <p className="text-gray-600 mb-6">{error}</p>
            <button
              onClick={() => router.push('/dashboard')}
              className="btn btn-primary w-full"
            >
              返回控制台
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (accessDenied || error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
          <div className="text-center">
            <div className="text-6xl mb-4">🚫</div>
            <h1 className="text-2xl font-bold text-gray-900 mb-4">访问被拒绝</h1>
            <p className="text-gray-600 mb-6">
              {error || '抱歉，您没有权限访问此应用。请联系管理员为您分配相应的用户组权限。'}
            </p>
            <div className="space-y-3">
              <button
                onClick={() => router.push('/dashboard')}
                className="btn btn-primary w-full"
              >
                返回控制台
              </button>
              {redirectUri && (
                <button
                  onClick={handleDeny}
                  className="btn btn-secondary w-full"
                >
                  返回应用
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        {/* 当前用户信息 */}
        {currentUser && (
          <div className="mb-6 pb-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                {currentUser.avatar ? (
                  <img
                    src={currentUser.avatar}
                    alt={currentUser.username}
                    className="w-10 h-10 rounded-full mr-3"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-medium mr-3">
                    {currentUser.username.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-gray-900">{currentUser.username}</p>
                  <p className="text-xs text-gray-500">{currentUser.email}</p>
                </div>
              </div>
              <button
                onClick={handleSwitchAccount}
                className="text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!!submitting}
              >
                切换账号
              </button>
            </div>
          </div>
        )}

        <div className="text-center mb-6">
          {clientInfo?.logo && (
            <img
              src={clientInfo.logo}
              alt={clientInfo.name}
              className="w-16 h-16 mx-auto mb-4 rounded"
            />
          )}
          <h1 className="text-2xl font-bold text-gray-900 mb-2">授权请求</h1>
          <p className="text-gray-600">
            <strong className="text-gray-900">{clientInfo?.name}</strong> 想要访问您的账号
          </p>
          {clientInfo?.description && (
            <p className="text-sm text-gray-500 mt-2">{clientInfo.description}</p>
          )}
        </div>

        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <h2 className="font-semibold text-gray-900 mb-3">此应用将能够：</h2>
          <div className="space-y-2">
            {scope.split(' ').map((s) => (
              <div key={s} className="flex items-start text-sm text-gray-700">
                <span className="text-green-600 mr-2">✓</span>
                <span>
                  {s === 'profile' && '查看您的基本信息（用户名、头像等）'}
                  {s === 'email' && '查看您的邮箱地址'}
                  {s === 'openid' && '使用 OpenID Connect 进行身份验证'}
                  {s === 'read' && '读取您的用户数据'}
                  {s === 'write' && '修改您的用户数据'}
                  {!['profile', 'email', 'openid', 'read', 'write'].includes(s) && s}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <button
            onClick={handleApprove}
            className="btn btn-primary w-full disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={!!submitting}
          >
            {submitting === 'approve' ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                授权中...
              </span>
            ) : (
              '授权'
            )}
          </button>
          <button
            onClick={handleDeny}
            className="btn btn-secondary w-full disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={!!submitting}
          >
            {submitting === 'deny' ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400/40 border-t-gray-600 dark:border-gray-500/40 dark:border-t-gray-200" />
                正在返回...
              </span>
            ) : (
              '拒绝'
            )}
          </button>
        </div>

        <p className="text-xs text-gray-500 text-center mt-4">
          授权后，该应用将能够在您允许的范围内访问您的信息
        </p>
      </div>
    </div>
  );
}

export default function AuthorizePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    }>
      <AuthorizeContent />
    </Suspense>
  );
}
