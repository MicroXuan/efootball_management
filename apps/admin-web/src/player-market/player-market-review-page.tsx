import { Alert, Avatar, Button, Card, Descriptions, Empty, Input, Modal, Select, Space, Tabs, Tag, Timeline, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { LeagueSeasonSummarySchema, PlayerApplicationListResponseSchema, type PlayerAcquisitionApplication, type PlayerApplicationStatus, type PlayerApplicationType } from '@efm/contracts';
import { z } from 'zod';
import { adminApi, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';
import { buildReviewGroups, reviewBlocker, type ReviewApplication } from './player-market-review.model';

const statusLabels: Record<PlayerApplicationStatus, string> = {
  PENDING: '待审核', APPROVED: '已通过', NOT_SELECTED: '未入选', REJECTED: '已驳回', WITHDRAWN: '已撤回',
  EXPIRED: '已过期', INELIGIBLE: '不符合资格', REQUOTE_REQUIRED: '待补价', OWNERSHIP_CHANGED: '归属已变化'
};
const eventLabels = { SUBMITTED: '提交申请', AMOUNT_CHANGED: '调整报价', WITHDRAWN: '撤回申请', APPROVED: '审核通过', REJECTED: '审核驳回', NOT_SELECTED: '未被选中', EXPIRED: '申请过期', REQUOTE_REQUIRED: '需要补价', OWNERSHIP_CHANGED: '归属变化', INELIGIBLE: '资格失效' } as const;
const ReviewResultSchema = z.object({ applicationId: z.string(), status: z.enum(['APPROVED', 'REJECTED', 'REQUOTE_REQUIRED', 'OWNERSHIP_CHANGED', 'INELIGIBLE']), transactionId: z.string().nullable(), transactionType: z.enum(['BUY', 'FORCED_TRANSFER']).nullable(), ownershipId: z.string().nullable() });
const money = (value: number | null) => value === null ? '—' : value.toLocaleString('zh-CN');

export function PlayerMarketReviewPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const seasonId = params.get('seasonId') ?? '';
  const [items, setItems] = useState<PlayerAcquisitionApplication[]>([]);
  const [type, setType] = useState<PlayerApplicationType>('NORMAL_PURCHASE');
  const [status, setStatus] = useState<'ALL' | PlayerApplicationStatus>('ALL');
  const [review, setReview] = useState<{ item: ReviewApplication; action: 'approve' | 'reject' } | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useMutationKey();

  useEffect(() => {
    if (seasonId) return;
    void api.request(`/v1/admin/leagues/${leagueId}/roster-seasons`, { schema: z.array(LeagueSeasonSummarySchema) })
      .then((seasons) => { if (seasons[0]) setParams({ seasonId: seasons[0].id }, { replace: true }); })
      .catch(() => setError('赛季加载失败，请刷新后重试'));
  }, [api, leagueId, seasonId, setParams]);

  const load = useCallback(async () => {
    if (!seasonId) return;
    try {
      const query = new URLSearchParams({ seasonId, scope: 'PUBLIC', limit: '100' });
      if (status !== 'ALL') query.set('status', status);
      setItems((await api.request(`/v1/admin/leagues/${leagueId}/player-market-applications?${query}`, { schema: PlayerApplicationListResponseSchema })).items);
      setError(null);
    } catch { setError('球员申请加载失败，请检查赛季和管理权限'); }
  }, [api, leagueId, seasonId, status]);
  useEffect(() => { void load(); }, [load]);

  const groups = useMemo(() => buildReviewGroups(items.filter((item) => item.type === type && (status === 'ALL' || item.status === status))), [items, status, type]);
  const submit = async () => {
    if (!review || !reason.trim()) return;
    setBusy(true);
    try {
      await api.request(`/v1/admin/player-market-applications/${review.item.id}/${review.action}`, {
        method: 'POST', headers: { 'Idempotency-Key': key.current() }, schema: ReviewResultSchema,
        body: { expectedVersion: review.item.version, reason: reason.trim() }
      });
      key.reset(); setReview(null); setReason(''); await load();
    } catch { setError('审核未提交：申请状态或成交条件可能已变化，请刷新后复核'); }
    finally { setBusy(false); }
  };
  const openReview = (item: ReviewApplication, action: 'approve' | 'reject') => { setReview({ item, action }); setReason(''); key.reset(); };

  return <section className="player-market-review-page">
    <Card className="market-command-card">
      <div className="market-command-heading"><div><span className="section-kicker">公开交易审核</span><h2>球员申请</h2><p>普通购买可择优通过；强报严格按首次有效提交时间逐笔处理。</p></div><div className="market-command-count"><strong>{items.filter((item) => item.status === 'PENDING').length}</strong><span>待复核</span></div></div>
      {error ? <Alert role="alert" type="warning" showIcon title={error} /> : null}
      <div className="market-review-toolbar">
        <Tabs activeKey={type} onChange={(value) => setType(value as PlayerApplicationType)} items={[{ key: 'NORMAL_PURCHASE', label: '普通购买' }, { key: 'FORCED_TRANSFER', label: '强报队列' }]} />
        <Select aria-label="申请状态" value={status} onChange={setStatus} options={[{ value: 'ALL', label: '全部状态' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} />
      </div>
      {groups.length ? <div className="market-review-groups">{groups.map((group) => <article className="market-review-group" key={group.playerId}>
        <header><div><span className="market-review-eyebrow">{type === 'FORCED_TRANSFER' ? '强报顺位' : '同球员申请'}</span><h3>{group.playerName}</h3></div><Tag color={type === 'FORCED_TRANSFER' ? 'gold' : 'green'}>{group.applications.length} 笔</Tag></header>
        <div className="market-review-applications">{group.applications.map((item) => <ApplicationCard key={item.id} item={item} onReview={openReview} />)}</div>
      </article>)}</div> : <Empty description="当前筛选条件下没有申请" />}
    </Card>
    <Modal open={review !== null} title={review?.action === 'approve' ? '确认通过申请' : '确认驳回申请'} okText={review?.action === 'approve' ? '确认通过' : '确认驳回'} cancelText="取消" confirmLoading={busy} okButtonProps={{ disabled: !reason.trim() }} onOk={() => void submit()} onCancel={() => setReview(null)}>
      {review ? <><Descriptions size="small" column={2} items={[{ key: 'player', label: '球员', children: review.item.playerName }, { key: 'team', label: '申请球队', children: review.item.applicantTeam.name }, { key: 'value', label: '官方身价', children: money(review.item.valuationMinorSnapshot) }, { key: 'amount', label: '申请金额', children: money(review.item.amountMinor) }, { key: 'salary', label: '工资', children: money(review.item.playerCard.salaryMinor) }, { key: 'card', label: '球员卡', children: review.item.playerCard.cardName }]} /><label className="modal-field-label" htmlFor="player-review-reason">审核原因</label><Input.TextArea id="player-review-reason" value={reason} onChange={(event) => { setReason(event.target.value); key.reset(); }} maxLength={512} placeholder="说明通过或驳回依据，所有参赛球队可查看" /></> : null}
    </Modal>
  </section>;
}

function ApplicationCard({ item, onReview }: { item: ReviewApplication; onReview(item: ReviewApplication, action: 'approve' | 'reject'): void }) {
  const blocker = reviewBlocker(item);
  return <section className={`market-application-card${item.canReview ? ' is-actionable' : ''}`}>
    <div className="market-application-main"><Avatar shape="square" size={56} src={item.applicantTeam.logoUrl}>{item.applicantTeam.teamNumber ?? '队'}</Avatar><div><strong>{item.applicantTeam.teamNumber ? `${item.applicantTeam.teamNumber} · ` : ''}{item.applicantTeam.name}</strong><span>{item.applicantTeam.ownerAlias}{item.sourceTeam ? ` · 强报自 ${item.sourceTeam.name}` : ''}</span></div><div className="market-application-price"><small>申请金额</small><b>{money(item.amountMinor)}</b></div></div>
    <div className="market-application-facts"><span>官方身价 {money(item.valuationMinorSnapshot)}</span><span>工资 {money(item.playerCard.salaryMinor)}</span><span>{item.playerCard.position} · AT {item.playerCard.maxOverall ?? '—'}</span><Tag color={item.status === 'PENDING' ? 'processing' : 'default'}>{statusLabels[item.status]}</Tag></div>
    {blocker ? <Alert type="warning" showIcon title={blocker} /> : item.type === 'FORCED_TRANSFER' && !item.canReview ? <Alert type="info" showIcon title="需先处理更早提交的强报" /> : null}
    {item.events.length ? <Timeline className="market-application-timeline" items={item.events.map((event) => ({ content: <span>{eventLabels[event.type]} · {event.actorDisplayName}{event.fromAmountMinor !== null || event.toAmountMinor !== null ? ` · ${money(event.fromAmountMinor)} → ${money(event.toAmountMinor)}` : ''}</span> }))} /> : null}
    <Space><Button type="primary" disabled={!item.canReview} onClick={() => onReview(item, 'approve')}>通过申请</Button><Button danger disabled={item.status !== 'PENDING'} onClick={() => onReview(item, 'reject')}>驳回申请</Button></Space>
  </section>;
}
