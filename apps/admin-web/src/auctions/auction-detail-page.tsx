import { Alert, Button, Card, Empty, Input, InputNumber, Popconfirm, Radio, Select, Spin, Table, Tag } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  LeagueTeamListResponseSchema,
  PlayerAuctionBatchDetailSchema,
  type LeagueTeamSummary,
  type PlayerAuctionBatchDetail
} from '@efm/contracts';
import { z } from 'zod';
import { ApiError, adminApi, type AdminApi } from '../lib/api';

type ReviewDecision = 'CONFIRM' | 'ADJUST' | 'VOID';

const reviewResponseSchema = z.object({ lotId: z.string(), status: z.string(), review: z.unknown() });
const statusLabel: Record<string, string> = {
  DRAFT: '草稿', READY: '待群内开始', ACTIVE: '进行中', PAUSED: '已暂停', COMPLETED: '已结束',
  CANCELLED: '已取消', RECOVERY_REQUIRED: '需要人工恢复', QUEUED: '等待中', PENDING_REVIEW: '待审核',
  REVIEWED: '已确认', VOID: '已作废', NO_BID: '无人出价'
};
const resultLabel: Record<string, string> = {
  VALID: '有效', BELOW_STARTING_PRICE: '低于起拍价', BELOW_MINIMUM_INCREMENT: '未达到最低加价',
  UNBOUND: '用户未绑定', NO_ACTIVE_TEAM: '无有效球队', WRONG_LEAGUE: '球队不属于本联赛', INACTIVE: '非拍卖时段',
  PAUSED: '拍卖暂停', RECOVERY_REQUIRED: '等待恢复', DEADLINE_PASSED: '已过截止时间', DUPLICATE: '重复消息', OVERFLOW: '金额超限'
};
const requestKey = () => crypto.randomUUID();

export function AuctionDetailPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '', batchId = '' } = useParams();
  const [batch, setBatch] = useState<PlayerAuctionBatchDetail | null>(null);
  const [teams, setTeams] = useState<LeagueTeamSummary[] | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busyLotId, setBusyLotId] = useState<string>();
  const [decisionByLot, setDecisionByLot] = useState<Record<string, ReviewDecision>>({});
  const [teamByLot, setTeamByLot] = useState<Record<string, string>>({});
  const [priceByLot, setPriceByLot] = useState<Record<string, number>>({});
  const [reasonByLot, setReasonByLot] = useState<Record<string, string>>({});
  const [cancelReason, setCancelReason] = useState('管理员取消拍卖');

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setBatch(await api.request(`/v1/admin/leagues/${leagueId}/player-auctions/${batchId}`, { schema: PlayerAuctionBatchDetailSchema }));
    } catch { setError('拍卖详情加载失败，请重试'); }
  }, [api, batchId, leagueId]);
  useEffect(() => { void load(); }, [load]);

  const loadTeams = useCallback(async () => {
    if (teams) return;
    try {
      const response = await api.request(`/v1/admin/leagues/${leagueId}/teams?status=ACTIVE`, { schema: LeagueTeamListResponseSchema });
      setTeams(response.items);
    } catch { setError('球队列表加载失败，暂时无法调整归属'); }
  }, [api, leagueId, teams]);

  const pendingCount = useMemo(() => batch?.lots.filter((lot) => ['PENDING_REVIEW', 'NO_BID'].includes(lot.status)).length ?? 0, [batch]);
  const submitReview = async (lot: PlayerAuctionBatchDetail['lots'][number]) => {
    const decision = decisionByLot[lot.id] ?? 'CONFIRM';
    const reason = reasonByLot[lot.id]?.trim();
    const reviewedPrice = priceByLot[lot.id] ?? lot.currentPrice ?? lot.startingPrice;
    if (decision === 'ADJUST' && (!teamByLot[lot.id] || !reviewedPrice || !reason)) {
      setError('调整结果时必须选择球队、填写价格和原因'); return;
    }
    if (decision === 'VOID' && !reason) { setError('作废结果必须填写原因'); return; }
    setBusyLotId(lot.id); setError(undefined); setNotice(undefined);
    const body = decision === 'ADJUST'
      ? { decision, expectedVersion: lot.version, reviewedTeamId: teamByLot[lot.id], reviewedPrice, reason }
      : { decision, expectedVersion: lot.version, ...(reason ? { reason } : {}) };
    try {
      await api.request(`/v1/admin/leagues/${leagueId}/player-auctions/${batchId}/lots/${lot.id}/review`, {
        method: 'POST', headers: { 'Idempotency-Key': requestKey() }, schema: reviewResponseSchema, body
      });
      setNotice(`${lot.playerName}的拍卖结果已记录。`); await load();
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === 'VERSION_CONFLICT' ? '结果已被其他管理员处理，页面已刷新' : '审核提交失败，输入内容已保留');
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') await load();
    } finally { setBusyLotId(undefined); }
  };
  const cancelBatch = async () => {
    if (!batch) return;
    if (!cancelReason.trim()) { setError('取消拍卖必须填写原因'); return; }
    setBusyLotId('cancel'); setError(undefined); setNotice(undefined);
    try {
      const updated = await api.request(`/v1/admin/leagues/${leagueId}/player-auctions/${batchId}/cancel`, {
        method: 'POST', headers: { 'Idempotency-Key': requestKey() }, schema: PlayerAuctionBatchDetailSchema,
        body: { expectedVersion: batch.version, reason: cancelReason.trim() }
      });
      setBatch(updated); setNotice('拍卖已取消，微信群不会再接受本批次出价。');
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === 'VERSION_CONFLICT' ? '拍卖状态已变化，请刷新后再操作' : '取消拍卖失败');
    } finally { setBusyLotId(undefined); }
  };

  if (!batch && !error) return <div className="loading-block"><Spin /><span>正在读取拍卖记录…</span></div>;
  if (!batch) return <Alert role="alert" type="error" showIcon title={error} action={<Button onClick={() => void load()}>重试</Button>} />;
  return <div className="auction-detail-page">
    <header className="auction-page__header"><div><span className="section-kicker">人工拍卖审核台</span><h2>{batch.name}</h2><p>微信群负责实时出价，管理台保留完整记录并由管理员确认最终结果。</p></div><div className="auction-header-actions">{batch.status === 'DRAFT' ? <Link className="ant-btn" to={`/leagues/${leagueId}/auctions/${batch.id}/edit`}>编辑草稿</Link> : null}<Button onClick={() => void load()}>刷新</Button><Tag color={batch.status === 'ACTIVE' ? 'processing' : batch.status === 'RECOVERY_REQUIRED' ? 'error' : batch.status === 'COMPLETED' ? 'success' : 'default'}>{statusLabel[batch.status] ?? batch.status}</Tag></div></header>
    {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}{notice ? <Alert role="status" type="success" showIcon title={notice} /> : null}
    <Alert className="auction-review-boundary" type="info" showIcon title="审核只记录结果，不会自动修改资金或阵容。" description={`当前有 ${pendingCount} 位球员等待人工审核；每轮结束后系统会自动进入下一位或结束批次，审核不会阻塞拍卖。`} />
    {!['COMPLETED', 'CANCELLED'].includes(batch.status) ? <Card className="auction-cancel-card" title="终止本批次"><div><p>仅在误建批次或无法继续时使用，取消后不可恢复。</p><Input aria-label="取消原因" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></div><Popconfirm title="确认取消整个拍卖批次？" description="该操作会立即停止本批次，且不能撤销。" okText="确认取消" cancelText="返回" onConfirm={() => void cancelBatch()}><Button danger loading={busyLotId === 'cancel'}>取消拍卖</Button></Popconfirm></Card> : null}
    <div className="auction-lot-rail" aria-label="拍卖球员顺序">{batch.lots.map((lot) => <a key={lot.id} href={`#lot-${lot.id}`} className={lot.id === batch.currentLotId ? 'is-current' : ''}><span>{String(lot.displayOrder).padStart(2, '0')}</span><strong>{lot.playerName}</strong><small>{statusLabel[lot.status] ?? lot.status}</small></a>)}</div>
    {batch.lots.length === 0 ? <Card><Empty description="尚未配置拍卖球员" /></Card> : batch.lots.map((lot) => {
      const decision = decisionByLot[lot.id] ?? 'CONFIRM';
      return <Card id={`lot-${lot.id}`} key={lot.id} className={`auction-review-card ${lot.id === batch.currentLotId ? 'is-current' : ''}`} title={<span><small>第 {lot.displayOrder} 位</small>{lot.playerName}</span>} extra={<Tag>{statusLabel[lot.status] ?? lot.status}</Tag>}>
        <div className="auction-result-summary"><div><span>起拍价</span><strong>⭐{lot.startingPrice}⭐</strong></div><div><span>最低加价</span><strong>⭐{lot.minimumIncrement}⭐</strong></div><div><span>计算成交价</span><strong>{lot.currentPrice ? `⭐${lot.currentPrice}⭐` : '—'}</strong></div><div><span>计算中标球队</span><strong>{lot.bids.find((bid) => bid.id === lot.currentHighestBidId)?.teamName ?? '—'}</strong></div></div>
        <Table className="auction-bid-table" rowKey="id" size="small" pagination={false} dataSource={lot.bids} locale={{ emptyText: '暂无出价记录' }} columns={[
          { title: '微信群时间', dataIndex: 'wechatSentAt', render: (value: string) => new Date(value).toLocaleString('zh-CN') },
          { title: '球队', dataIndex: 'teamName', render: (value: string | null) => value ?? '未识别' },
          { title: '出价', dataIndex: 'amount', render: (value: number) => `⭐${value}⭐` },
          { title: '判定', dataIndex: 'result', render: (value: string) => <Tag color={value === 'VALID' ? 'success' : 'default'}>{resultLabel[value] ?? value}</Tag> }
        ]} />
        {lot.review ? <div className="auction-reviewed"><strong>人工审核：{lot.review.decision === 'CONFIRM' ? '确认' : lot.review.decision === 'ADJUST' ? '调整' : '作废'}</strong><span>{lot.review.reviewedWinnerTeamName ?? '无归属'} · {lot.review.reviewedPrice ? `⭐${lot.review.reviewedPrice}⭐` : '无成交价'}</span>{lot.review.reason ? <p>{lot.review.reason}</p> : null}</div> : null}
        {['PENDING_REVIEW', 'NO_BID'].includes(lot.status) ? <section className="auction-review-form" aria-label={`${lot.playerName}审核`}><h3>人工确认结果</h3><Radio.Group value={decision} onChange={(event) => { const next = event.target.value as ReviewDecision; setDecisionByLot((current) => ({ ...current, [lot.id]: next })); if (next === 'ADJUST') void loadTeams(); }}><Radio.Button value="CONFIRM">{lot.status === 'NO_BID' ? '确认流拍' : '确认计算结果'}</Radio.Button>{lot.status === 'PENDING_REVIEW' ? <Radio.Button value="ADJUST">调整结果</Radio.Button> : null}<Radio.Button value="VOID">作废</Radio.Button></Radio.Group>
          {decision === 'ADJUST' ? <div className="auction-adjust-grid"><label>最终球队<Select aria-label="最终球队" loading={!teams} value={teamByLot[lot.id]} onChange={(value) => setTeamByLot((current) => ({ ...current, [lot.id]: value }))} options={(teams ?? []).map((team) => ({ value: team.id, label: `${team.name}（${team.ownerAlias}）` }))} /></label><label>最终价格<InputNumber aria-label="最终价格" min={1} precision={0} value={priceByLot[lot.id] ?? lot.currentPrice ?? lot.startingPrice} onChange={(value) => setPriceByLot((current) => ({ ...current, [lot.id]: value ?? 1 }))} /></label></div> : null}
          <label>{decision === 'CONFIRM' ? '备注（可选）' : '原因'}<Input.TextArea aria-label="审核原因" rows={2} value={reasonByLot[lot.id]} onChange={(event) => setReasonByLot((current) => ({ ...current, [lot.id]: event.target.value }))} /></label><Button type="primary" loading={busyLotId === lot.id} onClick={() => void submitReview(lot)}>记录审核结果</Button></section> : null}
      </Card>;
    })}
  </div>;
}
