import { Alert, Button, Form, Input, Modal, Select, Space } from 'antd';
import {
  LeagueTeamListResponseSchema,
  type LeagueTeamDetail,
  type LeagueTeamSummary,
  type TeamCatalogItem
} from '@efm/contracts';
import { z } from 'zod';
import { useEffect, useState } from 'react';
import { adminApi, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';
import { TeamShellPicker } from './team-shell-picker';

type Mode = 'change' | 'transfer' | 'swap' | 'refresh';
const MutationResponseSchema = z.object({ updatedTeamIds: z.array(z.string()) });
const invariantCopy = '本次操作只改变球队名称、简称和队徽。阵容、财务、比赛成绩、球队编号、负责人和联赛称呼均保持不变。';

export function TeamShellActions({
  api = adminApi,
  leagueId,
  team,
  onCompleted
}: {
  api?: AdminApi;
  leagueId: string;
  team: LeagueTeamDetail;
  onCompleted: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [teams, setTeams] = useState<LeagueTeamSummary[]>([]);
  const [targetTeamId, setTargetTeamId] = useState<string>();
  const [selectedCatalogTeamId, setSelectedCatalogTeamId] = useState<string>();
  const [selectedShell, setSelectedShell] = useState<TeamCatalogItem>();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const mutationKey = useMutationKey();

  useEffect(() => {
    if (mode !== 'transfer' && mode !== 'swap') return;
    void api.request(`/v1/admin/leagues/${leagueId}/teams`, { schema: LeagueTeamListResponseSchema })
      .then(({ items }) => setTeams(items.filter(({ id }) => id !== team.id)))
      .catch(() => setError('球队列表加载失败，请关闭后重试'));
  }, [api, leagueId, mode, team.id]);

  const close = () => {
    if (submitting) return;
    setMode(null); setTargetTeamId(undefined); setSelectedCatalogTeamId(undefined);
    setSelectedShell(undefined); setReason(''); setError(undefined); mutationKey.reset();
  };

  const submit = async () => {
    if (!mode || submitting) return;
    setSubmitting(true); setError(undefined);
    const common = { reason: reason.trim() || undefined };
    let path = `/v1/admin/leagues/${leagueId}/teams/${team.id}/shell/${mode}`;
    let body: Record<string, unknown>;
    if (mode === 'change') body = { catalogTeamId: selectedCatalogTeamId, expectedVersion: team.version, ...common };
    else if (mode === 'refresh') body = { catalogTeamId: team.catalogTeamId, expectedVersion: team.version, ...common };
    else if (mode === 'transfer') body = {
      targetTeamId,
      sourceReplacementCatalogTeamId: selectedCatalogTeamId,
      expectedSourceVersion: team.version,
      expectedTargetVersion: teams.find(({ id }) => id === targetTeamId)?.version,
      ...common
    };
    else {
      path = `/v1/admin/leagues/${leagueId}/teams/shell/swap`;
      body = {
        sourceTeamId: team.id,
        otherTeamId: targetTeamId,
        expectedSourceVersion: team.version,
        expectedOtherVersion: teams.find(({ id }) => id === targetTeamId)?.version,
        ...common
      };
    }
    try {
      await api.request(path, {
        method: 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, body,
        schema: MutationResponseSchema
      });
      mutationKey.reset();
      setMode(null); setTargetTeamId(undefined); setSelectedCatalogTeamId(undefined);
      setSelectedShell(undefined); setReason('');
      await onCompleted();
    } catch {
      setError('队壳操作失败，数据未发生变化，请重新加载后再试');
    } finally {
      setSubmitting(false);
    }
  };

  const target = teams.find(({ id }) => id === targetTeamId);
  const canSubmit = mode === 'refresh'
    || mode === 'change' && Boolean(selectedCatalogTeamId)
    || mode === 'transfer' && Boolean(targetTeamId && selectedCatalogTeamId)
    || mode === 'swap' && Boolean(targetTeamId);
  const title = mode === 'change' ? '更换队壳'
    : mode === 'transfer' ? '转让队壳'
      : mode === 'swap' ? '互换队壳'
        : '刷新队壳资料';

  return <div className="team-shell-actions">
    <Space wrap>
      <Button onClick={() => setMode('change')}>更换队壳</Button>
      <Button onClick={() => setMode('transfer')}>转让队壳</Button>
      <Button onClick={() => setMode('swap')}>互换队壳</Button>
      <Button onClick={() => setMode('refresh')}>刷新队壳资料</Button>
    </Space>
    <Modal
      open={Boolean(mode)}
      title={title}
      onCancel={close}
      onOk={() => void submit()}
      okText={`确认${title}`}
      cancelText="取消"
      confirmLoading={submitting}
      okButtonProps={{ disabled: !canSubmit }}
      destroyOnHidden
    >
      {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}
      <Alert type="warning" showIcon title={invariantCopy} />
      <div className="shell-operation-summary">
        <strong>当前队壳</strong><span>{team.name}（{team.shortName}）</span>
        {target ? <><strong>{mode === 'swap' ? '互换球队' : '接收球队'}</strong><span>{target.teamNumber}-{target.name}（{target.ownerAlias}）</span></> : null}
        {selectedShell ? <><strong>{mode === 'transfer' ? '原球队替补队壳' : '新队壳'}</strong><span>{selectedShell.nameZh ?? selectedShell.nameEn ?? selectedShell.nameJa}</span></> : null}
      </div>
      {(mode === 'transfer' || mode === 'swap') ? <Form.Item label={mode === 'swap' ? '选择互换球队' : '选择接收球队'} required>
        <Select
          aria-label={mode === 'swap' ? '选择互换球队' : '选择接收球队'}
          value={targetTeamId}
          onChange={(value) => { setTargetTeamId(value); mutationKey.reset(); }}
          options={teams.map((item) => ({ value: item.id, label: `${item.teamNumber}-${item.name}（${item.ownerAlias}）` }))}
        />
      </Form.Item> : null}
      {(mode === 'change' || mode === 'transfer') ? <Form.Item label={mode === 'transfer' ? '原球队替补队壳' : '选择新队壳'} required>
        <TeamShellPicker
          api={api}
          leagueId={leagueId}
          value={selectedCatalogTeamId}
          onChange={(value) => { setSelectedCatalogTeamId(value); mutationKey.reset(); }}
          onSelectItem={setSelectedShell}
        />
      </Form.Item> : null}
      <Form.Item label="操作原因（选填）">
        <Input.TextArea value={reason} maxLength={512} onChange={(event) => { setReason(event.target.value); mutationKey.reset(); }} />
      </Form.Item>
    </Modal>
  </div>;
}
