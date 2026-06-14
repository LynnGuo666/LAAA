'use client';

import { useState } from 'react';
import { useAuthStore } from '@/lib/store';
import { userApi } from '@/lib/api';
import { formatDate } from '@/lib/date';
import { Alert, Button, Card, Description, Input, Label, TextField } from '@heroui/react';

export default function ProfilePage() {
  const { user, setUser } = useAuthStore();
  const [formData, setFormData] = useState({
    email: user?.email || '',
    avatar: user?.avatar || '',
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const response = await userApi.updateProfile(formData);
      setUser(response.data);
      setMessage('Profile updated successfully!');
    } catch (err: any) {
      setMessage('Error: ' + (err.response?.data?.detail || 'Failed to update profile'));
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div className="px-4 sm:px-0 animate-fade-in">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">个人资料</h1>
        <p className="text-default-600 mt-1 text-sm sm:text-base">
          管理您的账号资料和基本信息。
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] gap-6">
        <form onSubmit={handleSubmit} className="surface p-5 sm:p-6 space-y-5">
          {message && (
            <Alert status={message.startsWith('Error') ? 'danger' : 'success'}>
              <Alert.Indicator />
              <Alert.Content><Alert.Description>{message}</Alert.Description></Alert.Content>
            </Alert>
          )}

          <div>
            <TextField isDisabled>
              <Label>用户名</Label>
              <Input type="text" value={user.username} />
              <Description>用户名不可修改</Description>
            </TextField>
          </div>

          <div>
            <TextField isRequired isDisabled={loading}>
              <Label>邮箱</Label>
              <Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
            </TextField>
          </div>

          <div>
            <TextField isDisabled={loading}>
              <Label>头像 URL</Label>
              <Input type="url" placeholder="https://example.com/avatar.jpg" value={formData.avatar} onChange={(e) => setFormData({ ...formData, avatar: e.target.value })} />
            </TextField>
          </div>

          <div className="pt-2">
            <Button type="submit" isDisabled={loading} variant="primary" isPending={loading}>{loading ? '保存中...' : '保存更改'}</Button>
          </div>
        </form>

        <Card className="border border-default-200 bg-content2 overflow-hidden">
          <div className="px-4 py-3 border-b border-default-200">
            <h2 className="text-base font-semibold text-foreground">账号信息</h2>
          </div>
          <ul className="list">
            <li className="list-item">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-default-600">用户 ID</span>
                <span className="text-sm text-foreground">{user.id}</span>
              </div>
            </li>
            <li className="list-item">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-default-600">状态</span>
                <span className="text-sm text-foreground">{user.status}</span>
              </div>
            </li>
            <li className="list-item">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-default-600">注册时间</span>
                <span className="text-sm text-foreground">
                  {formatDate(user.created_at)}
                </span>
              </div>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
