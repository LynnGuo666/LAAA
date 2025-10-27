'use client';

import { useState } from 'react';
import { useAuthStore } from '@/lib/store';
import { userApi } from '@/lib/api';

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
    <div className="px-4 sm:px-0 max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">Profile Settings</h1>

      <form onSubmit={handleSubmit} className="card space-y-6">
        {message && (
          <div className={`p-4 rounded-lg ${message.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
            {message}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Username
          </label>
          <input
            type="text"
            disabled
            value={user.username}
            className="input bg-gray-100 cursor-not-allowed"
          />
          <p className="text-xs text-gray-500 mt-1">Username cannot be changed</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Email
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
            Avatar URL
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
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>

      <div className="card mt-6">
        <h2 className="text-xl font-semibold mb-4">Account Information</h2>
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-medium">User ID:</span> {user.id}
          </p>
          <p>
            <span className="font-medium">Status:</span>{' '}
            <span className="text-green-600">{user.status}</span>
          </p>
          <p>
            <span className="font-medium">Member since:</span>{' '}
            {new Date(user.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>
    </div>
  );
}
