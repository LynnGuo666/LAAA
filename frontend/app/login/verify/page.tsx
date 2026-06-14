'use client';

import { useState, useEffect } from 'react';
import { Alert, Button, Card, Chip, Input, InputOTP, ProgressBar, toast } from '@heroui/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { verificationApi, authApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { Mail, ShieldCheck, KeyRound, ChevronRight, ArrowLeft, Check } from 'lucide-react';
import {
  isWebAuthnSupported,
  parseAuthenticationOptions,
  getPasskeyCredential,
  serializeAuthenticationCredential,
} from '@/lib/webauthn';
import { PageLoadingState } from '@/components/ui/loading';

interface VerificationMethod { method: string; strength: string; available: boolean }
interface Anomaly { type: string; score: number; message: string }
interface VerificationSession {
  requires_verification: boolean; session_token: string; risk_level: string; risk_score: number;
  required_verifications: number; completed_verifications: number; email_masked: string;
  available_methods: VerificationMethod[]; anomalies: Anomaly[]; redirect: string;
}

type VerificationStep = 'select' | 'email_code' | 'totp' | 'passkey' | 'backup_code';

const METHOD_NAMES: Record<string, string> = { email_code: '邮件验证码', totp: '身份验证器', passkey: '通行密钥' };
const ALL_METHODS: Array<'email_code' | 'totp' | 'passkey'> = ['email_code', 'totp', 'passkey'];
const METHOD_META: Record<string, { icon: React.ReactNode; desc: string; color: string }> = {
  email_code: { icon: <Mail className="w-5 h-5" />, desc: '发送验证码到您的邮箱', color: 'bg-primary/10 text-primary' },
  totp: { icon: <ShieldCheck className="w-5 h-5" />, desc: '使用身份验证器应用', color: 'bg-success/10 text-success' },
  passkey: { icon: <KeyRound className="w-5 h-5" />, desc: '使用指纹、面容或安全密钥', color: 'bg-warning/10 text-warning' },
};

export default function VerifyPage() {
  const router = useRouter();
  const confirmDialog = useConfirmDialog();
  const setAuth = useAuthStore((state) => state.setAuth);

  const [session, setSession] = useState<VerificationSession | null>(null);
  const [step, setStep] = useState<VerificationStep>('select');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [totpCode, setTotpCode] = useState('');
  const [showBackupCode, setShowBackupCode] = useState(false);
  const [backupCode, setBackupCode] = useState('');
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const [completedMethods, setCompletedMethods] = useState<string[]>([]);
  const [skipping, setSkipping] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem('verification_session');
    if (!stored) { router.push('/login'); return; }
    try {
      const data = JSON.parse(stored) as VerificationSession;
      setSession(data);
      if (data.completed_verifications >= data.required_verifications) router.push(data.redirect || '/dashboard');
    } catch { router.push('/login'); }
    setWebAuthnSupported(isWebAuthnSupported());
  }, [router]);

  useEffect(() => {
    if (emailCooldown > 0) { const t = setTimeout(() => setEmailCooldown(emailCooldown - 1), 1000); return () => clearTimeout(t); }
  }, [emailCooldown]);

  const verify = async (fn: () => Promise<any>, method: string) => {
    setLoading(true); setError('');
    try {
      const res = await fn();
      if (res.data.verification_complete && res.data.access_token) {
        localStorage.setItem('access_token', res.data.access_token);
        localStorage.setItem('refresh_token', res.data.refresh_token);
        document.cookie = `session_token=${res.data.access_token}; path=/; max-age=${60*60*24*7}; SameSite=Lax`;
        const userRes = await authApi.getMe(res.data.access_token);
        setAuth(userRes.data, res.data.access_token, res.data.refresh_token);
        sessionStorage.removeItem('verification_session');
        router.push(session?.redirect || '/dashboard');
      } else {
        setCompletedMethods([...completedMethods, method]);
        const updated = { ...session!, completed_verifications: res.data.completed_verifications, completed_methods: res.data.completed_methods, available_methods: res.data.remaining_methods || session!.available_methods.filter(m => m.method !== method) };
        setSession(updated); sessionStorage.setItem('verification_session', JSON.stringify(updated));
        setStep('select'); setSuccess(`${METHOD_NAMES[method]} 验证成功，请继续完成下一步验证`);
        setEmailCode(''); setTotpCode(''); setBackupCode(''); setEmailCodeSent(false);
      }
    } catch (err: any) { setError(err.response?.data?.detail || '验证失败'); } finally { setLoading(false); }
  };

  const handleSendEmailCode = async () => {
    if (!session) return; setLoading(true); setError('');
    try { await verificationApi.sendEmailCode(session.session_token); setEmailCodeSent(true); setEmailCooldown(60); setSuccess('验证码已发送到您的邮箱'); }
    catch (err: any) { setError(err.response?.data?.detail || '发送失败'); }
    finally { setLoading(false); }
  };

  const handleSkip = async () => {
    if (!session) return;
    if (!(await confirmDialog({ title: '确认跳过验证', description: '跳过验证后，您需要先完成邮箱验证和设置二次验证方式才能正常使用系统。', confirmText: '继续跳过', cancelText: '取消', status: 'warning', confirmVariant: 'primary' }))) return;
    setSkipping(true); setError('');
    try {
      const res = await verificationApi.skipVerification(session.session_token);
      const { access_token, refresh_token } = res.data;
      localStorage.setItem('access_token', access_token); localStorage.setItem('refresh_token', refresh_token);
      document.cookie = `session_token=${access_token}; path=/; max-age=${60*60*24*7}; SameSite=Lax`;
      const userRes = await authApi.getMe(access_token);
      setAuth(userRes.data, access_token, refresh_token);
      sessionStorage.removeItem('verification_session');
      router.push(session.redirect || '/dashboard');
    } catch (err: any) { setError(err.response?.data?.detail || '跳过失败'); } finally { setSkipping(false); }
  };

  if (!session) return <PageLoadingState />;

  const remaining = session.required_verifications - session.completed_verifications;
  const availableMethods = session.available_methods.filter(m => m.available && !completedMethods.includes(m.method));
  const methodMap = new Map(session.available_methods.map(m => [m.method, m]));

  const renderStep = () => {
    if (step === 'email_code') return (
      <div className="space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-3 w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center"><Mail className="w-6 h-6 text-primary" /></div>
          <h2 className="text-lg font-semibold text-foreground">邮件验证码</h2>
          <p className="text-sm text-default-500 mt-1">验证码将发送到 <strong>{session.email_masked}</strong></p>
        </div>
        {!emailCodeSent ? (
          <Button onPress={handleSendEmailCode} isDisabled={loading} variant="primary" className="w-full" isPending={loading}>发送验证码</Button>
        ) : (
          <>
            <Input type="text" value={emailCode} onChange={e => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="输入6位验证码" className="text-center tracking-widest" maxLength={6} />
            <Button onPress={() => verify(() => verificationApi.verifyEmailCode(session.session_token, emailCode), 'email_code')} isDisabled={loading || emailCode.length !== 6} variant="primary" className="w-full" isPending={loading}>验证</Button>
            <Button onPress={handleSendEmailCode} isDisabled={loading || emailCooldown > 0} variant="ghost" className="w-full text-sm">{emailCooldown > 0 ? `重新发送 (${emailCooldown}s)` : '重新发送'}</Button>
          </>
        )}
        <Button onPress={() => setStep('select')} variant="secondary" className="w-full"><ArrowLeft className="w-4 h-4" /> 选择其他方式</Button>
      </div>
    );

    if (step === 'totp') return (
      <div className="space-y-4">
        {!showBackupCode ? (
          <>
            <div className="text-center">
              <div className="mx-auto mb-3 w-12 h-12 bg-success/10 rounded-xl flex items-center justify-center"><ShieldCheck className="w-6 h-6 text-success" /></div>
              <h2 className="text-lg font-semibold text-foreground">身份验证器</h2>
              <p className="text-sm text-default-500 mt-1">输入验证器应用中的6位验证码</p>
            </div>
            <div className="flex justify-center py-2">
              <InputOTP value={totpCode} onChange={v => setTotpCode(v.replace(/\D/g, '').slice(0, 6))} maxLength={6} inputMode="numeric">
                <InputOTP.Group><InputOTP.Slot index={0} /><InputOTP.Slot index={1} /><InputOTP.Slot index={2} /><InputOTP.Slot index={3} /><InputOTP.Slot index={4} /><InputOTP.Slot index={5} /></InputOTP.Group>
              </InputOTP>
            </div>
            <Button onPress={() => verify(() => verificationApi.verifyTOTP(session.session_token, totpCode), 'totp')} isDisabled={loading || totpCode.length !== 6} variant="primary" className="w-full" isPending={loading}>验证</Button>
            <Button onPress={() => setShowBackupCode(true)} variant="ghost" className="w-full text-sm">使用备用码</Button>
          </>
        ) : (
          <>
            <div className="text-center">
              <h2 className="text-lg font-semibold text-foreground">备用码</h2>
              <p className="text-sm text-default-500 mt-1">输入8位备用码</p>
            </div>
            <Input type="text" value={backupCode} onChange={e => setBackupCode(e.target.value.toUpperCase().slice(0, 8))} placeholder="XXXXXXXX" className="text-center tracking-widest" maxLength={8} />
            <Button onPress={() => verify(() => verificationApi.verifyBackupCode(session.session_token, backupCode), 'totp')} isDisabled={loading || backupCode.length !== 8} variant="primary" className="w-full" isPending={loading}>验证</Button>
            <Button onPress={() => setShowBackupCode(false)} variant="ghost" className="w-full text-sm">使用身份验证器</Button>
          </>
        )}
        <Button onPress={() => setStep('select')} variant="secondary" className="w-full"><ArrowLeft className="w-4 h-4" /> 选择其他方式</Button>
      </div>
    );

    if (step === 'passkey') return (
      <div className="space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-3 w-12 h-12 bg-warning/10 rounded-xl flex items-center justify-center"><KeyRound className="w-6 h-6 text-warning" /></div>
          <h2 className="text-lg font-semibold text-foreground">通行密钥</h2>
          <p className="text-sm text-default-500 mt-1">使用已注册的通行密钥验证身份</p>
        </div>
        <Button onPress={() => verify(async () => {
          const opts = await verificationApi.startPasskeyVerification(session.session_token);
          const cred = await getPasskeyCredential(parseAuthenticationOptions(opts.data.options));
          return verificationApi.completePasskeyVerification(session.session_token, serializeAuthenticationCredential(cred));
        }, 'passkey')} isDisabled={loading || !webAuthnSupported} variant="primary" className="w-full" isPending={loading}>使用通行密钥验证</Button>
        <Button onPress={() => setStep('select')} variant="secondary" className="w-full"><ArrowLeft className="w-4 h-4" /> 选择其他方式</Button>
      </div>
    );

    return (
      <div className="space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-3 w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center"><ShieldCheck className="w-6 h-6 text-primary" /></div>
          <h2 className="text-lg font-semibold text-foreground">安全验证</h2>
          <p className="text-sm text-default-500 mt-1">还需完成 <strong className="text-foreground">{remaining}</strong> 次验证</p>
        </div>

        {session.anomalies.length > 0 && (
          <Alert status={session.risk_level === 'high' ? 'danger' : session.risk_level === 'medium' ? 'warning' : 'accent'}>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                <ul className="space-y-0.5">{session.anomalies.map((a, i) => <li key={i}>{a.message}</li>)}</ul>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        <div className="space-y-2">
          {ALL_METHODS.map(key => {
            const method = methodMap.get(key);
            const done = completedMethods.includes(key);
            const disabled = !method?.available || done;
            const meta = METHOD_META[key];
            return (
              <div
                key={key}
                role={disabled ? undefined : 'button'}
                tabIndex={disabled ? -1 : 0}
                onClick={() => !disabled && (setStep(key as VerificationStep), setError(''), setSuccess(''))}
                className={`flex items-center gap-4 rounded-xl border border-default-200/70 px-4 py-3 transition-all ${done ? 'opacity-60 bg-default-50' : disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-primary/50 hover:bg-primary/5'}`}
              >
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${meta.color}`}>{meta.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-foreground">{METHOD_NAMES[key]}</p>
                  <p className="text-xs text-default-500">{meta.desc}</p>
                </div>
                {done ? <Chip color="success" variant="soft" size="sm">已完成</Chip> : !disabled ? <ChevronRight className="w-4 h-4 text-default-400 shrink-0" /> : null}
              </div>
            );
          })}
        </div>

        {availableMethods.length === 0 && <p className="text-center text-sm text-default-500">没有可用的验证方式</p>}

        <div className="pt-1">
          <ProgressBar value={(session.completed_verifications / session.required_verifications) * 100} color="accent" className="mb-3" />
          <Button onPress={handleSkip} isDisabled={skipping} variant="ghost" size="sm" className="w-full text-default-400">{skipping ? '处理中...' : '跳过验证，进入受限模式'}</Button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full surface p-6 sm:p-8 animate-fade-in">
        {error && <Alert status="danger" className="mb-4"><Alert.Indicator /><Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content></Alert>}
        {success && <Alert status="success" className="mb-4"><Alert.Indicator /><Alert.Content><Alert.Description>{success}</Alert.Description></Alert.Content></Alert>}
        {renderStep()}
        <div className="mt-6 text-center">
          <Link href="/login" className="text-xs text-default-400 hover:text-default-600">返回登录</Link>
        </div>
      </div>
    </div>
  );
}
