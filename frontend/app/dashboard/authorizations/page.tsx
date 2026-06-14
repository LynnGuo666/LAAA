'use client';

import { useEffect, useState } from 'react';
import { AlertDialog, Button, Card, Chip, Table, toast } from '@heroui/react';
import { userApi } from '@/lib/api';
import { formatDateTime } from '@/lib/date';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { EntityAvatar } from '@/components/admin/admin-ui';
import { PageLoadingState } from '@/components/ui/loading';

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
    return <PageLoadingState />;
  }

  return (
    <div className="px-4 sm:px-0 animate-fade-in">
      <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-6 sm:mb-8">授权管理</h1>

      {authorizations.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <p className="text-default-500">暂无已授权应用</p>
          </div>
        </Card>
      ) : (
        <Card>
          <Table aria-label="授权应用列表">
            <Table.ScrollContainer>
              <Table.Content>
                <Table.Header>
                  <Table.Column isRowHeader>应用</Table.Column>
                  <Table.Column>授权范围</Table.Column>
                  <Table.Column>首次授权</Table.Column>
                  <Table.Column>最近使用</Table.Column>
                  <Table.Column>操作</Table.Column>
                </Table.Header>
                <Table.Body>
                  {authorizations.map((auth) => (
                    <Table.Row key={auth.id} id={String(auth.id)}>
                      <Table.Cell>
                        <div className="flex items-center gap-3">
                          <EntityAvatar src={auth.client_logo} name={auth.client_name} size="sm" />
                          <span className="font-medium text-foreground">{auth.client_name}</span>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex flex-wrap gap-1">
                          {auth.scope ? auth.scope.split(' ').map((s) => (
                            <Chip key={s} size="sm" variant="soft">{s}</Chip>
                          )) : <span className="text-default-400">-</span>}
                        </div>
                      </Table.Cell>
                      <Table.Cell className="text-default-600 text-sm">{formatDateTime(auth.created_at)}</Table.Cell>
                      <Table.Cell className="text-default-600 text-sm">{formatDateTime(auth.last_used_at)}</Table.Cell>
                      <Table.Cell>
                        <div className="flex items-center gap-2">
                          <Button onPress={() => handleShowDetail(auth)} variant="tertiary" size="sm">详情</Button>
                          <Button onPress={() => handleRevoke(auth)} variant="danger" size="sm">撤回</Button>
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        </Card>
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
                  <div className="space-y-2 text-sm text-default-600">
                    <div><span className="text-default-500">应用：</span>{selectedAuthorization.client_name}</div>
                    <div><span className="text-default-500">授权范围：</span>{selectedAuthorization.scope || '-'}</div>
                    <div><span className="text-default-500">首次授权：</span>{formatDateTime(selectedAuthorization.created_at)}</div>
                    <div><span className="text-default-500">最近使用：</span>{formatDateTime(selectedAuthorization.last_used_at)}</div>
                  </div>
                )}
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button onPress={() => setShowDetailModal(false)} variant="primary">
                  知道了
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
