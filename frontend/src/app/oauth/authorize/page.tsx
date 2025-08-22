'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { apiClient } from '../../../lib/api';

interface ApplicationInfo {
  id: string;
  name: string;
  description?: string;
  logo_url?: string;
  website_url?: string;
  support_email?: string;
  privacy_policy_url?: string;
  terms_of_service_url?: string;
  required_security_level: number;
  require_mfa: boolean;
}

interface AuthorizeInfo {
  application: ApplicationInfo;
  user: {
    username: string;
    email: string;
    security_level: number;
  };
  scopes: string[];
  redirect_uri: string;
  state?: string;
}

export default function OAuthAuthorizePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authorizeInfo, setAuthorizeInfo] = useState<AuthorizeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 获取URL参数
  const response_type = searchParams.get('response_type');
  const client_id = searchParams.get('client_id');
  const redirect_uri = searchParams.get('redirect_uri');
  const scope = searchParams.get('scope') || 'read';
  const state = searchParams.get('state');

  useEffect(() => {
    if (!isLoading && !user) {
      // 用户未登录，重定向到登录页面
      const loginUrl = `/auth/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      router.push(loginUrl);
      return;
    }

    if (user && client_id && redirect_uri && response_type) {
      loadAuthorizeInfo();
    }
  }, [user, isLoading, client_id, redirect_uri, response_type]);

  const loadAuthorizeInfo = async () => {
    if (!client_id || !redirect_uri || !response_type) return;

    setLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/oauth/authorize?${new URLSearchParams({
        response_type,
        client_id,
        redirect_uri,
        scope,
        ...(state ? { state } : {})
      })}`, {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${document.cookie.split('access_token=')[1]?.split(';')[0]}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setAuthorizeInfo(data);
      } else {
        const errorData = await response.json();
        setError(errorData.detail || '获取应用信息失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
      console.error('Failed to load authorize info:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAuthorize = async (authorize: boolean) => {
    if (!client_id || !redirect_uri || !response_type) return;

    setAuthorizing(true);
    try {
      const formData = new FormData();
      formData.append('response_type', response_type);
      formData.append('client_id', client_id);
      formData.append('redirect_uri', redirect_uri);
      formData.append('scope', scope);
      formData.append('authorize', authorize.toString());
      if (state) formData.append('state', state);

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/oauth/authorize`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${document.cookie.split('access_token=')[1]?.split(';')[0]}`
        },
        redirect: 'manual' // 不自动重定向
      });

      if (response.status === 302 || response.type === 'opaqueredirect') {
        // 获取重定向URL
        const location = response.headers.get('Location') || redirect_uri;
        window.location.href = location;
      } else {
        const errorData = await response.json();
        setError(errorData.detail || '授权处理失败');
      }
    } catch (err) {
      setError('网络错误，请稍后重试');
      console.error('Authorization error:', err);
    } finally {
      setAuthorizing(false);
    }
  };

  const getScopeDescription = (scope: string) => {
    const descriptions: Record<string, string> = {
      read: '读取您的基本信息',
      profile: '访问您的详细资料',
      email: '访问您的邮箱地址'
    };
    return descriptions[scope] || scope;
  };

  if (isLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">授权失败</h2>
            <p className="text-gray-600 mb-6">{error}</p>
            <button
              onClick={() => window.history.back()}
              className="w-full bg-gray-100 text-gray-700 py-3 px-4 rounded-xl hover:bg-gray-200 transition-colors"
            >
              返回
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!authorizeInfo) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-md mx-auto px-4">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          {/* 头部 */}
          <div className="bg-gradient-to-r from-blue-500 to-purple-600 p-6 text-center">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-white">授权确认</h1>
            <p className="text-blue-100 text-sm mt-1">请确认是否授权应用访问您的信息</p>
          </div>

          <div className="p-6">
            {/* 应用信息 */}
            <div className="flex items-center mb-6 p-4 bg-gray-50 rounded-xl">
              {authorizeInfo.application.logo_url ? (
                <img
                  src={authorizeInfo.application.logo_url}
                  alt={authorizeInfo.application.name}
                  className="w-12 h-12 rounded-lg mr-4 object-cover"
                  onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    target.style.display = 'none';
                  }}
                />
              ) : (
                <div className="w-12 h-12 bg-gray-200 rounded-lg flex items-center justify-center mr-4">
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
              )}
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900">{authorizeInfo.application.name}</h3>
                {authorizeInfo.application.description && (
                  <p className="text-sm text-gray-600 mt-1">{authorizeInfo.application.description}</p>
                )}
                {authorizeInfo.application.website_url && (
                  <a
                    href={authorizeInfo.application.website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                  >
                    访问官网 ↗
                  </a>
                )}
              </div>
            </div>

            {/* 用户信息 */}
            <div className="mb-6">
              <h4 className="font-medium text-gray-900 mb-2">登录身份</h4>
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="font-medium text-blue-900">{authorizeInfo.user.username}</p>
                <p className="text-sm text-blue-700">{authorizeInfo.user.email}</p>
                <p className="text-xs text-blue-600 mt-1">
                  安全等级: {authorizeInfo.user.security_level}
                </p>
              </div>
            </div>

            {/* 权限范围 */}
            <div className="mb-6">
              <h4 className="font-medium text-gray-900 mb-3">应用将获得以下权限：</h4>
              <div className="space-y-2">
                {authorizeInfo.scopes.map((scope, index) => (
                  <div key={index} className="flex items-center p-3 bg-gray-50 rounded-lg">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                    <span className="text-sm text-gray-700">{getScopeDescription(scope)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 安全提示 */}
            {(authorizeInfo.application.required_security_level > 1 || authorizeInfo.application.require_mfa) && (
              <div className="mb-6 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm text-yellow-800">
                      此应用需要安全等级 {authorizeInfo.application.required_security_level} 或以上
                      {authorizeInfo.application.require_mfa && '，且必须启用多因子认证'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex space-x-3">
              <button
                onClick={() => handleAuthorize(false)}
                disabled={authorizing}
                className="flex-1 bg-gray-100 text-gray-700 py-3 px-4 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-50"
              >
                拒绝
              </button>
              <button
                onClick={() => handleAuthorize(true)}
                disabled={authorizing}
                className="flex-1 bg-blue-600 text-white py-3 px-4 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center"
              >
                {authorizing ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  '授权'
                )}
              </button>
            </div>

            {/* 底部链接 */}
            <div className="mt-6 pt-4 border-t border-gray-200 text-center text-xs text-gray-500 space-x-4">
              {authorizeInfo.application.privacy_policy_url && (
                <a
                  href={authorizeInfo.application.privacy_policy_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-gray-700"
                >
                  隐私政策
                </a>
              )}
              {authorizeInfo.application.terms_of_service_url && (
                <a
                  href={authorizeInfo.application.terms_of_service_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-gray-700"
                >
                  服务条款
                </a>
              )}
              {authorizeInfo.application.support_email && (
                <a
                  href={`mailto:${authorizeInfo.application.support_email}`}
                  className="hover:text-gray-700"
                >
                  联系支持
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}