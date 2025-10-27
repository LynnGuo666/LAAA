'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { userApi, clientApi } from '@/lib/api';

export default function DashboardPage() {
  const [stats, setStats] = useState({
    apps: 0,
    authorizations: 0,
    sessions: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [appsResponse, authsResponse, sessionsResponse] = await Promise.all([
        clientApi.list(),
        userApi.getAuthorizations(),
        userApi.getSessions(),
      ]);

      setStats({
        apps: appsResponse.data.length,
        authorizations: authsResponse.data.length,
        sessions: sessionsResponse.data.length,
      });
    } catch (err) {
      console.error('Failed to load stats', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="px-4 sm:px-0">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>

      {loading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 mb-8">
            <Link href="/dashboard/apps" className="card hover:shadow-lg transition-shadow">
              <div className="flex items-center">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-500">My Applications</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{stats.apps}</p>
                </div>
                <div className="text-4xl">📱</div>
              </div>
            </Link>

            <div className="card">
              <div className="flex items-center">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-500">Authorized Apps</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{stats.authorizations}</p>
                </div>
                <div className="text-4xl">🔐</div>
              </div>
            </div>

            <Link href="/dashboard/sessions" className="card hover:shadow-lg transition-shadow">
              <div className="flex items-center">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-500">Active Sessions</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{stats.sessions}</p>
                </div>
                <div className="text-4xl">💻</div>
              </div>
            </Link>
          </div>

          {/* Quick Actions */}
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Link
                href="/dashboard/apps"
                className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 transition-colors"
              >
                <h3 className="font-semibold mb-1">Create New App</h3>
                <p className="text-sm text-gray-600">
                  Register a new OAuth 2.0 application
                </p>
              </Link>

              <Link
                href="/dashboard/profile"
                className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 transition-colors"
              >
                <h3 className="font-semibold mb-1">Update Profile</h3>
                <p className="text-sm text-gray-600">
                  Manage your account settings
                </p>
              </Link>

              <Link
                href="/dashboard/sessions"
                className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 transition-colors"
              >
                <h3 className="font-semibold mb-1">Manage Sessions</h3>
                <p className="text-sm text-gray-600">
                  View and revoke active sessions
                </p>
              </Link>

              <a
                href="/api/docs"
                target="_blank"
                className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 transition-colors"
              >
                <h3 className="font-semibold mb-1">API Documentation</h3>
                <p className="text-sm text-gray-600">
                  View API reference and examples
                </p>
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
