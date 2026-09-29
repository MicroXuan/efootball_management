import { Alert, Button, Descriptions, Drawer, Form, Input, InputNumber, Radio, Space, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { RosterMutationResponseSchema, RosterPlayerCandidateListResponseSchema, type RosterPlayerCandidate } from '@efm/contracts';
import { ApiError, adminApi, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';

type Summary = { rosterCount: number; salaryMinor: number; salaryCapMinor: number };
type Props = { open: boolean; leagueId: string; teamId: string; seasonId: string; summary: Summary; api?: AdminApi; onClose(): void; onCompleted(): void };

export function AcquirePlayerDrawer({ open, leagueId, teamId, seasonId, summary, api = adminApi, onClose, onCompleted }: Props) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<RosterPlayerCandidate[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mutationKey = useMutationKey();
  const selected = useMemo(() => results.flatMap((player) => player.cards).find((card) => card.id === selectedCardId), [results, selectedCardId]);
  const search = async () => {
    if (!keyword.trim()) return;
    setBusy(true); setError(null);
    try {
      const response = await api.request(`/v1/admin/roster/leagues/${leagueId}/player-candidates?keyword=${encodeURIComponent(keyword.trim())}`, { schema: RosterPlayerCandidateListResponseSchema });
      setResults(response.items);
      const recommended = response.items.find((player) => player.recommendedPlayerCardId)?.recommendedPlayerCardId ?? null;
      setSelectedCardId(recommended ?? response.items[0]?.cards[0]?.id ?? null);
    } catch { setError('球员搜索失败'); }
    finally { setBusy(false); }
  };
  const submit = async () => {
    if (!selectedCardId || amountMinor === null || !reason.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      await api.request('/v1/admin/roster/acquisitions', { method: 'POST', schema: RosterMutationResponseSchema, body: { seasonId, targetLeagueTeamId: teamId, playerCardId: selectedCardId, amountMinor, reason: reason.trim(), idempotencyKey: mutationKey.current() } });
      mutationKey.reset(); onCompleted(); onClose();
    } catch (caught) {
      if (caught instanceof ApiError && (caught.code === 'TEAM_ROSTER_FULL' || caught.code === 'TEAM_SALARY_CAP_EXCEEDED')) {
        setError(`操作被拒绝：阵容人数 ${summary.rosterCount}/25，工资 ${summary.salaryMinor}/${summary.salaryCapMinor}`);
      } else if (caught instanceof ApiError && caught.code === 'PLAYER_ALREADY_OWNED') setError('该球员在本联赛已归属其他球队');
      else setError('购买失败，请保持表单不变后重试');
    } finally { setBusy(false); }
  };
  return <Drawer open={open} onClose={onClose} title="购买球员" size="large" destroyOnHidden>
    {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}
    <Space.Compact block><Input aria-label="搜索球员" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => void search()} placeholder="中文名或英文名" /><Button aria-label="搜索" loading={busy} onClick={() => void search()}>搜索</Button></Space.Compact>
    {results.map((player) => <section className="candidate-group" key={player.playerId}>
      <div className="candidate-title"><strong>{player.playerName}</strong>{player.ownedByTeamId ? <Tag color="red">本联赛已归属</Tag> : null}</div>
      <Radio.Group value={selectedCardId} onChange={(event) => { setSelectedCardId(event.target.value); mutationKey.reset(); }}>
        <div className="candidate-card-grid">{player.cards.map((card) => <Radio key={card.id} value={card.id} aria-label={card.cardName} disabled={Boolean(player.ownedByTeamId)}>
          <div className="candidate-card"><strong>{card.cardName}</strong>{card.recommended ? <Tag color="green">系统推荐</Tag> : null}<span>{card.position} · 初始 {card.overallRating}</span><span>自动加点 {card.maxOverall ?? '—'} · DT {card.dtRating ?? '—'}</span></div>
        </Radio>)}</div>
      </Radio.Group>
    </section>)}
    {selected ? <Descriptions size="small" column={2} items={[{ key: 'salary', label: '球员工资', children: selected.salaryMinor ?? '未配置' }, { key: 'impact', label: '预计球队工资', children: selected.salaryMinor === null ? '—' : `${summary.salaryMinor + selected.salaryMinor}/${summary.salaryCapMinor}` }]} /> : null}
    {selected?.dtRating === null ? <Alert type="error" showIcon title="缺少 DT 能力值，不能加入阵容" /> : null}
    <Form layout="vertical">
      <Form.Item label="成交金额"><InputNumber aria-label="成交金额" min={1} precision={0} value={amountMinor} onChange={(value) => { setAmountMinor(value); mutationKey.reset(); }} /></Form.Item>
      <Form.Item label="操作原因"><Input aria-label="操作原因" value={reason} onChange={(event) => { setReason(event.target.value); mutationKey.reset(); }} /></Form.Item>
    </Form>
    <Typography.Paragraph type="secondary">确认后将写入不可修改的阵容交易和财务流水。</Typography.Paragraph>
    <Button aria-label="确认购买" type="primary" onClick={() => void submit()} loading={busy} disabled={!selected || selected.dtRating === null || selected.salaryMinor === null || Boolean(results.find((player) => player.cards.some((card) => card.id === selectedCardId))?.ownedByTeamId)}>确认购买</Button>
  </Drawer>;
}
