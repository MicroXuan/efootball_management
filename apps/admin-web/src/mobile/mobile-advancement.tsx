import { Alert, Button, Modal } from 'antd';
import { useRef, useState } from 'react';
import { AdminMatchAdvancementRequestSchema, AdminMatchAdvancementResponseSchema, type CompetitionMatchResponse } from '@efm/contracts';
import type { AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';
import { teamName } from './mobile-data';
import { failure } from './mobile-editors';

export function AdvancementEditor({ leagueId, match, api, onClose, onSaved }: {
  leagueId: string; match: CompetitionMatchResponse; api: AdminApi; onClose(): void; onSaved(): void;
}) {
  const [winner, setWinner] = useState('');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const key = useMutationKey();
  const body = { winnerParticipantId: winner, expectedVersion: match.version, reason: reason.trim() };
  const selected = [match.homeParticipant, match.awayParticipant].find((team) => team.id === winner);
  const valid = Boolean(selected) && AdminMatchAdvancementRequestSchema.safeParse(body).success;
  const edit = () => { key.reset(); setError(''); };
  async function save() {
    if (!valid || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/competitions/${match.competitionId}/matches/${match.id}/advancement`, {
        method: 'POST', body, headers: { 'Idempotency-Key': key.current() }, schema: AdminMatchAdvancementResponseSchema
      });
      onSaved();
    } catch (caught) { setError(failure(caught)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Modal open title="裁定晋级" className="mobile-modal" footer={null} closable={!busy} mask={{ closable: false }} onCancel={() => { if (!lock.current) onClose(); }}>
    <div className="mobile-editor">
      <p>{teamName(match.homeParticipant)} 对 {teamName(match.awayParticipant)}</p>
      <p className="mobile-muted">用于弃权等情况，裁定后不记录比分，并按赛事规则推进签表。</p>
      {(match.officialResult || match.advancement) && <Alert type="warning" title="此比赛已有赛果，本次裁定将替换原结果。" />}
      {error && <Alert role="alert" type="error" title={error} />}
      {preview ? <>
        <div className="mobile-decision-preview"><small>晋级球队</small><strong>{selected && teamName(selected)}</strong><p>原因：{reason}</p></div>
        <Button block type="primary" loading={busy} onClick={() => void save()}>确认裁定晋级</Button>
        <Button block disabled={busy} onClick={() => setPreview(false)}>返回修改</Button>
      </> : <>
        <fieldset className="mobile-winner-options"><legend>选择晋级球队</legend>{[match.homeParticipant, match.awayParticipant].map((team, index) => <label key={team.id}>
          <input type="radio" name="advancement-winner" checked={winner === team.id} onChange={() => { setWinner(team.id); edit(); }} />
          <span><small>{index === 0 ? '主队' : '客队'}</small>{teamName(team)}</span>
        </label>)}</fieldset>
        <label>裁定原因<textarea aria-label="裁定原因" rows={3} maxLength={512} value={reason} placeholder="例如：客队确认弃权" onChange={(event) => { setReason(event.target.value); edit(); }} /></label>
        <Button block type="primary" disabled={!valid} onClick={() => setPreview(true)}>核对晋级</Button>
      </>}
    </div>
  </Modal>;
}
