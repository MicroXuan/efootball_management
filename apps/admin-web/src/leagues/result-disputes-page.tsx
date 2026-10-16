import {
  AdminMatchResultDisputeListResponseSchema, AdminMatchResultDisputeResponseSchema,
  CreateEvidenceUploadResponseSchema, LeagueDetailSchema,
  type AdminMatchResultDisputeResponse, type LeagueDetail
} from '@efm/contracts';
import { Alert, Button, Card, Drawer, Empty, Input, InputNumber, Radio, Spin, Switch, Tag, Upload } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import { ApiError, adminApi, type AdminApi } from '../lib/api';

const typeLabels = { REJECTED: '拒绝确认', CONFIRMATION_TIMEOUT: '确认超时' };
const statusLabels = { EVIDENCE_COLLECTION: '补证中', READY_FOR_REVIEW: '待裁决', RESOLVED: '已裁决', CANCELLED: '已取消' };
const roleLabels = { SUBMITTER: '比分提交方', OPPONENT: '对方', ADMIN: '管理员' };
const eventLabels: Record<string, string> = {
  RESULT_SUBMITTED: '提交比分', RESULT_CONFIRMED: '确认比分', RESULT_REJECTED: '拒绝比分',
  CONFIRMATION_EXPIRED: '确认期限届满', DISPUTE_OPENED: '发起争议', EVIDENCE_UPLOADED: '上传证据',
  EVIDENCE_REPLACED: '更换证据', EVIDENCE_DEADLINE_EXPIRED: '补证期限届满',
  ADMIN_DECIDED: '管理员裁决', EVIDENCE_DELETED: '证据清理'
};
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const readUrlSchema = z.object({ url: z.url(), expiresAt: z.iso.datetime() });
const completedSchema = z.object({ id: z.string(), status: z.literal('UPLOADED') });
const resultSchema = z.object({ id: z.string() });

function date(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
function missingRoles(item: AdminMatchResultDisputeResponse) {
  return item.missingRoles ?? (['SUBMITTER', 'OPPONENT'] as const)
    .filter((role) => !item.evidence.some((evidence) => evidence.role === role && evidence.status === 'ACTIVE'));
}
function score(detail: AdminMatchResultDisputeResponse) {
  const event = detail.timeline.find((item) => item.type === 'RESULT_SUBMITTED' && item.resultVersionId === detail.triggerResultVersionId);
  const home = event?.metadata?.homeScore;
  const away = event?.metadata?.awayScore;
  return typeof home === 'number' && typeof away === 'number' ? `${home} : ${away}` : '比分记录不可用';
}
function rejectedReason(detail: AdminMatchResultDisputeResponse) {
  const event = detail.timeline.find((item) => item.type === 'RESULT_REJECTED' && item.resultVersionId === detail.triggerResultVersionId);
  return typeof event?.metadata?.reason === 'string' ? event.metadata.reason : null;
}
function rank(item: AdminMatchResultDisputeResponse) {
  if (item.status === 'READY_FOR_REVIEW' || (item.status === 'EVIDENCE_COLLECTION' && new Date(item.evidenceDeadlineAt) <= new Date())) return 0;
  return item.status === 'EVIDENCE_COLLECTION' ? 1 : 2;
}

export function ResultDisputesPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [queue, setQueue] = useState<AdminMatchResultDisputeResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingBusy, setSettingBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminMatchResultDisputeResponse | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [decision, setDecision] = useState<'USE_SUBMITTED_SCORE' | 'REPLACE_SCORE'>('USE_SUBMITTED_SCORE');
  const [homeScore, setHomeScore] = useState<number | null>(null);
  const [awayScore, setAwayScore] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState<string | null>(null);
  const requestSerial = useRef(0);
  const previewSerial = useRef(0);
  const previewRef = useRef<typeof preview>(null);

  const clearPreview = useCallback(() => {
    previewSerial.current += 1;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
    previewRef.current = null;
    setPreview(null);
    setPreviewBusy(null);
  }, []);
  useEffect(() => () => {
    previewSerial.current += 1;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
    previewRef.current = null;
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextLeague, nextQueue] = await Promise.all([
        api.request(`/v1/admin/leagues/${leagueId}/workspace`, { schema: LeagueDetailSchema }),
        api.request(`/v1/admin/leagues/${leagueId}/result-disputes`, { schema: AdminMatchResultDisputeListResponseSchema })
      ]);
      setLeague(nextLeague);
      setQueue([...nextQueue].sort((a, b) => rank(a) - rank(b) || a.evidenceDeadlineAt.localeCompare(b.evidenceDeadlineAt)));
    } catch { setError('争议队列加载失败，请重试。'); }
    finally { setLoading(false); }
  }, [api, leagueId]);
  useEffect(() => { void load(); }, [load]);

  const loadDetail = useCallback(async (id: string) => {
    const serial = ++requestSerial.current;
    setDetailBusy(true); setDetailError(null);
    try {
      const next = await api.request(`/v1/admin/leagues/${leagueId}/result-disputes/${id}`, { schema: AdminMatchResultDisputeResponseSchema });
      if (serial === requestSerial.current) setDetail(next);
    } catch {
      if (serial === requestSerial.current) setDetailError('争议详情加载失败，请重试。');
    } finally { if (serial === requestSerial.current) setDetailBusy(false); }
  }, [api, leagueId]);
  const open = (id: string) => {
    clearPreview(); setSelectedId(id); setDetail(null); setDecision('USE_SUBMITTED_SCORE');
    setHomeScore(null); setAwayScore(null); setReason(''); setFile(null); void loadDetail(id);
  };
  const close = () => { requestSerial.current += 1; clearPreview(); setSelectedId(null); setDetail(null); setDetailError(null); setFile(null); };

  const toggleEvidence = async (checked: boolean) => {
    if (!league || settingBusy) return;
    setSettingBusy(true); setError(null); setNotice(null);
    try {
      const updated = await api.request(`/v1/admin/leagues/${leagueId}/workspace`, {
        method: 'PATCH', headers: { 'Idempotency-Key': crypto.randomUUID() },
        schema: LeagueDetailSchema, body: { resultEvidenceRequired: checked, expectedVersion: league.version }
      });
      setLeague(updated); setNotice(checked ? '已开启每场比分截图要求。' : '已关闭每场比分截图要求。');
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') {
        try { setLeague(await api.request(`/v1/admin/leagues/${leagueId}/workspace`, { schema: LeagueDetailSchema })); }
        catch { /* Keep the current value and ask for reload. */ }
        setError('联赛设置已被其他管理员更新，请确认最新状态后重试。');
      } else setError('截图要求保存失败，请重试。');
    } finally { setSettingBusy(false); }
  };

  const previewEvidence = async (evidenceId: string) => {
    if (!detail || !api.transferEvidence) { setDetailError('此浏览器暂时无法预览证据，请重试。'); return; }
    clearPreview(); const serial = ++previewSerial.current; setPreviewBusy(evidenceId); setDetailError(null);
    try {
      const grant = await api.request(`/v1/admin/leagues/${leagueId}/result-disputes/${detail.id}/evidence/${evidenceId}/read-url`, { schema: readUrlSchema });
      const blob = await api.transferEvidence(grant.url);
      if (!blob) throw new Error('Empty image');
      const url = URL.createObjectURL(blob);
      if (serial !== previewSerial.current) { URL.revokeObjectURL(url); return; }
      previewRef.current = { id: evidenceId, url }; setPreview(previewRef.current);
    } catch { if (serial === previewSerial.current) setDetailError('证据预览失败，请重新打开。'); }
    finally { if (serial === previewSerial.current) setPreviewBusy(null); }
  };

  const uploadEvidence = async (current: AdminMatchResultDisputeResponse, chosen: File) => {
    if (!api.transferEvidence) throw new Error('Upload unavailable');
    const checksum = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await chosen.arrayBuffer())))
      .map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const base = `/v1/admin/leagues/${leagueId}/matches/${current.matchId}/result-evidence/uploads`;
    const grant = await api.request(base, { method: 'POST', schema: CreateEvidenceUploadResponseSchema, body: {
      role: 'ADMIN', mimeType: chosen.type, byteSize: chosen.size, checksumSha256: checksum, expectedVersion: current.matchVersion
    } });
    await api.transferEvidence(grant.uploadUrl, chosen, grant.headers);
    await api.request(`${base}/${grant.id}/complete`, { method: 'POST', schema: completedSchema, body: { expectedVersion: current.matchVersion } });
    return grant.id;
  };

  const resolve = async () => {
    if (!detail || submitting) return;
    const trimmed = reason.trim();
    if (!trimmed) { setDetailError('请填写裁决原因。'); return; }
    if (trimmed.length > 512) { setDetailError('裁决原因不能超过 512 字。'); return; }
    if (decision === 'REPLACE_SCORE' && (homeScore === null || awayScore === null || !Number.isInteger(homeScore)
      || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0 || homeScore > 99 || awayScore > 99)) {
      setDetailError('请填写 0–99 的双方整数比分。'); return;
    }
    setSubmitting(true); setDetailError(null); setNotice(null);
    try {
      const evidenceUploadId = file ? await uploadEvidence(detail, file) : undefined;
      await api.request(`/v1/admin/leagues/${leagueId}/result-disputes/${detail.id}/resolve`, {
        method: 'POST', schema: resultSchema,
        body: { decisionType: decision, reason: trimmed,
          ...(decision === 'REPLACE_SCORE' ? { homeScore, awayScore } : {}),
          ...(evidenceUploadId ? { evidenceUploadId } : {}), expectedVersion: detail.matchVersion }
      });
      setNotice('裁决已记录。'); setFile(null); clearPreview();
      await Promise.all([load(), loadDetail(detail.id)]);
    } catch (caught) {
      if (caught instanceof ApiError && (caught.code === 'VERSION_CONFLICT' || caught.code === 'MATCH_VERSION_CONFLICT')) {
        await loadDetail(detail.id);
        setDetailError('比赛已更新，已重新读取详情。请核对裁决内容后重试。');
      } else setDetailError('裁决未提交，请检查证据与网络后重试。');
    } finally { setSubmitting(false); }
  };

  return <section className="result-disputes-page">
    <header className="workspace-page-title"><span className="section-kicker">联赛工作区 / 赛果争议</span><h1>赛果争议</h1><p>先核对证据与时间线，再记录最终比分。</p></header>
    {error ? <Alert role="alert" type="error" showIcon title={error} action={<Button size="small" onClick={() => void load()}>重试</Button>} /> : null}
    {notice ? <Alert role="status" type="success" showIcon title={notice} /> : null}
    <Card className="data-card dispute-setting" title="比分截图要求">
      <div><p>默认关闭，开启后每场由比分提交方上传 1 张截图</p><span>适用于本联赛所有赛事。</span></div>
      <Switch aria-label="强制比分截图" checked={league?.resultEvidenceRequired ?? false} loading={settingBusy}
        disabled={!league || settingBusy} onChange={(checked) => void toggleEvidence(checked)} />
    </Card>
    <Card className="data-card dispute-queue" title="争议队列" extra={<Button onClick={() => void load()} disabled={loading}>刷新队列</Button>}>
      {loading ? <div className="loading-block"><Spin /><span>正在读取争议队列…</span></div>
        : queue.length === 0 ? <Empty description="当前没有争议。新争议会出现在这里。" />
          : <div className="dispute-queue-list" role="list">{queue.map((item) => <article key={item.id} role="listitem" className="dispute-queue-row">
            <div className="dispute-queue-row__main"><div className="dispute-queue-row__labels">
              <Tag color={item.status === 'READY_FOR_REVIEW' ? 'processing' : item.status === 'EVIDENCE_COLLECTION' ? 'warning' : 'default'}>{statusLabels[item.status]}</Tag>
              <span>{typeLabels[item.trigger]}</span></div><strong>比赛 {item.matchId.slice(0, 8)}</strong><small>争议 {item.id.slice(0, 8)}</small></div>
            <div className="dispute-queue-row__signal"><span>补证截止</span><strong>{date(item.evidenceDeadlineAt)}</strong></div>
            <div className="dispute-queue-row__signal"><span>缺证方</span><strong>{missingRoles(item).length ? missingRoles(item).map((role) => roleLabels[role]).join('、') : '双方已齐'}</strong></div>
            <Button aria-label={`查看争议 ${item.id.slice(0, 8)}`} onClick={() => open(item.id)}>查看争议</Button>
          </article>)}</div>}
    </Card>
    <Drawer title="争议详情与裁决" open={Boolean(selectedId)} onClose={close} size="min(720px, 100vw)" destroyOnHidden>
      {detailError ? <Alert role="alert" type="error" showIcon title={detailError} className="dispute-alert" /> : null}
      {detailBusy ? <div className="loading-block"><Spin /><span>正在读取争议详情…</span></div>
        : !detail ? <Empty description="详情不可用，请重试。" ><Button onClick={() => selectedId && void loadDetail(selectedId)}>重试读取详情</Button></Empty>
          : <div className="dispute-detail">
            <div className="dispute-detail__summary"><Tag>{statusLabels[detail.status]}</Tag><Tag>{typeLabels[detail.trigger]}</Tag><span>比赛 {detail.matchId.slice(0, 8)}</span></div>
            <div className="dispute-detail__score"><span>提交比分</span><strong>{score(detail)}</strong></div>
            {rejectedReason(detail) ? <div className="dispute-detail__reason"><span>拒绝原因</span><p>{rejectedReason(detail)}</p></div> : null}
            <div className="dispute-evidence-rail" aria-label="双方证据状态">{(['SUBMITTER', 'OPPONENT'] as const).map((role) => {
              const present = detail.evidence.some((item) => item.role === role && item.status === 'ACTIVE');
              return <div key={role} className={present ? 'is-present' : 'is-missing'}><span>{roleLabels[role]}</span><strong>{present ? '已提交' : '未提交'}</strong></div>;
            })}</div>
            {missingRoles(detail).length ? <Alert type="warning" showIcon title={`缺少${missingRoles(detail).map((role) => roleLabels[role]).join('、')}证据，请在裁决前核对时间线。`} /> : null}
            <section><h3>证据</h3>{detail.evidence.length ? detail.evidence.map((item) => <div key={item.id} className="dispute-evidence-row">
              <div><strong>{roleLabels[item.role]} · {item.status === 'ACTIVE' ? '有效' : item.status === 'PENDING_DELETE' ? '待清理' : '已清理'}</strong>
                <small>{item.mimeType} · {Math.ceil(item.byteSize / 1024)} KiB · {date(item.createdAt)}</small></div>
              {item.status !== 'DELETED' ? <Button size="small" loading={previewBusy === item.id} onClick={() => void previewEvidence(item.id)}>预览证据</Button> : null}
            </div>) : <p className="dispute-muted">暂无证据。</p>}
              {preview ? <div className="dispute-preview"><Button size="small" onClick={clearPreview}>关闭预览</Button><img src={preview.url} alt="争议证据预览" /></div> : null}
            </section>
            <section><h3>事件时间线</h3><ol className="dispute-timeline">{detail.timeline.map((event) => <li key={event.id}>
              <time>{date(event.occurredAt)}</time><strong>{eventLabels[event.type] ?? event.type}</strong>
              <span>{event.actorType === 'USER' ? '参赛方' : event.actorType === 'ADMIN' ? '管理员' : '系统'}</span>
              {typeof event.metadata?.reason === 'string' ? <p>{event.metadata.reason}</p> : null}
            </li>)}</ol></section>
            {(detail.status === 'READY_FOR_REVIEW' || (detail.status === 'EVIDENCE_COLLECTION' && new Date(detail.evidenceDeadlineAt) <= new Date())) ? <section className="dispute-decision"><h3>记录裁决</h3>
              <Radio.Group aria-label="裁决类型" value={decision} onChange={(event) => setDecision(event.target.value)}>
                <Radio value="USE_SUBMITTED_SCORE">采用提交比分</Radio><Radio value="REPLACE_SCORE">替换比分</Radio>
              </Radio.Group>
              {decision === 'REPLACE_SCORE' ? <div className="dispute-score-fields"><label>主队比分<InputNumber aria-label="主队比分" min={0} max={99} precision={0} value={homeScore} onChange={setHomeScore} /></label>
                <label>客队比分<InputNumber aria-label="客队比分" min={0} max={99} precision={0} value={awayScore} onChange={setAwayScore} /></label></div> : null}
              <label>裁决原因<Input.TextArea aria-label="裁决原因" value={reason} maxLength={512} rows={3} onChange={(event) => setReason(event.target.value)} /></label>
              <div><span>管理员补充证据（可选，JPG / PNG / WebP，≤ 1 MiB）</span><Upload accept="image/jpeg,image/png,image/webp" maxCount={1}
                fileList={file ? [{ uid: 'admin-evidence', name: file.name, status: 'done' }] : []}
                beforeUpload={(candidate) => {
                  if (!imageTypes.has(candidate.type) || candidate.size < 1 || candidate.size > 1_048_576) {
                    setDetailError('证据仅支持 JPG、PNG、WebP，大小不超过 1 MiB。'); return Upload.LIST_IGNORE;
                  }
                  setDetailError(null); setFile(candidate); return false;
                }} onRemove={() => { setFile(null); return true; }}><Button>选择证据图片</Button></Upload></div>
              <Button type="primary" loading={submitting} disabled={submitting} onClick={() => void resolve()}>确认裁决</Button>
            </section> : detail.status === 'RESOLVED' ? <Alert type="success" showIcon title={`已裁决 · ${detail.finalHomeScore ?? '—'} : ${detail.finalAwayScore ?? '—'}`} description={detail.decisionReason} /> : null}
          </div>}
    </Drawer>
  </section>;
}
