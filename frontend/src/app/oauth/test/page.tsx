'use client';

import { useState } from 'react';
import { apiClient } from '../../../lib/api';

export default function OAuthTestPage() {
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<any>(null);
  const [testResult, setTestResult] = useState<string>('');

  const testOAuthDiscovery = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getOAuthMetadata();
      setMetadata(data);
      setTestResult('✅ OAuth 发现端点工作正常');
    } catch (error) {
      setTestResult('❌ OAuth 发现端点测试失败: ' + error);
    } finally {
      setLoading(false);
    }
  };

  const testApplicationInfo = async () => {
    setLoading(true);
    try {
      const data = await apiClient.getApplicationInfo('laaa_dashboard');
      setTestResult('✅ 应用信息获取成功: ' + JSON.stringify(data, null, 2));
    } catch (error) {
      setTestResult('❌ 应用信息获取失败: ' + error);
    } finally {
      setLoading(false);
    }
  };

  const testOAuthFlow = () => {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: 'laaa_dashboard',
      redirect_uri: 'http://localhost:3000/oauth/callback',
      scope: 'read profile',
      state: 'test_state_' + Math.random().toString(36).substr(2, 9)
    });
    
    window.open(`/oauth/authorize?${params.toString()}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">OAuth2.0 功能测试</h1>
          
          <div className="space-y-6">
            {/* OAuth 发现端点测试 */}
            <div className="border border-gray-200 rounded-xl p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">1. OAuth 发现端点测试</h2>
              <p className="text-gray-600 mb-4">测试 /.well-known/oauth-authorization-server 端点</p>
              <button
                onClick={testOAuthDiscovery}
                disabled={loading}
                className="bg-blue-500 text-white px-6 py-2 rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {loading ? '测试中...' : '测试发现端点'}
              </button>
              
              {metadata && (
                <div className="mt-4">
                  <h3 className="font-medium text-gray-900 mb-2">返回的元数据：</h3>
                  <pre className="bg-gray-100 p-3 rounded text-sm overflow-auto">
                    {JSON.stringify(metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* 应用信息测试 */}
            <div className="border border-gray-200 rounded-xl p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">2. 应用信息获取测试</h2>
              <p className="text-gray-600 mb-4">测试获取默认应用 (laaa_dashboard) 的信息</p>
              <button
                onClick={testApplicationInfo}
                disabled={loading}
                className="bg-green-500 text-white px-6 py-2 rounded-lg hover:bg-green-600 disabled:opacity-50"
              >
                {loading ? '测试中...' : '获取应用信息'}
              </button>
            </div>

            {/* OAuth 授权流程测试 */}
            <div className="border border-gray-200 rounded-xl p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">3. OAuth 授权流程测试</h2>
              <p className="text-gray-600 mb-4">测试完整的 OAuth 授权流程</p>
              <div className="space-y-2 mb-4 text-sm text-gray-600">
                <p><strong>Client ID:</strong> laaa_dashboard</p>
                <p><strong>Redirect URI:</strong> http://localhost:3000/oauth/callback</p>
                <p><strong>Scopes:</strong> read, profile</p>
              </div>
              <button
                onClick={testOAuthFlow}
                className="bg-purple-500 text-white px-6 py-2 rounded-lg hover:bg-purple-600"
              >
                开始 OAuth 授权流程
              </button>
            </div>

            {/* 测试结果 */}
            {testResult && (
              <div className="border border-gray-200 rounded-xl p-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-4">测试结果</h2>
                <pre className="bg-gray-100 p-3 rounded text-sm whitespace-pre-wrap">
                  {testResult}
                </pre>
              </div>
            )}

            {/* 使用说明 */}
            <div className="border border-gray-200 rounded-xl p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">使用说明</h2>
              <div className="space-y-2 text-sm text-gray-600">
                <p><strong>步骤 1:</strong> 确保后端服务正在运行 (http://localhost:8000)</p>
                <p><strong>步骤 2:</strong> 使用管理员账号登录 (admin/admin123)</p>
                <p><strong>步骤 3:</strong> 在应用管理页面为用户授权访问应用</p>
                <p><strong>步骤 4:</strong> 测试 OAuth 授权流程</p>
              </div>
            </div>

            {/* 应用白名单功能测试 */}
            <div className="border border-gray-200 rounded-xl p-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">4. 应用白名单功能测试</h2>
              <div className="space-y-3 text-sm text-gray-600">
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  <span>创建测试应用并配置详细信息（名称、图标、描述等）</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  <span>在应用管理页面点击"用户授权"管理用户访问权限</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  <span>测试只有授权用户可以访问应用</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  <span>OAuth 授权页面显示应用详细信息（图标、描述、链接等）</span>
                </div>
              </div>
              <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>核心功能:</strong> 系统现在支持应用用户白名单，只有明确被授权的用户才能访问指定应用。
                  管理员可以通过直观的界面管理每个应用的用户访问权限。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}