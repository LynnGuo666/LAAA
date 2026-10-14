'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, Chip, Input, Label, TextField, toast } from '@heroui/react';
import Link from 'next/link';
import { authApi, passkeyApi, API_URL } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { isSafeRedirect } from '@/lib/authz';
import { extractErrorMessage } from '@/lib/errors';
import { PageLoadingState } from '@/components/ui/loading';
import axios from 'axios';
import {
  isWebAuthnSupported,
  parseAuthenticationOptions,
  getPasskeyCredential,
  serializeAuthenticationCredential,
} from '@/lib/webauthn';
import { UICheckbox } from '@/components/ui/primitives';
import { KeyRound } from 'lucide-react';

interface ClientInfo {
  name: string;
  description?: string;
  logo?: string;
}

interface SecurityInfo {
  kicked_session?: {
    device_name?: string;
    ip_address?: string;
  };
  is_suspicious: boolean;
  anomalies: Array<{
    type: string;
    message: string;
    severity: string;
  }>;
}

interface VerificationRequired {
  requires_verification: boolean;
  session_token: string;
  risk_level: string;
  risk_score: number;
  required_verifications: number;
  completed_verifications: number;
  email_masked: string;
  available_methods: Array<{
    method: string;
    strength: string;
    available: boolean;
  }>;
  anomalies: Array<{
    type: string;
    score: number;
    message: string;
  }>;
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [formData, setFormData] = useState({
    username: '',
    password: '',
    rememberMe: false,
  });
  const [error, setError] = useState('');
  const [securityInfo, setSecurityInfo] = useState<SecurityInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [loadingClient, setLoadingClient] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [justRegistered, setJustRegistered] = useState(false);

  // 被踢下线 / 风险提示的延迟跳转定时器
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 获取 redirect 参数
  const redirectUrl = searchParams.get('redirect');

  useEffect(() => {
    setMounted(true);
    // Check WebAuthn support
    setWebAuthnSupported(isWebAuthnSupported());
    // 注册成功后跳转过来的提示
    if (searchParams.get('registered') === 'true') {
      setJustRegistered(true);
    }
    // 检查是否是从 OAuth 授权页面跳转过来的
    if (redirectUrl && redirectUrl.includes('/oauth/authorize')) {
      // 从 redirect URL 中提取 client_id
      try {
        const url = new URL(redirectUrl, window.location.origin);
        const clientId = url.searchParams.get('client_id');

        if (clientId) {
          fetchClientInfo(clientId);
        } else {
          setLoadingClient(false);
        }
      } catch (err) {
        console.error('解析 redirect URL 失败:', err);
        setLoadingClient(false);
      }
    } else {
      setLoadingClient(false);
    }
  }, [redirectUrl, searchParams]);

  // 卸载时清理延迟跳转定时器，避免组件销毁后仍触发 router.push
  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
  }, []);

  const fetchClientInfo = async (clientId: string) => {
    try {
      const response = await axios.get(`${API_URL}/api/oauth/client/${clientId}`);
      setClientInfo({
        name: response.data.name,
        description: response.data.description,
        logo: response.data.logo,
      });
    } catch (err) {
      console.error('获取客户端信息失败:', err);
    } finally {
      setLoadingClient(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setSecurityInfo(null);
    setLoading(true);

    try {
      const deviceName = `${navigator.userAgent.split(')')[0]})`;
      const response = await authApi.login(
        formData.username.trim(), // 输入法/复制粘贴常带入首尾空白，后端按精确匹配会 401
        formData.password,
        formData.rememberMe,
        formData.rememberMe ? deviceName : undefined
      );

      // Check if verification is required (202 response)
      if (response.status === 202) {
        const verificationData: VerificationRequired = response.data;
        // Store verification session in sessionStorage
        sessionStorage.setItem('verification_session', JSON.stringify({
          ...verificationData,
          redirect: isSafeRedirect(redirectUrl) ? redirectUrl : '/dashboard'
        }));
        // Redirect to verification page
        router.push('/login/verify');
        return;
      }

      const { access_token, refresh_token, kicked_session, is_suspicious, anomalies } = response.data;

      // 保存安全信息用于显示
      if (kicked_session || (anomalies && anomalies.length > 0)) {
        setSecurityInfo({
          kicked_session,
          is_suspicious: is_suspicious || false,
          anomalies: anomalies || []
        });
      }

      // 先获取用户信息（直接传入 token）
      const userResponse = await authApi.getMe(access_token);
      const user = userResponse.data;

      // 设置认证状态（token 只存内存；后端已通过 Set-Cookie 下发
      // laaa_refresh / authorize_token，前端不再写 localStorage / cookie）
      setAuth(user, access_token, refresh_token);

      // 如果有安全提示，延迟跳转让用户看到提示
      const redirectDelay = (kicked_session || is_suspicious) ? 2000 : 0;

      const safeRedirect = isSafeRedirect(redirectUrl) ? redirectUrl : '/dashboard';
      if (redirectDelay === 0) {
        router.push(safeRedirect);
      } else {
        redirectTimerRef.current = setTimeout(() => {
          redirectTimerRef.current = null;
          router.push(safeRedirect);
        }, redirectDelay);
      }
    } catch (err: any) {
      console.error('登录错误:', err);
      // Check if this is a 202 response (axios doesn't treat 202 as error by default, but just in case)
      if (err.response?.status === 202) {
        const verificationData: VerificationRequired = err.response.data;
        sessionStorage.setItem('verification_session', JSON.stringify({
          ...verificationData,
          redirect: isSafeRedirect(redirectUrl) ? redirectUrl : '/dashboard'
        }));
        router.push('/login/verify');
        return;
      }
      const errorMsg = extractErrorMessage(err, '登录失败，请重试');
      setError(errorMsg);
      toast.danger(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    if (!webAuthnSupported) {
      setError('您的浏览器不支持通行密钥');
      toast.warning('您的浏览器不支持通行密钥');
      return;
    }

    setError('');
    setPasskeyLoading(true);

    try {
      // Step 1: Get authentication options
      const optionsResponse = await passkeyApi.getAuthenticationOptions();
      const options = parseAuthenticationOptions(optionsResponse.data);

      // Step 2: Get credential from authenticator
      const credential = await getPasskeyCredential(options);

      // Step 3: Serialize and verify（challenge_id 绑定本次请求对应的 challenge）
      const serialized = serializeAuthenticationCredential(credential);
      const deviceName = `${navigator.userAgent.split(')')[0]})`;
      const response = await passkeyApi.verifyAuthentication({
        ...serialized as any,
        remember_me: formData.rememberMe,
        device_name: formData.rememberMe ? deviceName : undefined,
        challenge_id: optionsResponse.data.challenge_id,
      });

      // Check if verification is required (202 response)
      if (response.status === 202) {
        const verificationData: VerificationRequired = response.data;
        sessionStorage.setItem('verification_session', JSON.stringify({
          ...verificationData,
          redirect: isSafeRedirect(redirectUrl) ? redirectUrl : '/dashboard'
        }));
        router.push('/login/verify');
        return;
      }

      const { access_token, refresh_token } = response.data;

      // Get user info
      const userResponse = await authApi.getMe(access_token);
      const user = userResponse.data;

      // Set auth state（token 只存内存，持久化由后端 HttpOnly cookie 负责）
      setAuth(user, access_token, refresh_token);

      // Redirect
      router.push(isSafeRedirect(redirectUrl) ? redirectUrl : '/dashboard');
    } catch (err: any) {
      console.error('Passkey login failed', err);
      // Check if this is a 202 response
      if (err.response?.status === 202) {
        const verificationData: VerificationRequired = err.response.data;
        sessionStorage.setItem('verification_session', JSON.stringify({
          ...verificationData,
          redirect: isSafeRedirect(redirectUrl) ? redirectUrl : '/dashboard'
        }));
        router.push('/login/verify');
        return;
      }
      if (err.name === 'NotAllowedError') {
        setError('用户取消了操作');
        toast.warning('用户取消了操作');
      } else {
        // 统一走错误归一化工具（422 数组 / 结构化对象 / 网络错误都能得到字符串）
        const message = extractErrorMessage(err, '通行密钥登录失败，请重试');
        setError(message);
        toast.danger(message);
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  if (loadingClient) {
    return <PageLoadingState />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full surface p-6 sm:p-8 animate-fade-in">
        {/* 应用信息展示 */}
        <div className="text-center mb-6">
          {clientInfo?.logo && (
            <img
              src={clientInfo.logo}
              alt={clientInfo.name}
              className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 rounded"
            />
          )}
          <h1 className="text-xl sm:text-2xl font-bold text-foreground mb-1">
            登录
          </h1>
          <p className="text-sm sm:text-base text-muted">
            {clientInfo ? (
              <>
                您正在登录到 <strong className="text-foreground">{clientInfo.name}</strong>
              </>
            ) : (
              <>
                您正在登录到 <strong className="text-foreground">LAAA</strong>
              </>
            )}
          </p>
          {clientInfo?.description && (
            <p className="text-xs sm:text-sm text-muted mt-1">{clientInfo.description}</p>
          )}
        </div>

        {/* 登录表单 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 注册成功提示 */}
          {justRegistered && (
            <Alert status="success" className="text-sm">
              <Alert.Indicator />
              <Alert.Content><Alert.Description>注册成功，请使用新账号登录。</Alert.Description></Alert.Content>
            </Alert>
          )}

          {/* 安全信息提示 */}
          {securityInfo && (
            <div className="space-y-2">
              {securityInfo.kicked_session && (
                <Alert status="accent" className="text-sm">
                  <Alert.Indicator />
                  <Alert.Content><Alert.Description><span className="font-medium">会话提醒：</span>您的设备 "{securityInfo.kicked_session.device_name || '未知设备'}" 已被登出，因为达到了最大会话数限制。</Alert.Description></Alert.Content>
                </Alert>
              )}
              {securityInfo.is_suspicious && securityInfo.anomalies.filter(a => a.severity !== 'low').length > 0 && (
                <Alert status="warning" className="text-sm">
                  <Alert.Indicator />
                  <Alert.Content><Alert.Description><span className="font-medium">安全提醒：</span><ul className="mt-1 list-disc list-inside">{securityInfo.anomalies.filter(a => a.severity !== 'low').map((a, i) => (<li key={i}>{a.message}</li>))}</ul></Alert.Description></Alert.Content>
                </Alert>
              )}
              {(securityInfo.kicked_session || securityInfo.is_suspicious) && redirectTimerRef.current && (
                <Button
                  variant="secondary"
                  className="w-full"
                  onPress={() => {
                    if (redirectTimerRef.current) {
                      clearTimeout(redirectTimerRef.current);
                      redirectTimerRef.current = null;
                    }
                    router.push(isSafeRedirect(redirectUrl) ? redirectUrl : '/dashboard');
                  }}
                >
                  立即继续
                </Button>
              )}
            </div>
          )}

          <div>
            <TextField isRequired isDisabled={loading}>
              <Label>用户名</Label>
              <Input id="username" type="text" autoComplete="username" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} placeholder="请输入用户名" />
            </TextField>
          </div>

          <div>
            <TextField isRequired isDisabled={loading}>
              <Label>密码</Label>
              <Input id="password" type="password" autoComplete="current-password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} placeholder="请输入密码" />
            </TextField>
          </div>

          <div className="flex items-center">
            <UICheckbox id="remember-me" isSelected={formData.rememberMe} onChange={(isSelected) => setFormData({ ...formData, rememberMe: isSelected })}
            isDisabled={loading}>
              记住我 30 天
            </UICheckbox>
          </div>

          <Button type="submit" isDisabled={loading || passkeyLoading} variant="primary" className="w-full" isPending={loading}>{loading ? '登录中...' : '登录'}</Button>

          {webAuthnSupported && (
            <>
              <div className="relative my-3">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border"></div>
                </div>
                <div className="relative flex justify-center">
                  <Chip size="sm" variant="soft" color="default">或</Chip>
                </div>
              </div>

              <Button type="button" onPress={handlePasskeyLogin} isDisabled={loading || passkeyLoading} variant="secondary" className="w-full text-foreground" isPending={passkeyLoading}>{!passkeyLoading && (
                <KeyRound className="w-4 h-4 mr-2" />
              )}
              {passkeyLoading ? '验证中...' : '使用通行密钥登录'}</Button>
            </>
          )}

          <div className="text-center text-sm pt-1">
            <span className="text-muted">还没有账号？ </span>
            <Link href="/register" className="text-accent hover:text-accent font-medium">
              注册
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<PageLoadingState />}>
      <LoginContent />
    </Suspense>
  );
}
