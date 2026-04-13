'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@heroui/react';
import { authApi, totpApi, passkeyApi } from '@/lib/api';
import { User } from '@/lib/store';
import {
  AlertTriangle,
  Mail,
  ShieldCheck,
  KeyRound,
  Check,
  Loader2,
  LogOut,
  ChevronRight,
  Edit2,
} from 'lucide-react';
import {
  isWebAuthnSupported,
  parseRegistrationOptions,
  createPasskeyCredential,
  serializeRegistrationCredential,
} from '@/lib/webauthn';

interface RestrictedModeOverlayProps {
  user: User;
  onComplete: () => void;
}

type Step = 'overview' | 'email' | 'totp' | 'passkey';

interface TOTPSetupData {
  secret: string;
  qr_code: string;
}

export default function RestrictedModeOverlay({ user, onComplete }: RestrictedModeOverlayProps) {
  const router = useRouter();

  const [currentStep, setCurrentStep] = useState<Step>('overview');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Email state
  const [emailSent, setEmailSent] = useState(false);
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [editingEmail, setEditingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState('');

  // TOTP state
  const [totpSetupData, setTotpSetupData] = useState<TOTPSetupData | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showBackupCodes, setShowBackupCodes] = useState(false);

  // Passkey state
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const [passkeyName, setPasskeyName] = useState('');
  const [passkeyRegistering, setPasskeyRegistering] = useState(false);

  // Status
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [passkeyCount, setPasskeyCount] = useState(0);

  useEffect(() => {
    setWebAuthnSupported(isWebAuthnSupported());
    loadSecurityStatus();
  }, []);

  useEffect(() => {
    if (emailCooldown > 0) {
      const timer = setTimeout(() => setEmailCooldown(emailCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [emailCooldown]);

  const loadSecurityStatus = async () => {
    try {
      const [totpRes, passkeyRes] = await Promise.all([
        totpApi.getStatus(),
        passkeyApi.list(),
      ]);
      setTotpEnabled(totpRes.data.enabled);
      setPasskeyCount(passkeyRes.data.length || 0);
    } catch {
      // ignore
    }
  };

  const handleLogout = async () => {
    const refreshToken = localStorage.getItem('refresh_token');
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken);
      } catch {
        // ignore
      }
    }
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    router.push('/login');
  };

  // Email handlers
  const handleSendVerificationEmail = async () => {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await authApi.sendVerificationEmail();
      setEmailSent(true);
      setEmailCooldown(60);
      setSuccess('验证邮件已发送，请检查您的邮箱');
    } catch (err: any) {
      setError(err.response?.data?.detail || '发送失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleChangeEmail = async () => {
    if (!newEmail || !newEmail.includes('@')) {
      setError('请输入有效的邮箱地址');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await authApi.changeEmail(newEmail);
      setSuccess('邮箱已更新，请发送验证邮件');
      setEditingEmail(false);
      setNewEmail('');
      onComplete(); // Refresh user data
    } catch (err: any) {
      setError(err.response?.data?.detail || '修改失败');
    } finally {
      setLoading(false);
    }
  };

  // TOTP handlers
  const handleStartTOTPSetup = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await totpApi.setup();
      setTotpSetupData(response.data);
      setCurrentStep('totp');
    } catch (err: any) {
      setError(err.response?.data?.detail || '开始设置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyTOTP = async () => {
    if (totpCode.length !== 6) {
      setError('请输入 6 位验证码');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await totpApi.verifySetup(totpCode);
      setBackupCodes(response.data.backup_codes);
      setShowBackupCodes(true);
      setTotpSetupData(null);
      setTotpEnabled(true);
      setSuccess('身份验证器已启用！');
    } catch (err: any) {
      setError(err.response?.data?.detail || '验证码错误');
    } finally {
      setLoading(false);
    }
  };

  const handleBackupCodesSaved = () => {
    setShowBackupCodes(false);
    setBackupCodes([]);
    setCurrentStep('overview');
    onComplete(); // Check if restriction is lifted
  };

  // Passkey handlers
  const handleStartPasskeySetup = () => {
    setCurrentStep('passkey');
    setPasskeyName(`通行密钥 ${new Date().toLocaleDateString()}`);
  };

  const handleRegisterPasskey = async () => {
    if (!passkeyName.trim()) {
      setError('请输入通行密钥名称');
      return;
    }

    setPasskeyRegistering(true);
    setError('');

    try {
      // Get registration options
      const optionsResponse = await passkeyApi.getRegistrationOptions();
      const options = parseRegistrationOptions(optionsResponse.data);

      // Create credential
      const credential = await createPasskeyCredential(options);
      const serialized = serializeRegistrationCredential(credential);

      // Verify registration
      await passkeyApi.verifyRegistration({
        ...serialized as any,
        name: passkeyName.trim(),
      });

      setSuccess('通行密钥已绑定！');
      setPasskeyCount(passkeyCount + 1);
      setCurrentStep('overview');
      onComplete(); // Check if restriction is lifted
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('操作已取消');
      } else {
        setError(err.response?.data?.detail || '绑定失败');
      }
    } finally {
      setPasskeyRegistering(false);
    }
  };

  const emailVerified = user.email_verified;
  const hasSecondFactor = totpEnabled || passkeyCount > 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Simple header */}
      <nav className="bg-surface shadow-sm border-b border-transparent dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <span className="text-xl font-bold text-foreground">
                账户设置
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-foreground/80">
                {user.username}
              </span>
              <Button onPress={handleLogout} variant="tertiary" className="text-sm inline-flex items-center gap-1"><LogOut className="w-4 h-4" />
              退出
                            </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main className="max-w-2xl mx-auto py-8 px-4">
        {/* Warning card */}
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6 mb-6">
          <div className="flex items-start gap-4">
            <AlertTriangle className="w-6 h-6 text-yellow-600 dark:text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-2">
                您的账户处于受限模式
              </h2>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                为了保护您的账户安全，请完成以下设置后才能正常使用系统功能。
              </p>
            </div>
          </div>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              emailVerified
                ? 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400'
                : 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400'
            }`}>
              {emailVerified ? <Check className="w-5 h-5" /> : '1'}
            </div>
            <span className={`text-sm ${emailVerified ? 'text-green-600 dark:text-green-400' : 'text-foreground'}`}>
              验证邮箱
            </span>
          </div>
          <ChevronRight className="w-5 h-5 text-gray-400" />
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              hasSecondFactor
                ? 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400'
                : emailVerified
                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400'
                  : 'bg-default-100 text-gray-400'
            }`}>
              {hasSecondFactor ? <Check className="w-5 h-5" /> : '2'}
            </div>
            <span className={`text-sm ${hasSecondFactor ? 'text-green-600 dark:text-green-400' : 'text-default-500'}`}>
              设置二次验证
            </span>
          </div>
        </div>

        {/* Error/Success messages */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm dark:bg-red-950 dark:border-red-900 dark:text-red-200">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 text-sm dark:bg-green-950 dark:border-green-900 dark:text-green-200">
            {success}
          </div>
        )}

        {/* Overview / Step selection */}
        {currentStep === 'overview' && (
          <div className="space-y-4">
            {/* Step 1: Email verification */}
            <div className={`surface p-6 ${emailVerified ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  emailVerified
                    ? 'bg-green-100 dark:bg-green-900'
                    : 'bg-blue-100 dark:bg-blue-900'
                }`}>
                  {emailVerified ? (
                    <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground mb-1">
                    第一步：验证邮箱
                  </h3>
                  <p className="text-sm text-default-600 mb-3">
                    当前邮箱：{user.email}
                  </p>

                  {emailVerified ? (
                    <span className="inline-flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                      <Check className="w-4 h-4" />
                      已验证
                    </span>
                  ) : editingEmail ? (
                    <div className="space-y-3">
                      <Input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="输入新邮箱地址"
                        className="w-full max-w-sm"
                      />
                      <div className="flex gap-2">
                        <Button onPress={handleChangeEmail} isDisabled={loading} variant="primary" className="text-sm">{loading ? '保存中...' : '保存'}</Button>
                        <Button onPress={() => {
                          setEditingEmail(false);
                          setNewEmail('');
                        }} variant="tertiary" className="text-sm">
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button onPress={handleSendVerificationEmail} isDisabled={loading || emailCooldown > 0} variant="primary" className="text-sm inline-flex items-center gap-1">{loading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Mail className="w-4 h-4" />
                      )}
                      {emailCooldown > 0 ? `重新发送 (${emailCooldown}s)` : '发送验证邮件'}</Button>
                      <Button onPress={() => setEditingEmail(true)} variant="tertiary" className="text-sm inline-flex items-center gap-1"><Edit2 className="w-4 h-4" />
                      修改邮箱
                                            </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Step 2: Second factor */}
            <div className={`surface p-6 ${!emailVerified ? 'opacity-60 pointer-events-none' : ''}`}>
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  hasSecondFactor
                    ? 'bg-green-100 dark:bg-green-900'
                    : 'bg-default-100'
                }`}>
                  {hasSecondFactor ? (
                    <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
                  ) : (
                    <ShieldCheck className="w-5 h-5 text-gray-400" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground mb-1">
                    第二步：设置二次验证
                  </h3>
                  <p className="text-sm text-default-600 mb-4">
                    选择以下任一方式增强账户安全
                  </p>

                  {hasSecondFactor ? (
                    <div className="space-y-2">
                      {totpEnabled && (
                        <span className="inline-flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                          <Check className="w-4 h-4" />
                          身份验证器已启用
                        </span>
                      )}
                      {passkeyCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-sm text-green-600 dark:text-green-400">
                          <Check className="w-4 h-4" />
                          已绑定 {passkeyCount} 个通行密钥
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {/* TOTP option */}
                      <Button onPress={handleStartTOTPSetup} isDisabled={loading || !emailVerified} variant="ghost"
                      className="flex items-center gap-3 p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left h-auto"><ShieldCheck className="w-8 h-8 text-green-500" />
                      <div>
                        <div className="font-medium text-foreground">
                          身份验证器
                        </div>
                        <div className="text-xs text-gray-500">
                          使用 TOTP 应用
                        </div>
                      </div></Button>

                      {/* Passkey option */}
                      {webAuthnSupported && (
                        <Button onPress={handleStartPasskeySetup} isDisabled={loading || !emailVerified} variant="ghost"
                        className="flex items-center gap-3 p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left h-auto"><KeyRound className="w-8 h-8 text-orange-500" />
                        <div>
                          <div className="font-medium text-foreground">
                            通行密钥
                          </div>
                          <div className="text-xs text-gray-500">
                            使用设备生物识别
                          </div>
                        </div></Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TOTP Setup */}
        {currentStep === 'totp' && (
          <div className="surface p-6">
            {showBackupCodes ? (
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-4">
                  保存您的备用码
                </h3>
                <p className="text-sm text-default-600 mb-4">
                  如果您无法访问身份验证器应用，可以使用这些备用码登录。每个备用码只能使用一次。
                </p>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-2 gap-2">
                    {backupCodes.map((code, i) => (
                      <div key={i} className="font-mono text-sm text-center py-1 bg-white dark:bg-gray-700 rounded">
                        {code}
                      </div>
                    ))}
                  </div>
                </div>
                <Button onPress={handleBackupCodesSaved} variant="primary" >
                  我已保存备用码
                </Button>
              </div>
            ) : totpSetupData ? (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Button  onPress={() => {
                    setCurrentStep('overview');
                    setTotpSetupData(null);
                  }} variant="ghost"
                  className="text-gray-500 hover:text-gray-700 p-1 h-auto w-auto"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg></Button>
                  <h3 className="text-lg font-semibold text-foreground">
                    设置身份验证器
                  </h3>
                </div>

                <div className="mb-6">
                  <p className="text-sm text-default-600 mb-4">
                    使用 Google Authenticator 或其他 TOTP 应用扫描下方二维码
                  </p>
                  <div className="flex justify-center mb-4">
                    <div className="bg-white p-4 rounded-lg inline-block">
                      <img
                        src={`data:image/png;base64,${totpSetupData.qr_code}`}
                        alt="TOTP QR Code"
                        className="w-48 h-48"
                      />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-gray-500 mb-2">手动输入密钥：</p>
                    <code className="inline-block px-3 py-2 bg-default-100 rounded font-mono text-sm select-all">
                      {totpSetupData.secret}
                    </code>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-default-600 mb-3">
                    输入应用中显示的 6 位验证码
                  </p>
                  <div className="flex gap-3">
                    <Input
                      type="text"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      className="text-center text-xl tracking-widest font-mono w-40"
                      maxLength={6}
                    />
                    <Button onPress={handleVerifyTOTP} isDisabled={loading || totpCode.length !== 6} variant="primary">{loading ? '验证中...' : '验证'}</Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600" />
                <p className="mt-2 text-gray-600">加载中...</p>
              </div>
            )}
          </div>
        )}

        {/* Passkey Setup */}
        {currentStep === 'passkey' && (
          <div className="surface p-6">
            <div className="flex items-center gap-2 mb-4">
              <Button  onPress={() => setCurrentStep('overview')} variant="ghost"
              className="text-gray-500 hover:text-gray-700 p-1 h-auto w-auto"><svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg></Button>
              <h3 className="text-lg font-semibold text-foreground">
                绑定通行密钥
              </h3>
            </div>

            <p className="text-sm text-default-600 mb-6">
              通行密钥使用您设备的生物识别（指纹、面容）或 PIN 码进行身份验证，既安全又便捷。
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                通行密钥名称
              </label>
              <Input
                type="text"
                value={passkeyName}
                onChange={(e) => setPasskeyName(e.target.value)}
                placeholder="例如：MacBook 指纹"
                className="w-full max-w-sm"
              />
            </div>

            <Button onPress={handleRegisterPasskey} isDisabled={passkeyRegistering || !passkeyName.trim()} variant="primary" className="inline-flex items-center gap-2">{passkeyRegistering ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                注册中...
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4" />
                创建通行密钥
              </>
            )}</Button>
          </div>
        )}
      </main>
    </div>
  );
}
