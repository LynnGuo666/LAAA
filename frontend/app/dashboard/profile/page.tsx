'use client';

import { useState } from 'react';
import { useAuthStore } from '@/lib/store';
import { userApi } from '@/lib/api';
import { formatDate } from '@/lib/date';

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
    <div className="px-4 sm:px-0 max-w-2xl animate-fade-in">
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 mb-6 sm:mb-8">个人资料</h1>

      <form onSubmit={handleSubmit} className="surface p-6 space-y-6">
        {message && (
          <div className={`p-4 rounded-lg ${message.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            {message}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            用户名
          </label>
          <input
            type="text"
            disabled
            value={user.username}
            className="input bg-gray-100 dark:bg-gray-800 cursor-not-allowed"
          />
          <p className="text-xs text-gray-500 mt-1">用户名不可修改</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            邮箱
          </label>
          <input
            type="email"
            required
            className="input"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            disabled={loading}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            头像 URL
          </label>
          <input
            type="url"
            className="input"
            placeholder="https://example.com/avatar.jpg"
            value={formData.avatar}
            onChange={(e) => setFormData({ ...formData, avatar: e.target.value })}
            disabled={loading}
          />
        </div>

        <div className="pt-4">
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary disabled:opacity-50"
          >
            {loading ? '保存中...' : '保存更改'}
          </button>
        </div>
      </form>

      <div className="surface overflow-hidden mt-6">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">账号信息</h2>
        </div>
        <ul className="list">
          <li className="list-item">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600 dark:text-gray-300">用户 ID</span>
              <span className="text-sm text-gray-900 dark:text-gray-100">{user.id}</span>
            </div>
          </li>
          <li className="list-item">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600 dark:text-gray-300">状态</span>
              <span className="text-sm text-gray-900 dark:text-gray-100">{user.status}</span>
            </div>
          </li>
          <li className="list-item">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600 dark:text-gray-300">注册时间</span>
              <span className="text-sm text-gray-900 dark:text-gray-100">
                {formatDate(user.created_at)}
              </span>
            </div>
          </li>
        </ul>
      </div>
    </div>
  );
}
