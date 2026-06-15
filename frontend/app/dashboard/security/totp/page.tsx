'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, AlertDialog, Button, Input, Spinner } from '@heroui/react';
import { ChevronLeft, AlertTriangle, ShieldCheck } from 'lucide-react';
import { totpApi } from '@/lib/api';
import { formatDate } from '@/lib/date';

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
        <div className="flex items-center justify-center py-12"><Spinner size="lg" /></div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-0 animate-fade-in space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/security"
          className="text-default-500 hover:text-default-600"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">身份验证器</h1>
          <p className="text-default-600 mt-1">
            使用 Google Authenticator 或其他 TOTP 应用增强账户安全
          </p>
        </div>
      </div>

      {error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content>
        </Alert>
      )}
      {success && (
        <Alert status="success">
          <Alert.Indicator />
          <Alert.Content><Alert.Description>{success}</Alert.Description></Alert.Content>
        </Alert>
      )}

      {showBackupCodes && backupCodes.length > 0 && (
        <div className="surface p-6">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-10 h-10 bg-warning/10 rounded-full flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-warning" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                保存您的备用码
              </h3>
              <p className="text-sm text-default-600 mt-1">
                如果您无法访问身份验证器应用，可以使用这些备用码登录。每个备用码只能使用一次。
              </p>
            </div>
          </div>

          <div className="bg-default-100 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-2 gap-2">
              {backupCodes.map((code, i) => (
                <div key={i} className="font-mono text-sm text-center py-1 bg-background rounded">
                  {code}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onPress={copyBackupCodes} className="text-sm" variant="secondary">{copied ? '已复制' : '复制备用码'}</Button>
            <Button onPress={downloadBackupCodes} className="text-sm" variant="secondary">
              下载备用码
            </Button>
            <Button onPress={() => {
              setShowBackupCodes(false);
              setBackupCodes([]);
            }} className="text-sm" variant="primary">
              我已保存
            </Button>
          </div>
        </div>
      )}

      <div className="surface p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              status?.enabled
                ? 'bg-success/10'
                : 'bg-default-100'
            }`}>
              <ShieldCheck className={`w-5 h-5 ${
                status?.enabled
                  ? 'text-success'
                  : 'text-default-400'
              }`} />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">
                {status?.enabled ? '已启用' : '未启用'}
              </h3>
              {status?.enabled && status.created_at && (
                <p className="text-sm text-default-500">
                  启用于 {formatDate(status.created_at)}
                </p>
              )}
            </div>
          </div>

          {status?.enabled && (
            <div className="text-right">
              <p className="text-sm text-default-500">
                剩余备用码: <span className="font-medium">{status.backup_codes_remaining || 0}</span>
              </p>
            </div>
          )}
        </div>

        {status?.enabled ? (
          <div className="flex flex-wrap gap-2">
            <Button onPress={() => setShowRegenerateModal(true)} className="text-sm" variant="secondary">
              重新生成备用码
            </Button>
            <Button onPress={() => setShowDisableModal(true)} className="text-sm" variant="danger">
              禁用身份验证器
            </Button>
          </div>
        ) : !setupData && (
          <Button onPress={handleStartSetup} variant="primary">
            开始设置
          </Button>
        )}
      </div>

      {setupData && (
        <div className="surface p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">
            设置身份验证器
          </h3>

          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 rounded-full bg-primary text-white text-sm flex items-center justify-center">
                1
              </span>
              <h4 className="font-medium text-foreground">
                扫描二维码
              </h4>
            </div>
            <p className="text-sm text-default-600 mb-4 ml-8">
              使用 Google Authenticator、Microsoft Authenticator 或其他 TOTP 应用扫描下方二维码
            </p>

            <div className="flex justify-center mb-4">
              <div className="bg-background p-4 rounded-lg inline-block">
                <img
                  src={`data:image/png;base64,${setupData.qr_code}`}
                  alt="TOTP QR Code"
                  className="w-48 h-48"
                />
              </div>
            </div>

            <div className="text-center">
              <p className="text-sm text-default-500 mb-2">
                无法扫描？手动输入以下密钥：
              </p>
              <code className="inline-block px-3 py-2 bg-default-100 rounded font-mono text-sm select-all">
                {setupData.secret}
              </code>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-6 h-6 rounded-full bg-primary text-white text-sm flex items-center justify-center">
                2
              </span>
              <h4 className="font-medium text-foreground">
                输入验证码
              </h4>
            </div>
            <p className="text-sm text-default-600 mb-4 ml-8">
              输入应用中显示的 6 位验证码以完成设置
            </p>

            <form onSubmit={handleVerifySetup} className="ml-8">
              <div className="flex gap-3 items-end max-w-xs">
                <Input
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="flex-1 text-center text-xl tracking-widest font-mono"
                  maxLength={6}
                />
                <Button type="submit" isDisabled={verifying || verificationCode.length !== 6} variant="primary" isPending={verifying}>{verifying ? '验证中...' : '验证'}</Button>
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
                <p className="text-sm text-default-600 mb-4">
                  禁用后，您将无法使用身份验证器进行二次验证。请输入密码确认。
                </p>

                {error && (
                  <Alert status="danger" className="mb-4">
                    <Alert.Indicator />
                    <Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content>
                  </Alert>
                )}

                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full"
                />
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button onPress={() => {
                  setShowDisableModal(false);
                  setPassword('');
                  setError('');
                }} variant="secondary">
                  取消
                </Button>
                <Button onPress={handleDisable} isDisabled={disabling || !password} variant="danger" isPending={disabling}>{disabling ? '禁用中...' : '确认禁用'}</Button>
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
                <p className="text-sm text-default-600 mb-4">
                  重新生成后，旧的备用码将失效。请输入密码确认。
                </p>

                {error && (
                  <Alert status="danger" className="mb-4">
                    <Alert.Indicator />
                    <Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content>
                  </Alert>
                )}

                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full"
                />
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button onPress={() => {
                  setShowRegenerateModal(false);
                  setPassword('');
                  setError('');
                }} variant="secondary">
                  取消
                </Button>
                <Button onPress={handleRegenerateBackupCodes} isDisabled={regenerating || !password} variant="primary" isPending={regenerating}>{regenerating ? '生成中...' : '重新生成'}</Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <div className="surface p-6">
        <h3 className="font-semibold text-foreground mb-3">
          什么是身份验证器？
        </h3>
        <p className="text-sm text-default-600 mb-4">
          身份验证器是一种基于时间的一次性密码 (TOTP) 应用，可以在您的手机上生成 6 位验证码。
          启用后，当检测到可疑登录时，除了密码外还需要输入验证码才能登录，大大提高了账户安全性。
        </p>

        <h4 className="font-medium text-foreground mb-2">
          推荐的应用：
        </h4>
        <ul className="text-sm text-default-600 space-y-1">
          <li>• Google Authenticator (iOS / Android)</li>
          <li>• Microsoft Authenticator (iOS / Android)</li>
          <li>• Authy (iOS / Android / Desktop)</li>
          <li>• 1Password (iOS / Android / Desktop)</li>
        </ul>
      </div>
    </div>
  );
}
