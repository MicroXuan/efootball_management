import { Alert, Button, Modal } from 'antd';
import { useRef, useState } from 'react';
import { AdminTransferProposalSchema, ManagerMatchResultRequestSchema, MatchResultVersionResponseSchema, type CompetitionMatchResponse } from '@efm/contracts';
import { z } from 'zod';
import { ApiError, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';
import { formatDateTime } from '../lib/date-time';
import { teamName } from './mobile-data';

export type Proposal = z.infer<typeof AdminTransferProposalSchema>;
export const transferStatus: Record<string, string> = { PENDING_COUNTERPARTY: '待对方确认', PENDING_ADMIN: '待审核', APPROVED: '已批准', REJECTED: '已驳回', WITHDRAWN: '已撤回', EXPIRED: '已过期', INVALIDATED: '已失效' };
type Common = { leagueId: string; api: AdminApi; onClose(): void; onSaved(): void };
export function failure(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'VERSION_CONFLICT' || error.code.includes('VERSION')) return '记录已被其他管理员更新，请关闭此窗口、刷新列表后重新核对。';
    if (error.status === 403) return '当前账号没有此操作权限，请联系平台管理员。';
    if (error.code === 'MATCH_RESULT_NOT_ALLOWED') return '当前赛事状态不允许修改比赛结果，请刷新核对。';
    if (error.code === 'DISPUTE_NOT_READY') return '此比赛存在待处理争议，请先在完整后台处理。';
    if (error.code === 'TRANSFER_WINDOW_CLOSED') return '当前转会窗口未开放，请核对窗口设置。';
    if (error.code === 'CUP_RESULT_LOCKED') return '下一轮已进行，不能直接更改晋级结果。';
    if (error.code.includes('KNOCKOUT')) return '淘汰赛需要分出胜负，请核对比分。';
    if (error.status < 500) return `提交未通过，请刷新后核对记录及业务条件（${error.code}）。`;
  }
  return '未能确认提交结果。请重试同一笔提交，或关闭窗口后刷新核对，避免重复操作。';
}

export function ScoreEditor({ leagueId, match, api, onClose, onSaved }: Common & { match: CompetitionMatchResponse }) {
  const [home, setHome] = useState(match.officialResult ? String(match.officialResult.homeScore) : '');
  const [away, setAway] = useState(match.officialResult ? String(match.officialResult.awayScore) : '');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const key = useMutationKey();
  const body = { homeScore: Number(home), awayScore: Number(away), reason: reason.trim(), expectedVersion: match.version };
  const valid = /^\d{1,2}$/.test(home) && /^\d{1,2}$/.test(away) && ManagerMatchResultRequestSchema.safeParse(body).success;
  const save = async () => {
    if (!valid || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/competitions/${match.competitionId}/matches/${match.id}/results`, {
        method: 'POST', body, headers: { 'Idempotency-Key': key.current() }, schema: MatchResultVersionResponseSchema
      });
      onSaved();
    } catch (caught) { setError(failure(caught)); }
    finally { lock.current = false; setBusy(false); }
  };
  const edit = () => { key.reset(); setError(''); };
  return <Modal open title={(match.officialResult || match.advancement) ? '修正官方比分' : '录入官方比分'} onCancel={() => { if (!lock.current) onClose(); }} closable={!busy} mask={{ closable: false }} footer={null} className="mobile-modal">
    <div className="mobile-editor">
      <p>第 {match.roundNumber} 轮 · {teamName(match.homeParticipant)} 对 {teamName(match.awayParticipant)}</p>
      {match.officialResult && <p className="mobile-muted">原比分 {match.officialResult.homeScore} : {match.officialResult.awayScore}，修正后将重新计算相关赛果。</p>}
      {match.advancement && <Alert type="warning" title="本场已裁定晋级，提交比分将替换原晋级结果。" />}
      {error && <Alert role="alert" type="error" title={error} />}
      {preview ? <>
        <div className="mobile-score-preview"><span>{teamName(match.homeParticipant)}</span><strong>{home} : {away}</strong><span>{teamName(match.awayParticipant)}</span></div>
        <p>原因：{reason}</p><p className="mobile-muted">确认后保存为官方比分。</p>
        <Button block type="primary" loading={busy} onClick={() => void save()}>确认提交比分</Button>
        <Button block disabled={busy} onClick={() => { setPreview(false); }}>返回修改</Button>
      </> : <>
        <div className="mobile-score-fields">
          <label>主队比分<input aria-label="主队比分" inputMode="numeric" maxLength={2} value={home} onChange={(e) => { setHome(e.target.value); edit(); }} /></label>
          <span aria-hidden="true">:</span>
          <label>客队比分<input aria-label="客队比分" inputMode="numeric" maxLength={2} value={away} onChange={(e) => { setAway(e.target.value); edit(); }} /></label>
        </div>
        <label>录入或修正原因<textarea aria-label="录入或修正原因" maxLength={512} rows={3} placeholder="例如：已核对双方赛后截图" value={reason} onChange={(e) => { setReason(e.target.value); edit(); }} /></label>
        <Button block type="primary" disabled={!valid} onClick={() => setPreview(true)}>核对比分</Button>
      </>}
    </div>
  </Modal>;
}

export function TransferEditor({ leagueId, proposal, api, onClose, onSaved }: Common & { proposal: Proposal }) {
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const key = useMutationKey();
  const canReview = proposal.status === 'PENDING_ADMIN';
  const save = async () => {
    if (!canReview || !reason.trim() || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/transfer-proposals/${proposal.id}/review`, {
        method: 'POST', headers: { 'Idempotency-Key': key.current() }, schema: AdminTransferProposalSchema,
        body: { decision, reason: reason.trim(), expectedVersion: proposal.version }
      });
      onSaved();
    } catch (caught) { setError(failure(caught)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Modal open title="转会详情与审核" onCancel={() => { if (!lock.current) onClose(); }} closable={!busy} mask={{ closable: false }} footer={null} className="mobile-modal">
    <div className="mobile-editor">
      <h2>{proposal.playerName}</h2>
      <p>{proposal.sourceTeamNumber == null ? '' : `${proposal.sourceTeamNumber}号 · `}{proposal.sourceTeamName} → {proposal.targetTeamNumber == null ? '' : `${proposal.targetTeamNumber}号 · `}{proposal.targetTeamName}</p>
      <strong>约定报价：{proposal.amountMinor.toLocaleString('zh-CN')}</strong>
      <p>{transferStatus[proposal.status]} · {proposal.counterpartyConfirmed ? '双方已确认' : '等待对方确认'}</p>
      {proposal.reason && <p>申请说明：{proposal.reason}</p>}
      {error && <Alert role="alert" type="error" title={error} />}
      {canReview ? <>
        <p className="mobile-muted">批准时会重新校验转会窗口、球员归属、球队人数和工资帽。</p>
        <div className="mobile-segments" aria-label="审核决定">{(['APPROVE', 'REJECT'] as const).map((value) => <button key={value} disabled={busy} aria-pressed={decision === value} onClick={() => { setDecision(value); key.reset(); setError(''); }}>{value === 'APPROVE' ? '批准' : '驳回'}</button>)}</div>
        <label>审核理由<textarea aria-label="审核理由" rows={3} maxLength={512} disabled={busy} value={reason} onChange={(e) => { setReason(e.target.value); key.reset(); setError(''); }} /></label>
        <Button block type="primary" danger={decision === 'REJECT'} disabled={!reason.trim()} loading={busy} onClick={() => void save()}>确认{decision === 'APPROVE' ? '批准' : '驳回'}转会</Button>
      </> : <p>审核说明：{proposal.reviewReason ?? '暂无'}</p>}
      {proposal.events.length > 0 && <details><summary>处理记录</summary>{proposal.events.map((event) => <p key={event.id}>{formatDateTime(event.createdAt)} · {transferStatus[event.toStatus] ?? event.toStatus} · {event.reason ?? '无说明'}</p>)}</details>}
    </div>
  </Modal>;
}
