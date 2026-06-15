'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Label, Spinner } from '@heroui/react';
import { authApi, totpApi, passkeyApi } from '@/lib/api';
import { User } from '@/lib/store';
import {
  AlertTriangle,
  Mail,
  ShieldCheck,
  KeyRound,
  Check,
  LogOut,
  ChevronRight,
  ChevronLeft,
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
      <nav className="bg-surface shadow-sm border-b border-default-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <span className="text-xl font-bold text-foreground">
                账户设置
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-default-600">
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
        <Alert status="warning" className="mb-6">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>您的账户处于受限模式</Alert.Title>
            <Alert.Description>
              为了保护您的账户安全，请完成以下设置后才能正常使用系统功能。
            </Alert.Description>
          </Alert.Content>
        </Alert>

        {/* Progress indicator */}
        <div className="flex items-center justify-center gap-4 mb-8">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              emailVerified
                ? 'bg-success/10 text-success'
                : 'bg-primary/10 text-primary'
            }`}>
              {emailVerified ? <Check className="w-5 h-5" /> : '1'}
            </div>
            <span className={`text-sm ${emailVerified ? 'text-success' : 'text-foreground'}`}>
              验证邮箱
            </span>
          </div>
          <ChevronRight className="w-5 h-5 text-default-400" />
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
              hasSecondFactor
                ? 'bg-success/10 text-success'
                : emailVerified
                  ? 'bg-primary/10 text-primary'
                  : 'bg-default-100 text-default-400'
            }`}>
              {hasSecondFactor ? <Check className="w-5 h-5" /> : '2'}
            </div>
            <span className={`text-sm ${hasSecondFactor ? 'text-success' : 'text-default-500'}`}>
              设置二次验证
            </span>
          </div>
        </div>

        {/* Error/Success messages */}
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

        {/* Overview / Step selection */}
        {currentStep === 'overview' && (
          <div className="space-y-4">
            {/* Step 1: Email verification */}
            <div className={`surface p-6 ${emailVerified ? 'opacity-60' : ''}`}>
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  emailVerified
                    ? 'bg-success/10'
                    : 'bg-primary/10'
                }`}>
                  {emailVerified ? (
                    <Check className="w-5 h-5 text-success" />
                  ) : (
                    <Mail className="w-5 h-5 text-primary" />
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
                    <span className="inline-flex items-center gap-1 text-sm text-success">
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
                        <Spinner size="sm" />
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
                    ? 'bg-success/10'
                    : 'bg-default-100'
                }`}>
                  {hasSecondFactor ? (
                    <Check className="w-5 h-5 text-success" />
                  ) : (
                    <ShieldCheck className="w-5 h-5 text-default-400" />
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
                        <span className="inline-flex items-center gap-1 text-sm text-success">
                          <Check className="w-4 h-4" />
                          身份验证器已启用
                        </span>
                      )}
                      {passkeyCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-sm text-success">
                          <Check className="w-4 h-4" />
                          已绑定 {passkeyCount} 个通行密钥
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {/* TOTP option */}
                      <Button onPress={handleStartTOTPSetup} isDisabled={loading || !emailVerified} variant="ghost"
                      className="flex items-center gap-3 p-4 border border-default-200 rounded-lg hover:bg-default-100 transition-colors text-left h-auto"><ShieldCheck className="w-8 h-8 text-success" />
                      <div>
                        <div className="font-medium text-foreground">
                          身份验证器
                        </div>
                        <div className="text-xs text-default-500">
                          使用 TOTP 应用
                        </div>
                      </div></Button>

                      {/* Passkey option */}
                      {webAuthnSupported && (
                        <Button onPress={handleStartPasskeySetup} isDisabled={loading || !emailVerified} variant="ghost"
                        className="flex items-center gap-3 p-4 border border-default-200 rounded-lg hover:bg-default-100 transition-colors text-left h-auto"><KeyRound className="w-8 h-8 text-warning" />
                        <div>
                          <div className="font-medium text-foreground">
                            通行密钥
                          </div>
                          <div className="text-xs text-default-500">
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
                <div className="bg-default-100 rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-2 gap-2">
                    {backupCodes.map((code, i) => (
                      <div key={i} className="font-mono text-sm text-center py-1 bg-background rounded">
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
                  className="text-default-500 hover:text-default-600 p-1 h-auto w-auto"><ChevronLeft className="w-5 h-5" /></Button>
                  <h3 className="text-lg font-semibold text-foreground">
                    设置身份验证器
                  </h3>
                </div>

                <div className="mb-6">
                  <p className="text-sm text-default-600 mb-4">
                    使用 Google Authenticator 或其他 TOTP 应用扫描下方二维码
                  </p>
                  <div className="flex justify-center mb-4">
                    <div className="bg-background p-4 rounded-lg inline-block">
                      <img
                        src={`data:image/png;base64,${totpSetupData.qr_code}`}
                        alt="TOTP QR Code"
                        className="w-48 h-48"
                      />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-sm text-default-500 mb-2">手动输入密钥：</p>
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
                <Spinner size="lg" />
                <p className="mt-2 text-default-600">加载中...</p>
              </div>
            )}
          </div>
        )}

        {/* Passkey Setup */}
        {currentStep === 'passkey' && (
          <div className="surface p-6">
            <div className="flex items-center gap-2 mb-4">
              <Button  onPress={() => setCurrentStep('overview')} variant="ghost"
              className="text-default-500 hover:text-default-600 p-1 h-auto w-auto"><ChevronLeft className="w-5 h-5" /></Button>
              <h3 className="text-lg font-semibold text-foreground">
                绑定通行密钥
              </h3>
            </div>

            <p className="text-sm text-default-600 mb-6">
              通行密钥使用您设备的生物识别（指纹、面容）或 PIN 码进行身份验证，既安全又便捷。
            </p>

            <div className="mb-4">
              <Label className="block text-sm font-medium text-default-600 mb-1">
                通行密钥名称
              </Label>
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
                <Spinner size="sm" />
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
