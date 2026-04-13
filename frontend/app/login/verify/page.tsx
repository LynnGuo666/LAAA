'use client';

import { useState, useEffect } from 'react';
import { Alert, Button, Card, Input, InputOTP, Spinner, toast } from '@heroui/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { verificationApi, authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { Mail, ShieldCheck, KeyRound } from 'lucide-react';
import {
  isWebAuthnSupported,
  parseAuthenticationOptions,
  getPasskeyCredential,
  serializeAuthenticationCredential,
} from '@/lib/webauthn';

interface VerificationMethod {
  method: string;
  strength: string;
  available: boolean;
}

interface Anomaly {
  type: string;
  score: number;
  message: string;
}

interface VerificationSession {
  requires_verification: boolean;
  session_token: string;
  risk_level: string;
  risk_score: number;
  required_verifications: number;
  completed_verifications: number;
  email_masked: string;
  available_methods: VerificationMethod[];
  anomalies: Anomaly[];
  redirect: string;
}

type VerificationStep = 'select' | 'email_code' | 'totp' | 'passkey' | 'backup_code';

const METHOD_NAMES: Record<string, string> = {
  email_code: '邮件验证码',
  totp: '身份验证器',
  passkey: '通行密钥',
};

const ALL_METHODS: Array<'email_code' | 'totp' | 'passkey'> = ['email_code', 'totp', 'passkey'];

const RISK_LEVEL_NAMES: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

const RISK_LEVEL_STATUS: Record<string, 'accent' | 'warning' | 'danger'> = {
  low: 'accent',
  medium: 'warning',
  high: 'danger',
};

export default function VerifyPage() {
  const router = useRouter();
  const confirmDialog = useConfirmDialog();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [session, setSession] = useState<VerificationSession | null>(null);
  const [currentStep, setCurrentStep] = useState<VerificationStep>('select');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Email code state
  const [emailCode, setEmailCode] = useState('');
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailCooldown, setEmailCooldown] = useState(0);

  // TOTP state
  const [totpCode, setTotpCode] = useState('');
  const [showBackupCode, setShowBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState('');

  // WebAuthn support
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);

  // Completed methods (to show which methods are done)
  const [completedMethods, setCompletedMethods] = useState<string[]>([]);

  // Skip verification state
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    // Load session from sessionStorage
    const stored = sessionStorage.getItem('verification_session');
    if (!stored) {
      router.push('/login');
      return;
    }

    try {
      const data = JSON.parse(stored) as VerificationSession;
      setSession(data);

      // Check if already completed
      if (data.completed_verifications >= data.required_verifications) {
        router.push(data.redirect || '/dashboard');
      }
    } catch {
      router.push('/login');
    }

    setWebAuthnSupported(isWebAuthnSupported());
  }, [router]);

  // Email cooldown timer
  useEffect(() => {
    if (emailCooldown > 0) {
      const timer = setTimeout(() => setEmailCooldown(emailCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [emailCooldown]);

  const handleSelectMethod = (method: string) => {
    setError('');
    setSuccess('');
    if (method === 'email_code') {
      setCurrentStep('email_code');
    } else if (method === 'totp') {
      setCurrentStep('totp');
    } else if (method === 'passkey') {
      setCurrentStep('passkey');
    }
  };

  const handleSendEmailCode = async () => {
    if (!session) return;
    setLoading(true);
    setError('');

    try {
      await verificationApi.sendEmailCode(session.session_token);
      setEmailCodeSent(true);
      setEmailCooldown(60);
      setSuccess('验证码已发送到您的邮箱');
    } catch (err: any) {
      const message = err.response?.data?.detail || '发送验证码失败';
      setError(message);
      toast.danger(message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyEmailCode = async () => {
    if (!session || !emailCode) return;
    setLoading(true);
    setError('');

    try {
      const response = await verificationApi.verifyEmailCode(session.session_token, emailCode);
      await handleVerificationResponse(response.data, 'email_code');
    } catch (err: any) {
      const message = err.response?.data?.detail || '验证失败';
      setError(message);
      toast.danger(message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyTOTP = async () => {
    if (!session || !totpCode) return;
    setLoading(true);
    setError('');

    try {
      const response = await verificationApi.verifyTOTP(session.session_token, totpCode);
      await handleVerificationResponse(response.data, 'totp');
    } catch (err: any) {
      const message = err.response?.data?.detail || '验证失败';
      setError(message);
      toast.danger(message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyBackupCode = async () => {
    if (!session || !backupCode) return;
    setLoading(true);
    setError('');

    try {
      const response = await verificationApi.verifyBackupCode(session.session_token, backupCode);
      await handleVerificationResponse(response.data, 'totp');
    } catch (err: any) {
      const message = err.response?.data?.detail || '验证失败';
      setError(message);
      toast.danger(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyVerify = async () => {
    if (!session || !webAuthnSupported) return;
    setLoading(true);
    setError('');

    try {
      // Get authentication options
      const optionsResponse = await verificationApi.startPasskeyVerification(session.session_token);
      const options = parseAuthenticationOptions(optionsResponse.data.options);

      // Get credential
      const credential = await getPasskeyCredential(options);
      const serialized = serializeAuthenticationCredential(credential);

      // Verify
      const response = await verificationApi.completePasskeyVerification(
        session.session_token,
        serialized
      );
      await handleVerificationResponse(response.data, 'passkey');
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('用户取消了操作');
        toast.warning('用户取消了操作');
      } else {
        const message = err.response?.data?.detail || '通行密钥验证失败';
        setError(message);
        toast.danger(message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerificationResponse = async (data: any, method: string) => {
    // Check if login is complete
    if (data.verification_complete && data.access_token) {
      // Save tokens
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);

      // Also set session cookie for OAuth authorize endpoint
      const maxAge = 60 * 60 * 24 * 7; // 7 days
      document.cookie = `session_token=${data.access_token}; path=/; max-age=${maxAge}; SameSite=Lax`;

      // Get user info
      const userResponse = await authApi.getMe(data.access_token);
      const user = userResponse.data;

      // Set auth state
      setAuth(user, data.access_token, data.refresh_token);

      // Clear session storage
      sessionStorage.removeItem('verification_session');

      // Redirect
      router.push(session?.redirect || '/dashboard');
    } else {
      // Update session with new status
      setCompletedMethods([...completedMethods, method]);

      // Update session data
      const updatedSession = {
        ...session!,
        completed_verifications: data.completed_verifications,
        completed_methods: data.completed_methods,
        available_methods: data.remaining_methods || session!.available_methods.filter(m => m.method !== method),
      };
      setSession(updatedSession);
      sessionStorage.setItem('verification_session', JSON.stringify(updatedSession));

      // Go back to method selection
      setCurrentStep('select');
      setSuccess(`${METHOD_NAMES[method]} 验证成功，请继续完成下一步验证`);

      // Reset states
      setEmailCode('');
      setTotpCode('');
      setBackupCode('');
      setEmailCodeSent(false);
    }
  };

  const handleSkipVerification = async () => {
    if (!session) return;

    const shouldSkip = await confirmDialog({
      title: '确认跳过验证',
      description: '跳过验证后，您需要先完成邮箱验证和设置二次验证方式才能正常使用系统。确定要继续吗？',
      confirmText: '继续跳过',
      cancelText: '取消',
      status: 'warning',
      confirmVariant: 'primary',
    });
    if (!shouldSkip) {
      return;
    }

    setSkipping(true);
    setError('');

    try {
      const response = await verificationApi.skipVerification(session.session_token);
      const { access_token, refresh_token } = response.data;

      // Save tokens
      localStorage.setItem('access_token', access_token);
      localStorage.setItem('refresh_token', refresh_token);

      // Also set session cookie for OAuth authorize endpoint
      const maxAge = 60 * 60 * 24 * 7; // 7 days
      document.cookie = `session_token=${access_token}; path=/; max-age=${maxAge}; SameSite=Lax`;

      // Get user info
      const userResponse = await authApi.getMe(access_token);
      const user = userResponse.data;

      // Set auth state
      setAuth(user, access_token, refresh_token);

      // Clear session storage
      sessionStorage.removeItem('verification_session');

      // Redirect to original destination (user will see restricted mode overlay in dashboard)
      router.push(session.redirect || '/dashboard');
    } catch (err: any) {
      const message = err.response?.data?.detail || '跳过验证失败';
      setError(message);
      toast.danger(message);
    } finally {
      setSkipping(false);
    }
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Spinner size="lg" />
      </div>
    );
  }

  const availableMethods = session.available_methods.filter(
    m => m.available && !completedMethods.includes(m.method)
  );
  const methodMap = new Map(session.available_methods.map((m) => [m.method, m]));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 sm:p-0">
      <div className="w-full min-h-screen surface overflow-hidden animate-fade-in">
        <div className="grid grid-cols-1 sm:grid-cols-[5fr_7fr] min-h-screen">

          {/* ── 左栏：安全上下文 ── */}
          <div className="p-6 sm:p-12 flex flex-col gap-6 border-b sm:border-b-0 sm:border-r border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40">
            {/* Icon + title */}
            <div className="flex flex-row sm:flex-col items-center sm:items-start gap-4">
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center shrink-0">
                <svg className="w-9 h-9 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">安全验证</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">检测到可疑登录活动，请完成身份验证</p>
              </div>
            </div>

            {/* Risk Alert */}
            <Alert status={RISK_LEVEL_STATUS[session.risk_level]}>
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>风险等级：{RISK_LEVEL_NAMES[session.risk_level]}</Alert.Title>
                {session.anomalies.length > 0 && (
                  <Alert.Description>
                    <ul className="mt-1 space-y-0.5">
                      {session.anomalies.map((a, i) => (
                        <li key={i}>• {a.message}</li>
                      ))}
                    </ul>
                  </Alert.Description>
                )}
              </Alert.Content>
            </Alert>

            {/* Progress */}
            <div>
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
                <span>验证进度</span>
                <span>{session.completed_verifications} / {session.required_verifications}</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                <div
                  className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${(session.completed_verifications / session.required_verifications) * 100}%` }}
                />
              </div>
            </div>

            <Link href="/login" className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mt-auto">
              ← 返回登录
            </Link>
          </div>

          {/* ── 右栏：验证操作 ── */}
          <div className="p-6 sm:p-12 flex flex-col justify-center max-w-md sm:mx-auto w-full">
            {/* Error / Success feedback */}
            {error && (
              <Alert status="danger" className="mb-4">
                <Alert.Indicator />
                <Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content>
              </Alert>
            )}
            {success && (
              <Alert status="success" className="mb-4">
                <Alert.Indicator />
                <Alert.Content><Alert.Description>{success}</Alert.Description></Alert.Content>
              </Alert>
            )}

            {/* Method Selection */}
            {currentStep === 'select' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">选择验证方式</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">还需完成 {session.required_verifications - session.completed_verifications} 次验证</p>
                </div>
                <div className="space-y-3">
                  {ALL_METHODS.map((methodKey) => {
                    const method = methodMap.get(methodKey);
                    const isCompleted = completedMethods.includes(methodKey);
                    const isDisabled = !method?.available || isCompleted;
                    const META: Record<string, { icon: React.ReactNode; desc: string; color: string }> = {
                      email_code: { icon: <Mail className="w-5 h-5" />, desc: '发送验证码到您的邮箱', color: 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400' },
                      totp: { icon: <ShieldCheck className="w-5 h-5" />, desc: '使用身份验证器应用', color: 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400' },
                      passkey: { icon: <KeyRound className="w-5 h-5" />, desc: '使用指纹、面容或安全密钥', color: 'bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-400' },
                    };
                    const meta = META[methodKey];
                    return (
                      <Card
                        key={methodKey}
                        role={isDisabled ? undefined : 'button'}
                        tabIndex={isDisabled ? -1 : 0}
                        onClick={() => !isDisabled && handleSelectMethod(methodKey)}
                        onKeyDown={(e) => !isDisabled && (e.key === 'Enter' || e.key === ' ') && handleSelectMethod(methodKey)}
                        className={[
                          'flex-row items-center gap-4 transition-all w-full',
                          isCompleted ? 'opacity-70 cursor-default' : isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:shadow-md',
                        ].join(' ')}
                      >
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${meta?.color}`}>
                          {meta?.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-gray-900 dark:text-gray-100">{METHOD_NAMES[methodKey]}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{meta?.desc}</div>
                        </div>
                        {isCompleted ? (
                          <span className="text-xs text-green-600 dark:text-green-400 font-medium shrink-0">已完成</span>
                        ) : !isDisabled ? (
                          <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        ) : null}
                      </Card>
                    );
                  })}
                </div>
                {availableMethods.length === 0 && (
                  <p className="text-center text-sm text-gray-500 py-4">没有可用的验证方式，请联系管理员</p>
                )}
                <div className="pt-2 text-center">
                  <Button onPress={handleSkipVerification} isDisabled={skipping} variant="ghost" className="text-xs text-gray-400 hover:text-gray-600">
                    {skipping ? '处理中...' : '跳过验证，进入受限模式'}
                  </Button>
                </div>
              </div>
            )}

            {/* Email Code */}
            {currentStep === 'email_code' && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">邮件验证码</p>
                  <p className="text-xs text-gray-500">验证码将发送到 <strong>{session.email_masked}</strong></p>
                </div>
                {!emailCodeSent ? (
                  <Button onPress={handleSendEmailCode} isDisabled={loading} variant="primary" className="w-full" isPending={loading}>{loading ? '发送中...' : '发送验证码'}</Button>
                ) : (
                  <>
                    <Input type="text" value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="输入6位验证码" className="text-center tracking-widest" maxLength={6} />
                    <Button onPress={handleVerifyEmailCode} isDisabled={loading || emailCode.length !== 6} variant="primary" className="w-full" isPending={loading}>{loading ? '验证中...' : '验证'}</Button>
                    <Button onPress={handleSendEmailCode} isDisabled={loading || emailCooldown > 0} variant="ghost" className="w-full text-sm">{emailCooldown > 0 ? `重新发送 (${emailCooldown}s)` : '重新发送'}</Button>
                  </>
                )}
                <Button onPress={() => setCurrentStep('select')} variant="secondary" className="w-full text-sm">← 选择其他方式</Button>
              </div>
            )}

            {/* TOTP */}
            {currentStep === 'totp' && (
              <div className="space-y-4">
                {!showBackupCode ? (
                  <>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">身份验证器</p>
                      <p className="text-xs text-gray-500">输入验证器应用中的6位验证码</p>
                    </div>
                    <div className="flex justify-center">
                      <InputOTP value={totpCode} onChange={(value) => setTotpCode(value.replace(/\D/g, '').slice(0, 6))} maxLength={6} inputMode="numeric" pattern="^\d+$">
                        <InputOTP.Group>
                          <InputOTP.Slot index={0} /><InputOTP.Slot index={1} /><InputOTP.Slot index={2} />
                          <InputOTP.Slot index={3} /><InputOTP.Slot index={4} /><InputOTP.Slot index={5} />
                        </InputOTP.Group>
                      </InputOTP>
                    </div>
                    <Button onPress={handleVerifyTOTP} isDisabled={loading || totpCode.length !== 6} variant="primary" className="w-full" isPending={loading}>{loading ? '验证中...' : '验证'}</Button>
                    <Button onPress={() => setShowBackupCode(true)} variant="ghost" className="w-full text-sm">使用备用码</Button>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">备用码</p>
                      <p className="text-xs text-gray-500">输入8位备用码</p>
                    </div>
                    <Input type="text" value={backupCode} onChange={(e) => setBackupCode(e.target.value.toUpperCase().slice(0, 8))} placeholder="XXXXXXXX" className="text-center tracking-widest" maxLength={8} />
                    <Button onPress={handleVerifyBackupCode} isDisabled={loading || backupCode.length !== 8} variant="primary" className="w-full" isPending={loading}>{loading ? '验证中...' : '验证'}</Button>
                    <Button onPress={() => setShowBackupCode(false)} variant="ghost" className="w-full text-sm">使用身份验证器</Button>
                  </>
                )}
                <Button onPress={() => setCurrentStep('select')} variant="secondary" className="w-full text-sm">← 选择其他方式</Button>
              </div>
            )}

            {/* Passkey */}
            {currentStep === 'passkey' && (
              <div className="space-y-4 text-center">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">通行密钥</p>
                  <p className="text-xs text-gray-500">使用已注册的通行密钥验证身份</p>
                </div>
                <div className="py-6">
                  <KeyRound className="w-14 h-14 text-orange-500 mx-auto" />
                </div>
                <Button onPress={handlePasskeyVerify} isDisabled={loading || !webAuthnSupported} variant="primary" className="w-full" isPending={loading}>{loading ? '验证中...' : '使用通行密钥验证'}</Button>
                <Button onPress={() => setCurrentStep('select')} variant="secondary" className="w-full text-sm">← 选择其他方式</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
