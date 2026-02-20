'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { UIButton, UIDescription, UIInput, UILabel, UITextField } from '@/components/ui/primitives';

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

    // Validate password length
    if (formData.password.length < 6) {
      setError('密码长度至少为 6 个字符');
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
      setError(err.response?.data?.detail || '注册失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="max-w-md w-full space-y-8 animate-fade-in">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100">创建账号</h2>
          <p className="mt-2 text-gray-600 dark:text-gray-300">开始使用本站服务</p>
        </div>

        <form onSubmit={handleSubmit} className="surface p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <UITextField isRequired isDisabled={loading}>
              <UILabel>邀请码</UILabel>
              <UIInput id="inviteCode" type="text" className="uppercase" value={formData.inviteCode} onChange={(e) => setFormData({ ...formData, inviteCode: e.target.value })} placeholder="请输入邀请码" />
              <UIDescription>仅支持邀请制注册</UIDescription>
            </UITextField>
          </div>

          <div>
            <UITextField isRequired isDisabled={loading}>
              <UILabel>用户名</UILabel>
              <UIInput id="username" type="text" minLength={3} value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} />
            </UITextField>
          </div>

          <div>
            <UITextField isRequired isDisabled={loading}>
              <UILabel>邮箱</UILabel>
              <UIInput id="email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
            </UITextField>
          </div>

          <div>
            <UITextField isRequired isDisabled={loading}>
              <UILabel>密码</UILabel>
              <UIInput id="password" type="password" minLength={6} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} />
              <UIDescription>至少 6 个字符</UIDescription>
            </UITextField>
          </div>

          <div>
            <UITextField isRequired isDisabled={loading}>
              <UILabel>确认密码</UILabel>
              <UIInput id="confirm-password" type="password" value={formData.confirmPassword} onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })} />
            </UITextField>
          </div>

          <UIButton type="submit"
          isDisabled={loading}
          variant="primary" className="w-full" isPending={loading} >{loading ? '创建中...' : '创建账号'}</UIButton>

          <div className="text-center text-sm">
            <span className="text-gray-600">已有账号？ </span>
            <Link href="/login" className="text-blue-600 hover:text-blue-700 font-medium">
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
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-300">加载中...</p>
          </div>
        </div>
      }
    >
      <RegisterContent />
    </Suspense>
  );
}
