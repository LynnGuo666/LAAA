'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertDialog } from '@heroui/react';
import { totpApi } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { UIButton, UIInput } from '@/components/ui/primitives';

interface TOTPStatus {
  enabled: boolean;
  created_at?: string;
  backup_codes_remaining?: number;
}

interface TOTPSetupData {
  secret: string;
  qr_code: string;
  issuer: string;
}

export default function TOTPSetupPage() {
  const router = useRouter();

  const [status, setStatus] = useState<TOTPStatus | null>(null);
  const [setupData, setSetupData] = useState<TOTPSetupData | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [showDisableModal, setShowDisableModal] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const response = await totpApi.getStatus();
      setStatus(response.data);
    } catch (err) {
      console.error('Failed to load TOTP status', err);
    } finally {
      setLoading(false);
    }
  };

  const handleStartSetup = async () => {
    setError('');
    setLoading(true);

    try {
      const response = await totpApi.setup();
      setSetupData(response.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || '开始设置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifySetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode || verificationCode.length !== 6) {
      setError('请输入 6 位验证码');
      return;
    }

    setError('');
    setVerifying(true);

    try {
      const response = await totpApi.verifySetup(verificationCode);
      setBackupCodes(response.data.backup_codes);
      setShowBackupCodes(true);
      setSetupData(null);
      setSuccess('身份验证器已成功启用！');

      // Refresh status
      const statusResponse = await totpApi.getStatus();
      setStatus(statusResponse.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || '验证码错误');
    } finally {
      setVerifying(false);
    }
  };

  const handleDisable = async () => {
    if (!password) {
      setError('请输入密码');
      return;
    }

    setError('');
    setDisabling(true);

    try {
      await totpApi.disable(password);
      setSuccess('身份验证器已禁用');
      setShowDisableModal(false);
      setPassword('');

      // Refresh status
      const statusResponse = await totpApi.getStatus();
      setStatus(statusResponse.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || '禁用失败');
    } finally {
      setDisabling(false);
    }
  };

  const handleRegenerateBackupCodes = async () => {
    if (!password) {
      setError('请输入密码');
      return;
    }

    setError('');
    setRegenerating(true);

    try {
      const response = await totpApi.regenerateBackupCodes(password);
      setBackupCodes(response.data.backup_codes);
      setShowBackupCodes(true);
      setShowRegenerateModal(false);
      setPassword('');
      setSuccess('备用码已重新生成');

      // Refresh status
      const statusResponse = await totpApi.getStatus();
      setStatus(statusResponse.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || '生成失败');
    } finally {
      setRegenerating(false);
    }
  };

  const copyBackupCodes = () => {
    const text = backupCodes.join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadBackupCodes = () => {
    const text = `LAAA 身份验证器备用码\n${'='.repeat(30)}\n\n${backupCodes.join('\n')}\n\n请妥善保管这些备用码。每个备用码只能使用一次。`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'laaa-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="px-4 sm:px-0 animate-fade-in">
        <div className="text-center py-12">加载中...</div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0 animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/security"
          className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">身份验证器</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            使用 Google Authenticator 或其他 TOTP 应用增强账户安全
          </p>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg dark:bg-red-950 dark:border-red-900 dark:text-red-200">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg dark:bg-green-950 dark:border-green-900 dark:text-green-200">
          {success}
        </div>
      )}

      {/* Backup Codes Display */}
      {showBackupCodes && backupCodes.length > 0 && (
        <div className="surface p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-10 h-10 bg-yellow-100 dark:bg-yellow-900 rounded-full flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                保存您的备用码
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                如果您无法访问身份验证器应用，可以使用这些备用码登录。每个备用码只能使用一次。
              </p>
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-2 gap-2">
              {backupCodes.map((code, i) => (
                <div key={i} className="font-mono text-sm text-center py-1 bg-white dark:bg-gray-700 rounded">
                  {code}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <UIButton onPress={copyBackupCodes} className="text-sm" variant="secondary" >{copied ? '已复制' : '复制备用码'}</UIButton>
            <UIButton onPress={downloadBackupCodes} className="text-sm" variant="secondary" >
              下载备用码
            </UIButton>
            <UIButton onPress={() => {
              setShowBackupCodes(false);
              setBackupCodes([]);
            }} className="text-sm" variant="primary" >
              我已保存
            </UIButton>
          </div>
        </div>
      )}

      {/* Status Card */}
      <div className="surface p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              status?.enabled
                ? 'bg-green-100 dark:bg-green-900'
                : 'bg-gray-100 dark:bg-gray-800'
            }`}>
              <svg className={`w-5 h-5 ${
                status?.enabled
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-gray-400 dark:text-gray-500'
              }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {status?.enabled ? '已启用' : '未启用'}
              </h3>
              {status?.enabled && status.created_at && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  启用于 {formatDate(status.created_at)}
                </p>
              )}
            </div>
          </div>

          {status?.enabled && (
            <div className="text-right">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                剩余备用码: <span className="font-medium">{status.backup_codes_remaining || 0}</span>
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        {status?.enabled ? (
          <div className="flex flex-wrap gap-2">
            <UIButton onPress={() => setShowRegenerateModal(true)} className="text-sm" variant="secondary" >
              重新生成备用码
            </UIButton>
            <UIButton onPress={() => setShowDisableModal(true)} className="text-sm" variant="danger" >
              禁用身份验证器
            </UIButton>
          </div>
        ) : !setupData && (
          <UIButton onPress={handleStartSetup} variant="primary" >
            开始设置
          </UIButton>
        )}
      </div>

      {/* Setup Flow */}
      {setupData && (
        <div className="surface p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            设置身份验证器
          </h3>

          {/* Step 1: Scan QR */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-sm flex items-center justify-center">
                1
              </span>
              <h4 className="font-medium text-gray-900 dark:text-gray-100">
                扫描二维码
              </h4>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 ml-8">
              使用 Google Authenticator、Microsoft Authenticator 或其他 TOTP 应用扫描下方二维码
            </p>

            <div className="flex justify-center mb-4">
              <div className="bg-white p-4 rounded-lg inline-block">
                <img
                  src={`data:image/png;base64,${setupData.qr_code}`}
                  alt="TOTP QR Code"
                  className="w-48 h-48"
                />
              </div>
            </div>

            <div className="text-center">
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                无法扫描？手动输入以下密钥：
              </p>
              <code className="inline-block px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded font-mono text-sm select-all">
                {setupData.secret}
              </code>
            </div>
          </div>

          {/* Step 2: Verify */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-sm flex items-center justify-center">
                2
              </span>
              <h4 className="font-medium text-gray-900 dark:text-gray-100">
                输入验证码
              </h4>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 ml-8">
              输入应用中显示的 6 位验证码以完成设置
            </p>

            <form onSubmit={handleVerifySetup} className="ml-8">
              <div className="flex gap-3 items-end max-w-xs">
                <UIInput
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="flex-1 text-center text-xl tracking-widest font-mono"
                  maxLength={6}
                />
                <UIButton type="submit" isDisabled={verifying || verificationCode.length !== 6} variant="primary" isPending={verifying}>{verifying ? '验证中...' : '验证'}</UIButton>
              </div>
            </form>
          </div>
        </div>
      )}

      <AlertDialog>
        <AlertDialog.Backdrop isOpen={showDisableModal} onOpenChange={setShowDisableModal}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>禁用身份验证器</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  禁用后，您将无法使用身份验证器进行二次验证。请输入密码确认。
                </p>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded mb-4 text-sm dark:bg-red-950 dark:border-red-900 dark:text-red-200">
                    {error}
                  </div>
                )}

                <UIInput
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full"
                />
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <UIButton onPress={() => {
                  setShowDisableModal(false);
                  setPassword('');
                  setError('');
                }} variant="secondary" >
                  取消
                </UIButton>
                <UIButton onPress={handleDisable} isDisabled={disabling || !password} variant="danger" isPending={disabling}>{disabling ? '禁用中...' : '确认禁用'}</UIButton>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog>
        <AlertDialog.Backdrop isOpen={showRegenerateModal} onOpenChange={setShowRegenerateModal}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>重新生成备用码</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  重新生成后，旧的备用码将失效。请输入密码确认。
                </p>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded mb-4 text-sm dark:bg-red-950 dark:border-red-900 dark:text-red-200">
                    {error}
                  </div>
                )}

                <UIInput
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full"
                />
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <UIButton onPress={() => {
                  setShowRegenerateModal(false);
                  setPassword('');
                  setError('');
                }} variant="secondary" >
                  取消
                </UIButton>
                <UIButton onPress={handleRegenerateBackupCodes} isDisabled={regenerating || !password} variant="primary" isPending={regenerating}>{regenerating ? '生成中...' : '重新生成'}</UIButton>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      {/* Info */}
      <div className="surface p-6">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">
          什么是身份验证器？
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          身份验证器是一种基于时间的一次性密码 (TOTP) 应用，可以在您的手机上生成 6 位验证码。
          启用后，当检测到可疑登录时，除了密码外还需要输入验证码才能登录，大大提高了账户安全性。
        </p>

        <h4 className="font-medium text-gray-900 dark:text-gray-100 mb-2">
          推荐的应用：
        </h4>
        <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
          <li>• Google Authenticator (iOS / Android)</li>
          <li>• Microsoft Authenticator (iOS / Android)</li>
          <li>• Authy (iOS / Android / Desktop)</li>
          <li>• 1Password (iOS / Android / Desktop)</li>
        </ul>
      </div>
    </div>
  );
}
