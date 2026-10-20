import { Alert, Button, Card, Checkbox, InputNumber, Select, Space, Table, Tag, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { NominationCandidateListSchema, PlayerAuctionBatchDetailSchema, PlayerAuctionBatchListResponseSchema, type NominationCandidate, type PlayerAuctionBatchDetail } from '@efm/contracts';
import { z } from 'zod';
import { adminApi, type AdminApi } from '../lib/api';

type DraftSelection = { cardId: string; startingPrice: number | null; minimumIncrement: number | null };

export function mergeNominatedLots(batch: PlayerAuctionBatchDetail, candidates: NominationCandidate[], selected: Record<string, DraftSelection>) {
  const existing = batch.lots.map((lot) => ({
    playerId: lot.playerId, playerCardId: lot.playerCardId!, ...(lot.nominationId ? { nominationId: lot.nominationId } : {}),
    displayOrder: lot.displayOrder, startingPrice: lot.startingPrice, minimumIncrement: lot.minimumIncrement
  }));
  const known = new Set(existing.map((lot) => lot.playerId));
  for (const candidate of candidates) {
    const choice = selected[candidate.playerId];
    if (!choice || known.has(candidate.playerId)) continue;
    if (!candidate.eligible || !candidate.cards.some((card) => card.id === choice.cardId) || !choice.startingPrice || !choice.minimumIncrement) {
      throw new Error('提名球员缺少有效卡片或价格');
    }
    existing.push({ playerId: candidate.playerId, playerCardId: choice.cardId, nominationId: candidate.sourceNominationId,
      displayOrder: existing.length + 1, startingPrice: choice.startingPrice, minimumIncrement: choice.minimumIncrement });
    known.add(candidate.playerId);
  }
  return existing;
}

export function NominationShortlistPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '', windowId = '' } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState<NominationCandidate[]>([]);
  const [drafts, setDrafts] = useState<z.infer<typeof PlayerAuctionBatchListResponseSchema>['items']>([]);
  const [draftId, setDraftId] = useState('');
  const [selected, setSelected] = useState<Record<string, DraftSelection>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [response, batches] = await Promise.all([
        api.request(`/v1/admin/leagues/${leagueId}/nomination-windows/${windowId}/candidates`, { schema: NominationCandidateListSchema }),
        api.request(`/v1/admin/leagues/${leagueId}/player-auctions`, { schema: PlayerAuctionBatchListResponseSchema })
      ]);
      const available = batches.items.filter((batch) => batch.status === 'DRAFT');
      setItems(response.items); setDrafts(available); setDraftId((current) => available.some((draft) => draft.id === current) ? current : available[0]?.id ?? ''); setError(null);
    } catch { setError('提名候选加载失败，请检查联赛管理权限'); }
    finally { setBusy(false); }
  }, [api, leagueId, windowId]);
  useEffect(() => { void load(); }, [load]);

  const choose = (candidate: NominationCandidate, checked: boolean) => setSelected((current) => {
    const next = { ...current };
    if (checked) next[candidate.playerId] = { cardId: '', startingPrice: null, minimumIncrement: null };
    else delete next[candidate.playerId];
    return next;
  });
  const setChoice = (playerId: string, patch: Partial<DraftSelection>) => setSelected((current) => ({ ...current, [playerId]: { ...current[playerId]!, ...patch } }));
  const selectedCandidates = items.filter((candidate) => selected[candidate.playerId]);
  const ready = selectedCandidates.length > 0 && selectedCandidates.every((candidate) => {
    const value = selected[candidate.playerId]!;
    return candidate.eligible && candidate.cards.some((card) => card.id === value.cardId) && Number.isInteger(value.startingPrice) && Number(value.startingPrice) > 0 && Number.isInteger(value.minimumIncrement) && Number(value.minimumIncrement) > 0;
  });
  const importSelected = async () => {
    if (!ready || !draftId || busy) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const draft = await api.request(`/v1/admin/leagues/${leagueId}/player-auctions/${draftId}`, { schema: PlayerAuctionBatchDetailSchema });
      if (draft.status !== 'DRAFT') throw new Error('草稿状态已改变');
      const lots = mergeNominatedLots(draft, items, selected);
      if (lots.length === draft.lots.length) { setNotice('所选球员已在草稿中，无需重复导入'); return; }
      await api.request(`/v1/admin/leagues/${leagueId}/player-auctions/${draftId}/lots`, {
        method: 'PUT', headers: { 'Idempotency-Key': crypto.randomUUID() }, schema: PlayerAuctionBatchDetailSchema,
        body: { expectedVersion: draft.version, lots }
      });
      navigate(`/leagues/${leagueId}/auctions/${draftId}/edit`);
    } catch { setError('导入失败：请刷新候选资格和拍卖草稿，再检查卡片与价格'); }
    finally { setBusy(false); }
  };

  return <Card title="提名候选名单" extra={<Space><Button onClick={() => void load()} loading={busy}>刷新</Button><Link to={`/leagues/${leagueId}/nomination-windows`}>返回提名期</Link></Space>}>
    {error ? <Alert role="alert" showIcon type="error" title={error} /> : null}
    {notice ? <Alert role="status" showIcon type="info" title={notice} /> : null}
    <Typography.Paragraph type="secondary">同一球员只显示一次。选择球员、卡片、起拍价和最低加价后，可追加到现有草稿；不会自动准备或开拍。</Typography.Paragraph>
    <Table rowKey="playerId" pagination={false} dataSource={items} locale={{ emptyText: '暂无球队提名' }} columns={[
      { title: '选择', render: (_, row) => <Checkbox aria-label={`选择${row.playerName}`} checked={Boolean(selected[row.playerId])} disabled={!row.eligible} onChange={(event) => choose(row, event.target.checked)} /> },
      { title: '球员', dataIndex: 'playerName' },
      { title: '提名球队数', dataIndex: 'nominatorCount' },
      { title: '提名球队', render: (_, row) => row.nominators.map((team) => `${team.teamNumber ?? '—'}号 ${team.teamName}（${team.ownerAlias}）`).join('、') },
      { title: '资格', render: (_, row) => row.eligible ? <Tag color="success">可导入</Tag> : <Tag color="error">已被签约/无可用卡片</Tag> },
      { title: '卡片', render: (_, row) => <Select aria-label={`${row.playerName}卡片`} disabled={!selected[row.playerId]} value={selected[row.playerId]?.cardId || undefined} placeholder="选择卡片" options={row.cards.map((card) => ({ value: card.id, label: card.cardName }))} onChange={(value) => setChoice(row.playerId, { cardId: value })} style={{ minWidth: 120 }} /> },
      { title: '起拍价', render: (_, row) => <InputNumber aria-label={`${row.playerName}起拍价`} min={1} precision={0} disabled={!selected[row.playerId]} value={selected[row.playerId]?.startingPrice} onChange={(value) => setChoice(row.playerId, { startingPrice: value })} /> },
      { title: '最低加价', render: (_, row) => <InputNumber aria-label={`${row.playerName}最低加价`} min={1} precision={0} disabled={!selected[row.playerId]} value={selected[row.playerId]?.minimumIncrement} onChange={(value) => setChoice(row.playerId, { minimumIncrement: value })} /> }
    ]} />
    <Space wrap style={{ marginTop: 20 }}><Select aria-label="选择拍卖草稿" value={draftId || undefined} placeholder="选择拍卖草稿" options={drafts.map((draft) => ({ value: draft.id, label: draft.name }))} onChange={setDraftId} style={{ minWidth: 220 }} /><Button type="primary" disabled={!ready || !draftId} loading={busy} onClick={() => void importSelected()}>导入所选到草稿</Button><Link to={`/leagues/${leagueId}/auctions/new`}>新建拍卖草稿</Link></Space>
  </Card>;
}
