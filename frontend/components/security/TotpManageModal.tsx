'use client';

import { useEffect, useState } from 'react';
import { AlertDialog, toast } from '@heroui/react';
import { UIButton, UIInput } from '@/components/ui/primitives';
import { totpApi } from '@/lib/api';
import type { AxiosError } from 'axios';

interface TotpStatus {
  enabled: boolean;
  created_at?: string;
  backup_codes_remaining?: number;
}

interface TotpSetupData {
  secret: string;
  qr_code: string;
  issuer: string;
}

interface ApiErrorData {
  detail?: string;
}

interface TotpManageModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onStatusUpdated: (status: TotpStatus) => void;
}

export function TotpManageModal({ isOpen, onOpenChange, onStatusUpdated }: TotpManageModalProps) {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [setupData, setSetupData] = useState<TotpSetupData | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [showRegenerateModal, setShowRegenerateModal] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setPassword('');
    setVerificationCode('');
    void loadStatus();
  }, [isOpen]);

  const getErrorMessage = (err: unknown, fallback: string) => {
    const error = err as AxiosError<ApiErrorData>;
    return error.response?.data?.detail || error.message || fallback;
  };

  const loadStatus = async () => {
    try {
      const response = await totpApi.getStatus();
      setStatus(response.data);
      onStatusUpdated(response.data);
    } catch (err) {
      const message = getErrorMessage(err, '加载状态失败');
      toast(message);
    }
  };

  const handleStartSetup = async () => {
    try {
      const response = await totpApi.setup();
      setSetupData(response.data);
      toast('请使用身份验证器扫描二维码并完成验证');
    } catch (err) {
      const message = getErrorMessage(err, '开始设置失败');
      toast(message);
    }
  };

  const handleVerifySetup = async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      toast('请输入 6 位验证码');
      return;
    }

    setVerifying(true);
    try {
      const response = await totpApi.verifySetup(verificationCode);
      setBackupCodes(response.data.backup_codes);
      setShowBackupCodes(true);
      setSetupData(null);
      toast('身份验证器已成功启用');
      setVerificationCode('');
      await loadStatus();
    } catch (err) {
      const message = getErrorMessage(err, '验证码错误');
      toast(message);
    } finally {
      setVerifying(false);
    }
  };

  const handleDisable = async () => {
    if (!password) {
      toast('请输入密码');
      return;
    }

    setDisabling(true);
    try {
      await totpApi.disable(password);
      toast('身份验证器已禁用');
      setShowDisableModal(false);
      setPassword('');
      await loadStatus();
    } catch (err) {
      const message = getErrorMessage(err, '禁用失败');
      toast(message);
    } finally {
      setDisabling(false);
    }
  };

  const handleRegenerateBackupCodes = async () => {
    if (!password) {
      toast('请输入密码');
      return;
    }

    setRegenerating(true);
    try {
      const response = await totpApi.regenerateBackupCodes(password);
      setBackupCodes(response.data.backup_codes);
      setShowBackupCodes(true);
      setShowRegenerateModal(false);
      setPassword('');
      toast('备用码已重新生成');
      await loadStatus();
    } catch (err) {
      const message = getErrorMessage(err, '生成失败');
      toast(message);
    } finally {
      setRegenerating(false);
    }
  };

  const copyBackupCodes = async () => {
    await navigator.clipboard.writeText(backupCodes.join('\n'));
    setCopied(true);
    toast('备用码已复制');
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
    toast('备用码文件已下载');
  };

  return (
    <>
      <AlertDialog>
        <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>身份验证器管理</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <div className="space-y-4">
                  {showBackupCodes && backupCodes.length > 0 && (
                    <div className="border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 space-y-3">
                      <div className="text-sm text-gray-700 dark:text-gray-300">请保存备用码（每个仅能使用一次）</div>
                      <div className="grid grid-cols-2 gap-2">
                        {backupCodes.map((code, i) => (
                          <div key={i} className="font-mono text-sm text-center py-1 bg-gray-50 dark:bg-gray-800 rounded">
                            {code}
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <UIButton onPress={() => void copyBackupCodes()} variant="secondary" className="text-sm">{copied ? '已复制' : '复制备用码'}</UIButton>
                        <UIButton onPress={downloadBackupCodes} variant="secondary" className="text-sm">下载备用码</UIButton>
                        <UIButton onPress={() => { setShowBackupCodes(false); setBackupCodes([]); }} variant="primary" className="text-sm">我已保存</UIButton>
                      </div>
                    </div>
                  )}

                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <div>
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{status?.enabled ? '已启用' : '未启用'}</div>
                        {status?.enabled && (
                          <div className="text-sm text-gray-500 dark:text-gray-400">剩余备用码：{status.backup_codes_remaining || 0}</div>
                        )}
                      </div>
                      {status?.enabled ? (
                        <div className="flex gap-2">
                          <UIButton onPress={() => setShowRegenerateModal(true)} variant="secondary" className="text-sm">重新生成备用码</UIButton>
                          <UIButton onPress={() => setShowDisableModal(true)} variant="danger" className="text-sm">禁用</UIButton>
                        </div>
                      ) : (
                        <UIButton onPress={() => void handleStartSetup()} variant="primary" className="text-sm">开始设置</UIButton>
                      )}
                    </div>

                    {setupData && (
                      <div className="space-y-3">
                        <div className="text-sm text-gray-600 dark:text-gray-400">扫描二维码或手动输入密钥后，填写 6 位验证码完成设置。</div>
                        <div className="flex justify-center">
                          <div className="bg-white p-3 rounded-lg inline-block">
                            <img src={`data:image/png;base64,${setupData.qr_code}`} alt="TOTP QR Code" className="w-40 h-40" />
                          </div>
                        </div>
                        <code className="block px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded font-mono text-sm text-center select-all">{setupData.secret}</code>
                        <div className="flex gap-2 items-end">
                          <UIInput
                            type="text"
                            value={verificationCode}
                            onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            placeholder="000000"
                            className="flex-1 text-center text-xl tracking-widest font-mono"
                            maxLength={6}
                          />
                          <UIButton onPress={() => void handleVerifySetup()} isDisabled={verifying || verificationCode.length !== 6} variant="primary" isPending={verifying}>
                            {verifying ? '验证中...' : '验证'}
                          </UIButton>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <UIButton onPress={() => onOpenChange(false)} variant="ghost">关闭</UIButton>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog>
        <AlertDialog.Backdrop isOpen={showDisableModal} onOpenChange={setShowDisableModal}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>禁用身份验证器</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">请输入密码确认禁用。</p>
                <UIInput
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full"
                />
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <UIButton onPress={() => { setShowDisableModal(false); setPassword(''); }} variant="secondary">取消</UIButton>
                <UIButton onPress={() => void handleDisable()} isDisabled={disabling || !password} variant="danger" isPending={disabling}>
                  {disabling ? '禁用中...' : '确认禁用'}
                </UIButton>
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
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">请输入密码确认重新生成。</p>
                <UIInput
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  className="w-full"
                />
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <UIButton onPress={() => { setShowRegenerateModal(false); setPassword(''); }} variant="secondary">取消</UIButton>
                <UIButton onPress={() => void handleRegenerateBackupCodes()} isDisabled={regenerating || !password} variant="primary" isPending={regenerating}>
                  {regenerating ? '生成中...' : '重新生成'}
                </UIButton>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </>
  );
}
