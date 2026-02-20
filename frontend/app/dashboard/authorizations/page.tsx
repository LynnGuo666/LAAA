'use client';

import { useEffect, useState } from 'react';
import { AlertDialog, Card, toast } from '@heroui/react';
import { userApi } from '@/lib/api';
import { formatDateTime } from '@/lib/date';
import { UIButton } from '@/components/ui/primitives';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { AppWindow } from 'lucide-react';

interface Authorization {
  id: number;
  client_name: string;
  client_logo?: string | null;
  scope: string;
  created_at: string;
  last_used_at: string;
}

export default function AuthorizationsPage() {
  const confirmDialog = useConfirmDialog();
  const [authorizations, setAuthorizations] = useState<Authorization[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAuthorization, setSelectedAuthorization] = useState<Authorization | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  useEffect(() => {
    loadAuthorizations();
  }, []);

  const loadAuthorizations = async () => {
    try {
      const response = await userApi.getAuthorizations();
      setAuthorizations(response.data);
    } catch (err) {
      console.error('Failed to load authorizations', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (auth: Authorization) => {
    const shouldRevoke = await confirmDialog({
      title: '确认撤销授权',
      description: `确定要撤销对 "${auth.client_name}" 的授权吗？`,
      confirmText: '撤销授权',
      cancelText: '取消',
      status: 'danger',
      confirmVariant: 'danger',
    });
    if (!shouldRevoke) return;
    try {
      await userApi.revokeAuthorization(auth.id);
      loadAuthorizations();
    } catch (err) {
      toast('撤销授权失败');
    }
  };

  const handleShowDetail = (auth: Authorization) => {
    setSelectedAuthorization(auth);
    setShowDetailModal(true);
  };

  if (loading) {
    return <div className="text-center py-12">加载中...</div>;
  }

  return (
    <div className="px-4 sm:px-0 animate-fade-in">
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 mb-6 sm:mb-8">授权管理</h1>

      {authorizations.length === 0 ? (
        <div className="surface text-center py-12">
          <p className="text-gray-500">暂无已授权应用</p>
        </div>
      ) : (
        <div className="space-y-3">
            {authorizations.map((auth) => (
              <Card key={auth.id} className="border border-default-200 bg-content2">
                <div className="p-4">
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                    {auth.client_logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={auth.client_logo}
                        alt={auth.client_name}
                        className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl object-cover border border-gray-200 dark:border-gray-800 shrink-0"
                      />
                  ) : (
                    <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center border border-gray-200 dark:border-gray-800 shrink-0">
                      <AppWindow className="h-5 w-5 sm:h-6 sm:w-6 text-gray-500 dark:text-gray-300" aria-hidden />
                    </div>
                  )}

                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {auth.client_name}
                      </h3>
                    </div>
                  </div>

                    <UIButton onPress={() => handleRevoke(auth)} variant="danger" className="text-xs sm:text-sm shrink-0">
                      撤回
                    </UIButton>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-300 truncate">
                      授权范围：{auth.scope || '-'}
                    </p>
                    <UIButton onPress={() => handleShowDetail(auth)} variant="tertiary" className="text-xs sm:text-sm shrink-0">
                      详情
                    </UIButton>
                  </div>
                </div>
                </div>
              </Card>
            ))}
        </div>
      )}

      <AlertDialog>
        <AlertDialog.Backdrop isOpen={showDetailModal} onOpenChange={setShowDetailModal}>
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Heading>授权详情</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                {selectedAuthorization && (
                  <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                    <div><span className="text-gray-500 dark:text-gray-400">应用：</span>{selectedAuthorization.client_name}</div>
                    <div><span className="text-gray-500 dark:text-gray-400">授权范围：</span>{selectedAuthorization.scope || '-'}</div>
                    <div><span className="text-gray-500 dark:text-gray-400">首次授权：</span>{formatDateTime(selectedAuthorization.created_at)}</div>
                    <div><span className="text-gray-500 dark:text-gray-400">最近使用：</span>{formatDateTime(selectedAuthorization.last_used_at)}</div>
                  </div>
                )}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <UIButton onPress={() => setShowDetailModal(false)} variant="primary">
                  知道了
                </UIButton>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
