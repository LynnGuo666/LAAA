'use client';

import { useEffect, useState } from 'react';
import { passkeyApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { Check, AlertTriangle } from 'lucide-react';
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  parseRegistrationOptions,
  createPasskeyCredential,
  serializeRegistrationCredential,
  suggestPasskeyName,
  PasskeyCredential,
} from '@/lib/webauthn';

export default function PasskeysPage() {
  const user = useAuthStore((s) => s.user);
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [webAuthnSupported, setWebAuthnSupported] = useState(false);
  const [platformAvailable, setPlatformAvailable] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [newPasskeyName, setNewPasskeyName] = useState('');
  const [pendingCredential, setPendingCredential] = useState<any>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkWebAuthnSupport();
    loadPasskeys();
  }, []);

  const checkWebAuthnSupport = async () => {
    const supported = isWebAuthnSupported();
    setWebAuthnSupported(supported);
    if (supported) {
      const platform = await isPlatformAuthenticatorAvailable();
      setPlatformAvailable(platform);
    }
  };

  const loadPasskeys = async () => {
    try {
      const response = await passkeyApi.list();
      setPasskeys(response.data);
    } catch (err) {
      console.error('Failed to load passkeys', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!webAuthnSupported) {
      setError('您的浏览器不支持通行密钥');
      return;
    }

    setError(null);
    setRegistering(true);

    try {
      // Step 1: Get registration options
      const optionsResponse = await passkeyApi.getRegistrationOptions();
      const options = parseRegistrationOptions(optionsResponse.data);

      // Step 2: Create credential
      const credential = await createPasskeyCredential(options);

      // Step 3: Serialize credential and show name modal
      const serialized = serializeRegistrationCredential(credential);
      setPendingCredential(serialized);
      setNewPasskeyName(suggestPasskeyName());
      setShowNameModal(true);
    } catch (err: any) {
      console.error('Passkey registration failed', err);
      if (err.name === 'NotAllowedError') {
        setError('用户取消了操作或设备不支持');
      } else if (err.name === 'InvalidStateError') {
        setError('此设备已经注册过通行密钥');
      } else {
        setError(err.message || '注册通行密钥失败');
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleConfirmRegistration = async () => {
    if (!pendingCredential || !newPasskeyName.trim()) return;

    setRegistering(true);
    try {
      await passkeyApi.verifyRegistration({
        ...pendingCredential,
        name: newPasskeyName.trim(),
      });
      setShowNameModal(false);
      setPendingCredential(null);
      setNewPasskeyName('');
      loadPasskeys();
    } catch (err: any) {
      console.error('Failed to verify registration', err);
      setError(err.response?.data?.detail || '验证通行密钥失败');
    } finally {
      setRegistering(false);
    }
  };

  const handleRename = async (id: number) => {
    if (!editingName.trim()) return;

    try {
      await passkeyApi.rename(id, editingName.trim());
      setEditingId(null);
      setEditingName('');
      loadPasskeys();
    } catch (err) {
      alert('重命名失败');
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`确定要删除通行密钥 "${name}" 吗？删除后将无法使用此通行密钥登录。`)) return;

    try {
      await passkeyApi.delete(id);
      loadPasskeys();
    } catch (err) {
      alert('删除失败');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  if (loading) {
    return <div className="text-center py-12">加载中...</div>;
  }

  return (
    <div className="px-4 sm:px-0 animate-fade-in">
      <h1 className="text-3xl font-bold mb-4">通行密钥</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        通行密钥是一种更安全、更便捷的登录方式，使用您设备上的指纹、面容或屏幕锁定来验证身份。
      </p>

      {!webAuthnSupported && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
          <p className="text-yellow-800 dark:text-yellow-200">
            您的浏览器不支持通行密钥功能。请使用支持 WebAuthn 的现代浏览器（如 Chrome、Safari、Firefox、Edge）。
          </p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {user && !user.email_verified && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 flex-shrink-0" />
            <p className="text-yellow-800 dark:text-yellow-200">
              绑定通行密钥需要先验证邮箱。请前往控制台首页重新发送验证邮件。
            </p>
          </div>
        </div>
      )}

      <div className="mb-6">
        <button
          onClick={handleRegister}
          disabled={!webAuthnSupported || registering || !user?.email_verified}
          className="btn btn-primary"
        >
          {registering ? '正在注册...' : '添加通行密钥'}
        </button>
        {platformAvailable && (
          <span className="ml-3 text-sm text-green-600 dark:text-green-400 inline-flex items-center gap-1">
            <Check className="w-4 h-4" /> 检测到平台认证器(指纹/面容)
          </span>
        )}
      </div>

      {passkeys.length === 0 ? (
        <div className="surface text-center py-12">
          <p className="text-gray-500 dark:text-gray-400">暂无通行密钥</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
            添加通行密钥后，您可以使用指纹、面容或设备 PIN 快速登录
          </p>
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <ul className="list">
            {passkeys.map((passkey) => (
              <li key={passkey.id} className="list-item">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    {editingId === passkey.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="input text-sm py-1"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename(passkey.id);
                            if (e.key === 'Escape') {
                              setEditingId(null);
                              setEditingName('');
                            }
                          }}
                        />
                        <button
                          onClick={() => handleRename(passkey.id)}
                          className="btn btn-primary text-sm py-1"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(null);
                            setEditingName('');
                          }}
                          className="btn text-sm py-1"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 min-w-0">
                          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                            {passkey.name}
                          </h3>
                          {passkey.backup_eligible && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-900 shrink-0">
                              可同步
                            </span>
                          )}
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-gray-500 dark:text-gray-400">
                          <p>创建时间：{formatDate(passkey.created_at)}</p>
                          {passkey.last_used_at && (
                            <p>最后使用：{formatDate(passkey.last_used_at)}</p>
                          )}
                          {passkey.transports && passkey.transports.length > 0 && (
                            <p>传输方式：{passkey.transports.join(', ')}</p>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {editingId !== passkey.id && (
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => {
                          setEditingId(passkey.id);
                          setEditingName(passkey.name);
                        }}
                        className="btn text-sm"
                      >
                        重命名
                      </button>
                      <button
                        onClick={() => handleDelete(passkey.id, passkey.name)}
                        className="btn btn-danger text-sm"
                      >
                        删除
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Name Modal */}
      {showNameModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold mb-4">为通行密钥命名</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              给这个通行密钥起一个便于识别的名称，例如设备名称
            </p>
            <input
              type="text"
              value={newPasskeyName}
              onChange={(e) => setNewPasskeyName(e.target.value)}
              className="input w-full mb-4"
              placeholder="例如：MacBook Pro"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirmRegistration();
              }}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowNameModal(false);
                  setPendingCredential(null);
                  setNewPasskeyName('');
                }}
                className="btn"
              >
                取消
              </button>
              <button
                onClick={handleConfirmRegistration}
                disabled={!newPasskeyName.trim() || registering}
                className="btn btn-primary"
              >
                {registering ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
