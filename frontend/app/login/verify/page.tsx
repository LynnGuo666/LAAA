'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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

const RISK_LEVEL_NAMES: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

const RISK_LEVEL_COLORS: Record<string, string> = {
  low: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  medium: 'bg-orange-100 text-orange-800 border-orange-200',
  high: 'bg-red-100 text-red-800 border-red-200',
};

export default function VerifyPage() {
  const router = useRouter();
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
      setError(err.response?.data?.detail || '发送验证码失败');
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
      setError(err.response?.data?.detail || '验证失败');
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
      setError(err.response?.data?.detail || '验证失败');
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
      setError(err.response?.data?.detail || '验证失败');
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
      } else {
        setError(err.response?.data?.detail || '通行密钥验证失败');
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

    if (!confirm('跳过验证后，您需要先完成邮箱验证和设置二次验证方式才能正常使用系统。确定要继续吗？')) {
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
      setError(err.response?.data?.detail || '跳过验证失败');
    } finally {
      setSkipping(false);
    }
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const availableMethods = session.available_methods.filter(
    m => m.available && !completedMethods.includes(m.method)
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <div className="max-w-md w-full surface p-6 sm:p-8 animate-fade-in">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            安全验证
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            检测到可疑登录活动，请完成身份验证
          </p>
        </div>

        {/* Risk Info */}
        <div className={`px-4 py-3 rounded-lg border mb-6 ${RISK_LEVEL_COLORS[session.risk_level]}`}>
          <div className="flex items-center justify-between">
            <span className="font-medium">风险等级: {RISK_LEVEL_NAMES[session.risk_level]}</span>
            <span className="text-sm">
              验证进度: {session.completed_verifications}/{session.required_verifications}
            </span>
          </div>
          {session.anomalies.length > 0 && (
            <ul className="mt-2 text-sm space-y-1">
              {session.anomalies.map((a, i) => (
                <li key={i}>• {a.message}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-6">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${(session.completed_verifications / session.required_verifications) * 100}%` }}
          ></div>
        </div>

        {/* Error/Success messages */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 text-sm">
            {success}
          </div>
        )}

        {/* Method Selection */}
        {currentStep === 'select' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              请选择验证方式 (需完成 {session.required_verifications - session.completed_verifications} 次验证)
            </p>
            {availableMethods.map((method) => (
              <button
                key={method.method}
                onClick={() => handleSelectMethod(method.method)}
                className="w-full flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {method.method === 'email_code' && (
                    <Mail className="w-6 h-6 text-blue-500" />
                  )}
                  {method.method === 'totp' && (
                    <ShieldCheck className="w-6 h-6 text-green-500" />
                  )}
                  {method.method === 'passkey' && (
                    <KeyRound className="w-6 h-6 text-orange-500" />
                  )}
                  <div className="text-left">
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      {METHOD_NAMES[method.method]}
                    </div>
                    <div className="text-xs text-gray-500">
                      {method.strength === 'strong' ? '强验证' : '标准验证'}
                    </div>
                  </div>
                </div>
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}

            {availableMethods.length === 0 && (
              <p className="text-center text-gray-500 py-4">
                没有可用的验证方式，请联系管理员
              </p>
            )}

            {/* Skip verification option */}
            <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700 text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                无法完成验证？
              </p>
              <button
                onClick={handleSkipVerification}
                disabled={skipping}
                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
              >
                {skipping ? '处理中...' : '跳过验证，进入受限模式'}
              </button>
            </div>

            <div className="pt-4">
              <Link href="/login" className="text-sm text-blue-600 hover:text-blue-700">
                ← 返回登录
              </Link>
            </div>
          </div>
        )}

        {/* Email Code Verification */}
        {currentStep === 'email_code' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              验证码将发送到 <strong>{session.email_masked}</strong>
            </p>

            {!emailCodeSent ? (
              <button
                onClick={handleSendEmailCode}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? '发送中...' : '发送验证码'}
              </button>
            ) : (
              <>
                <input
                  type="text"
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="请输入6位验证码"
                  className="input text-center text-2xl tracking-widest"
                  maxLength={6}
                />
                <button
                  onClick={handleVerifyEmailCode}
                  disabled={loading || emailCode.length !== 6}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? '验证中...' : '验证'}
                </button>
                <button
                  onClick={handleSendEmailCode}
                  disabled={loading || emailCooldown > 0}
                  className="w-full text-sm text-blue-600 hover:text-blue-700 disabled:text-gray-400"
                >
                  {emailCooldown > 0 ? `重新发送 (${emailCooldown}s)` : '重新发送验证码'}
                </button>
              </>
            )}

            <button
              onClick={() => setCurrentStep('select')}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              选择其他验证方式
            </button>
          </div>
        )}

        {/* TOTP Verification */}
        {currentStep === 'totp' && (
          <div className="space-y-4">
            {!showBackupCode ? (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  请输入身份验证器应用中的6位验证码
                </p>
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="input text-center text-2xl tracking-widest"
                  maxLength={6}
                />
                <button
                  onClick={handleVerifyTOTP}
                  disabled={loading || totpCode.length !== 6}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? '验证中...' : '验证'}
                </button>
                <button
                  onClick={() => setShowBackupCode(true)}
                  className="w-full text-sm text-blue-600 hover:text-blue-700"
                >
                  使用备用码
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  请输入您的8位备用码
                </p>
                <input
                  type="text"
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value.toUpperCase().slice(0, 8))}
                  placeholder="XXXXXXXX"
                  className="input text-center text-2xl tracking-widest"
                  maxLength={8}
                />
                <button
                  onClick={handleVerifyBackupCode}
                  disabled={loading || backupCode.length !== 8}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
                >
                  {loading ? '验证中...' : '验证'}
                </button>
                <button
                  onClick={() => setShowBackupCode(false)}
                  className="w-full text-sm text-blue-600 hover:text-blue-700"
                >
                  使用身份验证器
                </button>
              </>
            )}

            <button
              onClick={() => setCurrentStep('select')}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              选择其他验证方式
            </button>
          </div>
        )}

        {/* Passkey Verification */}
        {currentStep === 'passkey' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center">
              使用您的通行密钥进行验证
            </p>
            <div className="text-center py-8">
              <KeyRound className="w-16 h-16 text-orange-500 mx-auto" />
            </div>
            <button
              onClick={handlePasskeyVerify}
              disabled={loading || !webAuthnSupported}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? '验证中...' : '使用通行密钥验证'}
            </button>

            <button
              onClick={() => setCurrentStep('select')}
              className="w-full text-sm text-gray-500 hover:text-gray-700"
            >
              选择其他验证方式
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
