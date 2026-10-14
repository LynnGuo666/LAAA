'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { extractErrorMessage } from '@/lib/errors';
import { PASSWORD_REQUIREMENT_HINT, validatePasswordStrength } from '@/lib/validation';
import { Alert, Button, Description, FieldError, Input, Label, Spinner, TextField } from '@heroui/react';

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [formData, setFormData] = useState({
    inviteCode: '',
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 密码字段实时校验提示（输入过且不达标时显示）
  const [passwordTouched, setPasswordTouched] = useState(false);
  const passwordStrength = validatePasswordStrength(formData.password);
  // 确认密码失焦比对（HIG 建议：错误尽早反馈，不必等到提交）
  const [confirmTouched, setConfirmTouched] = useState(false);
  const confirmPasswordMismatch =
    confirmTouched && formData.confirmPassword.length > 0 && formData.confirmPassword !== formData.password;

  useEffect(() => {
    const inviteFromUrl =
      searchParams.get('invite_code') ||
      searchParams.get('inviteCode') ||
      searchParams.get('code');
    if (!inviteFromUrl) return;
    if (formData.inviteCode.trim()) return;
    setFormData((prev) => ({ ...prev, inviteCode: inviteFromUrl.trim() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate passwords match
    if (formData.password !== formData.confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    // Validate password strength（与后端策略一致：12 位 + 3 类）
    const strength = validatePasswordStrength(formData.password);
    if (!strength.valid) {
      setError(strength.message);
      setPasswordTouched(true);
      return;
    }

    setLoading(true);

    try {
      if (!formData.inviteCode.trim()) {
        setError('请填写邀请码');
        return;
      }

      await authApi.register(
        formData.username,
        formData.email,
        formData.password,
        formData.inviteCode.trim()
      );

      // Redirect to login
      router.push('/login?registered=true');
    } catch (err: any) {
      setError(extractErrorMessage(err, '注册失败，请重试'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full space-y-8 animate-fade-in">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-foreground">创建账号</h2>
          <p className="mt-2 text-muted">开始使用本站服务</p>
        </div>

        <form onSubmit={handleSubmit} className="surface p-6 space-y-6">
          {error && (
            <Alert status="danger">
              <Alert.Indicator />
              <Alert.Content><Alert.Description>{error}</Alert.Description></Alert.Content>
            </Alert>
          )}

          <div>
            <TextField isRequired isDisabled={loading}>
              <Label>邀请码</Label>
              <Input id="inviteCode" type="text" className="uppercase" value={formData.inviteCode} onChange={(e) => setFormData({ ...formData, inviteCode: e.target.value })} placeholder="请输入邀请码" />
              <Description>仅支持邀请制注册</Description>
            </TextField>
          </div>

          <div>
            <TextField isRequired isDisabled={loading}>
              <Label>用户名</Label>
              <Input id="username" type="text" minLength={3} autoComplete="username" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} />
            </TextField>
          </div>

          <div>
            <TextField isRequired isDisabled={loading}>
              <Label>邮箱</Label>
              <Input id="email" type="email" autoComplete="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
            </TextField>
          </div>

          <div>
            <TextField
              isRequired
              isDisabled={loading}
              isInvalid={passwordTouched && formData.password.length > 0 && !passwordStrength.valid}
              onBlur={() => setPasswordTouched(true)}
            >
              <Label>密码</Label>
              <Input
                id="password"
                type="password"
                minLength={12}
                autoComplete="new-password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
              <Description>{PASSWORD_REQUIREMENT_HINT}</Description>
              {passwordTouched && formData.password.length > 0 && !passwordStrength.valid ? (
                <FieldError>{passwordStrength.message}</FieldError>
              ) : null}
            </TextField>
          </div>

          <div>
            <TextField
              isRequired
              isDisabled={loading}
              isInvalid={confirmPasswordMismatch}
              onBlur={() => setConfirmTouched(true)}
            >
              <Label>确认密码</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              />
              {confirmPasswordMismatch ? (
                <FieldError>两次输入的密码不一致</FieldError>
              ) : null}
            </TextField>
          </div>

          <Button type="submit"
          isDisabled={loading}
          variant="primary" className="w-full" isPending={loading} >{loading ? '创建中...' : '创建账号'}</Button>

          <div className="text-center text-sm">
            <span className="text-muted">已有账号？ </span>
            <Link href="/login" className="text-accent hover:text-accent font-medium">
              登录
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
          <div className="flex flex-col items-center gap-3">
            <Spinner size="lg" />
            <p className="text-sm text-muted">加载中...</p>
          </div>
        </div>
      }
    >
      <RegisterContent />
    </Suspense>
  );
}
