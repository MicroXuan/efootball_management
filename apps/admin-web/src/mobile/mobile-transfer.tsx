import { Alert, Button, Modal } from 'antd';
import { useCallback, useRef, useState } from 'react';
import { LeagueTeamListResponseSchema, RosterMutationResponseSchema, TeamRosterViewSchema, TransferPlayerRequestSchema } from '@efm/contracts';
import type { AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';
import { collectCursorPages } from '../lib/cursor-pages';
import { failure } from './mobile-editors';
import { useResource } from './mobile-resource';

type Props = { leagueId: string; seasonId: string; api: AdminApi; onSaved(): void };
export function DirectTransfer(props: Props) {
  const [open, setOpen] = useState(false);
  return <section className="mobile-direct-transfer">
    <div><span className="mobile-eyebrow">管理员操作 · 所选赛季</span><h3>球员转会</h3><p>选择球员与转入球队，核对后直接办理。</p></div>
    <Button type="primary" onClick={() => setOpen(true)}>办理转会</Button>
    {open && <TransferForm key={`${props.leagueId}:${props.seasonId}`} {...props} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); props.onSaved(); }} />}
  </section>;
}
function TransferForm({ leagueId, seasonId, api, onClose, onSaved }: Props & { onClose(): void }) {
  const [retry, setRetry] = useState(0);
  const [source, setSource] = useState('');
  const [ownership, setOwnership] = useState('');
  const [target, setTarget] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const key = useMutationKey();
  const teams = useResource(useCallback(() => collectCursorPages((cursor) => api.request(
    `/v1/admin/leagues/${leagueId}/teams?${new URLSearchParams({ status: 'ACTIVE', ...(cursor ? { cursor } : {}) })}`, { schema: LeagueTeamListResponseSchema }
  )), [api, leagueId]), retry);
  const roster = useResource(useCallback(async () => source ? api.request(
    `/v1/admin/roster/leagues/${leagueId}/teams/${source}/roster?seasonId=${seasonId}`, { schema: TeamRosterViewSchema }
  ) : null, [api, leagueId, source, seasonId]), retry);
  const entry = roster.data?.entries.find((item) => item.id === ownership && item.status === 'ACTIVE' && item.leagueTeamId === source);
  const sourceTeam = teams.data?.find((team) => team.id === source);
  const targetTeam = teams.data?.find((team) => team.id === target && team.id !== source);
  const body = { seasonId, ownershipId: ownership, targetLeagueTeamId: target, amountMinor: Number(amount), reason: reason.trim(), expectedVersion: entry?.version ?? 0, idempotencyKey: key.current() };
  const valid = Boolean(entry && sourceTeam && targetTeam && roster.data?.operations.TRANSFER)
    && /^\d+$/.test(amount) && TransferPlayerRequestSchema.safeParse(body).success;
  const edit = () => { key.reset(); setError(''); };
  const label = (team: { name: string; teamNumber: number | null }) => `${team.teamNumber == null ? '' : `${team.teamNumber}号 · `}${team.name}`;
  async function save() {
    if (!valid || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await api.request('/v1/admin/roster/transfers', { method: 'POST', body, schema: RosterMutationResponseSchema });
      onSaved();
    } catch (caught) { setError(failure(caught)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Modal open title="管理员办理转会" className="mobile-modal" footer={null} closable={!busy} mask={{ closable: false }} onCancel={() => { if (!lock.current) onClose(); }}>
    <div className="mobile-editor">
      {error && <Alert role="alert" type="error" title={error} />}
      {preview ? <>
        <div className="mobile-decision-preview"><small>转会球员</small><strong>{entry?.playerName} · {entry?.cardName}</strong><p>{sourceTeam && label(sourceTeam)} → {targetTeam && label(targetTeam)}</p><strong>{Number(amount).toLocaleString('zh-CN')} 资金</strong><p>原因：{reason}</p></div>
        <p className="mobile-muted">确认后直接完成转会。系统将重新校验球员归属、转会窗口、球队人数和工资帽，并按联赛规则结算手续费。</p>
        <Button block type="primary" loading={busy} disabled={!valid} onClick={() => void save()}>确认办理转会</Button>
        <Button block disabled={busy} onClick={() => setPreview(false)}>返回修改</Button>
      </> : <>
        {teams.failed ? <><Alert role="alert" type="error" title="球队加载失败，请重试。" /><Button onClick={() => setRetry((value) => value + 1)}>重新加载球队</Button></> : !teams.data ? <p role="status">正在加载球队…</p> : !teams.data.length ? <p>此联赛暂无现役球队。</p> : null}
        <label>转出球队<select aria-label="转出球队" value={source} disabled={!teams.data?.length} onChange={(event) => { setSource(event.target.value); setOwnership(''); setTarget(''); edit(); }}><option value="">请选择转出球队</option>{teams.data?.map((team) => <option key={team.id} value={team.id}>{label(team)}</option>)}</select></label>
        {source && (roster.failed ? <><Alert role="alert" type="error" title="阵容加载失败，请重试。" /><Button onClick={() => setRetry((value) => value + 1)}>重新加载阵容</Button></> : !roster.data ? <p role="status">正在加载阵容…</p> : !roster.data.operations.TRANSFER ? <Alert type="warning" title="所选赛季当前不允许转会，请核对转会窗口。" /> : !roster.data.entries.some((item) => item.status === 'ACTIVE') ? <p>此球队暂无可转会球员。</p> : null)}
        <label>转会球员<select aria-label="转会球员" value={ownership} disabled={!roster.data?.operations.TRANSFER} onChange={(event) => { setOwnership(event.target.value); edit(); }}><option value="">请选择球员</option>{roster.data?.entries.filter((item) => item.status === 'ACTIVE').map((item) => <option key={item.id} value={item.id}>{item.playerName} · {item.cardName}</option>)}</select></label>
        <label>转入球队<select aria-label="转入球队" value={target} disabled={!source || !teams.data} onChange={(event) => { setTarget(event.target.value); edit(); }}><option value="">请选择转入球队</option>{teams.data?.filter((team) => team.id !== source).map((team) => <option key={team.id} value={team.id}>{label(team)}</option>)}</select></label>
        <label>转会金额（资金）<input aria-label="转会金额（资金）" inputMode="numeric" maxLength={15} placeholder="填写大于 0 的整数金额" value={amount} onChange={(event) => { setAmount(event.target.value); edit(); }} /></label>
        <label>转会原因<textarea aria-label="转会原因" rows={3} maxLength={512} value={reason} onChange={(event) => { setReason(event.target.value); edit(); }} /></label>
        <Button block type="primary" disabled={!valid} onClick={() => setPreview(true)}>核对转会</Button>
      </>}
    </div>
  </Modal>;
}
