'use client';

import { useEffect, useState } from 'react';
import { AlertDialog, Button, Input, toast } from '@heroui/react';
import { totpApi } from '@/lib/api';
import { extractErrorMessage } from '@/lib/errors';

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

interface TotpManageModalProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onStatusUpdated: (status: TotpStatus) => void;
}

type TotpView = 'main' | 'setup' | 'disable' | 'regenerate';

export function TotpManageModal({ isOpen, onOpenChange, onStatusUpdated }: TotpManageModalProps) {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [setupData, setSetupData] = useState<TotpSetupData | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showBackupCodes, setShowBackupCodes] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [startingSetup, setStartingSetup] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<TotpView>('main');

  useEffect(() => {
    if (!isOpen) return;
    setPassword('');
    setVerificationCode('');
    setView('main');
    void loadStatus();
  }, [isOpen]);

  const getErrorMessage = (err: unknown, fallback: string) => {
    // 兼容 422 数组形态 detail 等结构，统一走共享工具（lib/errors.ts）
    return extractErrorMessage(err, fallback);
  };

  const loadStatus = async () => {
    try {
      const response = await totpApi.getStatus();
      setStatus(response.data);
      onStatusUpdated(response.data);
    } catch (err) {
      toast(getErrorMessage(err, '加载状态失败'));
    }
  };

  const handleStartSetup = async () => {
    if (!password) {
      toast('请输入密码');
      return;
    }

    setStartingSetup(true);
    try {
      // 密码确认:防止会话劫持(偷 cookie/XSS)植入攻击者控制的 TOTP 后门
      const response = await totpApi.setup(password);
      setSetupData(response.data);
      setView('main');
      toast('请使用身份验证器扫描二维码并完成验证');
    } catch (err) {
      toast(getErrorMessage(err, '开始设置失败'));
    } finally {
      setStartingSetup(false);
    }
  };

  const handleVerifySetup = async () => {
    if (!verificationCode || verificationCode.length !== 6) {
      toast('请输入 6 位验证码');
      return;
    }
    if (!password) {
      toast('请输入密码');
      return;
    }

    setVerifying(true);
    try {
      const response = await totpApi.verifySetup(verificationCode, password);
      setBackupCodes(response.data.backup_codes);
      setShowBackupCodes(true);
      setSetupData(null);
      toast('身份验证器已成功启用');
      setVerificationCode('');
      setPassword('');
      await loadStatus();
    } catch (err) {
      toast(getErrorMessage(err, '验证码错误'));
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
      setPassword('');
      setView('main');
      await loadStatus();
    } catch (err) {
      toast(getErrorMessage(err, '禁用失败'));
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
      setPassword('');
      setView('main');
      toast('备用码已重新生成');
      await loadStatus();
    } catch (err) {
      toast(getErrorMessage(err, '生成失败'));
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

  const renderMainView = () => (
    <div className="space-y-4">
      {showBackupCodes && backupCodes.length > 0 && (
        <div className="border border-warning/40 rounded-lg p-4 space-y-3">
          <div className="text-sm text-muted">请保存备用码（每个仅能使用一次）</div>
          <div className="grid grid-cols-2 gap-2">
            {backupCodes.map((code, i) => (
              <div key={i} className="font-mono text-sm text-center py-1 bg-default rounded">
                {code}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onPress={() => void copyBackupCodes()} variant="secondary" className="text-sm">{copied ? '已复制' : '复制备用码'}</Button>
            <Button onPress={downloadBackupCodes} variant="secondary" className="text-sm">下载备用码</Button>
            <Button onPress={() => { setShowBackupCodes(false); setBackupCodes([]); }} variant="primary" className="text-sm">我已保存</Button>
          </div>
        </div>
      )}

      <div className="border border-border rounded-lg p-4">
        <div className="flex items-center justify-between gap-4 mb-3">
          <div>
            <div className="font-semibold text-foreground">{status?.enabled ? '已启用' : '未启用'}</div>
            {status?.enabled && (
              <div className="text-sm text-muted">剩余备用码：{status.backup_codes_remaining || 0}</div>
            )}
          </div>
          {status?.enabled ? (
            <div className="flex gap-2">
              <Button onPress={() => setView('regenerate')} variant="secondary" className="text-sm">重新生成备用码</Button>
              <Button onPress={() => setView('disable')} variant="danger" className="text-sm">禁用</Button>
            </div>
          ) : (
            <Button onPress={() => { setPassword(''); setView('setup'); }} variant="primary" className="text-sm">开始设置</Button>
          )}
        </div>

        {setupData && (
          <div className="space-y-3">
            <div className="text-sm text-muted">扫描二维码或手动输入密钥后，填写 6 位验证码完成设置。</div>
            <div className="flex justify-center">
              <div className="bg-background p-3 rounded-lg inline-block">
                <img src={`data:image/png;base64,${setupData.qr_code}`} alt="TOTP QR Code" className="w-40 h-40" />
              </div>
            </div>
            <code className="block px-3 py-2 bg-default rounded font-mono text-sm text-center select-all">{setupData.secret}</code>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码确认（完成绑定需验证）"
              className="w-full"
            />
            <div className="flex gap-2 items-end">
              <Input
                type="text"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="flex-1 text-center text-xl tracking-widest font-mono"
                maxLength={6}
              />
              <Button onPress={() => void handleVerifySetup()} isDisabled={verifying || verificationCode.length !== 6 || !password} variant="primary" isPending={verifying}>
                {verifying ? '验证中...' : '验证'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderSetupPasswordView = () => (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold text-foreground">开始设置身份验证器</h4>
        <p className="text-sm text-muted mt-1">
          绑定身份验证器需要输入密码确认，以防会话被劫持时被他人植入后门。
        </p>
      </div>
      <Input
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="请输入密码"
        className="w-full"
        autoFocus
      />
      <div className="flex justify-between gap-2">
        <Button onPress={() => { setView('main'); setPassword(''); }} variant="ghost">返回</Button>
        <Button onPress={() => void handleStartSetup()} isDisabled={startingSetup || !password} variant="primary" isPending={startingSetup}>
          {startingSetup ? '验证中...' : '确认并生成二维码'}
        </Button>
      </div>
    </div>
  );

  const renderPasswordView = (title: string, actionLabel: string, pending: boolean, onConfirm: () => Promise<void>) => (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold text-foreground">{title}</h4>
        <p className="text-sm text-muted mt-1">请输入密码确认操作。</p>
      </div>
      <Input
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="请输入密码"
        className="w-full"
      />
      <div className="flex justify-between gap-2">
        <Button onPress={() => { setView('main'); setPassword(''); }} variant="ghost">返回</Button>
        <Button onPress={() => void onConfirm()} isDisabled={pending || !password} variant={view === 'disable' ? 'danger' : 'primary'} isPending={pending}>
          {pending ? '处理中...' : actionLabel}
        </Button>
      </div>
    </div>
  );

  return (
    <AlertDialog>
      <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {view === 'main' ? '身份验证器管理'
                  : view === 'setup' ? '开始设置身份验证器'
                  : view === 'disable' ? '禁用身份验证器' : '重新生成备用码'}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              {view === 'main' && renderMainView()}
              {view === 'setup' && renderSetupPasswordView()}
              {view === 'disable' && renderPasswordView('禁用身份验证器', '确认禁用', disabling, handleDisable)}
              {view === 'regenerate' && renderPasswordView('重新生成备用码', '重新生成', regenerating, handleRegenerateBackupCodes)}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button onPress={() => onOpenChange(false)} variant="ghost">关闭</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}
