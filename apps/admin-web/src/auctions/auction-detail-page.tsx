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
import { formatDateTime } from '../lib/date-time';
import { PaginatedRecords } from '../components/paginated-records';

type ReviewDecision = 'CONFIRM' | 'ADJUST' | 'VOID';

const reviewResponseSchema = z.object({ lotId: z.string(), status: z.string(), review: z.unknown() });
const shareCodeSchema = z.object({
  imageDataUrl: z.string().regex(/^data:image\/(?:png|jpeg);base64,/),
  envVersion: z.enum(['release', 'trial', 'develop'])
});
const statusLabel: Record<string, string> = {
  DRAFT: '草稿', READY: '待开始', ACTIVE: '进行中', PAUSED: '已暂停', COMPLETED: '已结束',
  CANCELLED: '已取消', RECOVERY_REQUIRED: '需要人工恢复', QUEUED: '等待中', PENDING_REVIEW: '待审核',
  REVIEWED: '已确认', VOID: '已作废', NO_BID: '无人出价'
};
const resultLabel: Record<string, string> = {
  VALID: '有效', BELOW_STARTING_PRICE: '低于起拍价', BELOW_MINIMUM_INCREMENT: '未达到最低加价',
  UNBOUND: '用户未绑定', NO_ACTIVE_TEAM: '无有效球队', WRONG_LEAGUE: '球队不属于本联赛', INACTIVE: '非拍卖时段',
  PAUSED: '拍卖暂停', RECOVERY_REQUIRED: '等待恢复', DEADLINE_PASSED: '已过截止时间', DUPLICATE: '重复消息', OVERFLOW: '金额超限'
};
const requestKey = () => crypto.randomUUID();
const MoneyAmount = ({ value }: { value: number | null }) => value === null
  ? <span className="auction-money">—</span>
  : <span className="auction-money" aria-label={`${value.toLocaleString('zh-CN')} 资金`}><span className="auction-money__value">{value.toLocaleString('zh-CN')}</span><small className="auction-money__unit">资金</small></span>;
const miniprogramEnvLabel = { release: '正式版小程序码', trial: '体验版小程序码', develop: '开发版小程序码' } as const;
const identity = (teamNumber: number | null | undefined, teamName: string | null | undefined, bidderName: string | null | undefined) =>
  `${teamNumber === null || teamNumber === undefined ? '未编号' : `${teamNumber}号`} · ${teamName ?? '未识别球队'} · ${bidderName ?? '未知用户'}`;

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
  const [busyAction, setBusyAction] = useState<string>();
  const [shareCode, setShareCode] = useState<string>();
  const [shareCodeEnvVersion, setShareCodeEnvVersion] = useState<keyof typeof miniprogramEnvLabel>();
  const [shareCodeError, setShareCodeError] = useState(false);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      setBatch(await api.request(`/v1/admin/leagues/${leagueId}/player-auctions/${batchId}`, { schema: PlayerAuctionBatchDetailSchema }));
    } catch { setError('拍卖详情加载失败，请重试'); }
  }, [api, batchId, leagueId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!batch || batch.bidChannel !== 'MINIPROGRAM' || batch.status === 'DRAFT') return;
    let active = true;
    setShareCodeError(false);
    void api.request(`/v1/admin/leagues/${leagueId}/player-auctions/${batch.id}/share-code`, { schema: shareCodeSchema })
      .then((result) => { if (active) { setShareCode(result.imageDataUrl); setShareCodeEnvVersion(result.envVersion); } })
      .catch(() => { if (active) setShareCodeError(true); });
    return () => { active = false; };
  }, [api, batch?.id, batch?.bidChannel, batch?.status === 'DRAFT', leagueId]);

  const loadTeams = useCallback(async () => {
    if (teams) return;
    try {
      const response = await api.request(`/v1/admin/leagues/${leagueId}/teams?status=ACTIVE`, { schema: LeagueTeamListResponseSchema });
      setTeams(response.items);
    } catch { setError('球队列表加载失败，暂时无法调整归属'); }
  }, [api, leagueId, teams]);

  const pendingCount = useMemo(() => batch?.lots.filter((lot) => ['PENDING_REVIEW', 'NO_BID'].includes(lot.status)).length ?? 0, [batch]);
  const lotStatusLabel = (status: string) => batch?.bidChannel === 'MINIPROGRAM' && status === 'PENDING_REVIEW' ? '已成交' : statusLabel[status] ?? status;
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
  const transition = async (action: 'start' | 'pause' | 'resume') => {
    if (!batch) return;
    setBusyAction(action); setError(undefined); setNotice(undefined);
    try {
      const updated = await api.request(`/v1/admin/leagues/${leagueId}/player-auctions/${batchId}/${action}`, {
        method: 'POST', headers: { 'Idempotency-Key': requestKey() }, schema: PlayerAuctionBatchDetailSchema,
        body: { expectedVersion: batch.version }
      });
      setBatch(updated); setNotice(action === 'start' ? '拍卖已开始。' : action === 'pause' ? '拍卖已暂停。' : '拍卖已继续。');
    } catch { setError('拍卖状态已变化，请刷新后再操作'); } finally { setBusyAction(undefined); }
  };

  if (!batch && !error) return <div className="loading-block"><Spin /><span>正在读取拍卖记录…</span></div>;
  if (!batch) return <Alert role="alert" type="error" showIcon title={error} action={<Button onClick={() => void load()}>重试</Button>} />;
  return <div className="auction-detail-page">
    <header className="auction-page__header"><div><span className="section-kicker">人工拍卖审核台</span><h2>{batch.name}</h2><p>{batch.bidChannel === 'WECHAT_GROUP' ? '微信群接收纯数字出价，管理台保留记录并由管理员确认最终结果。' : '小程序大厅接收实时出价；群通知不可用时，拍卖仍会继续。'}</p></div><div className="auction-header-tools"><div className="auction-header-actions">{batch.status === 'DRAFT' ? <Link className="ant-btn" to={`/leagues/${leagueId}/auctions/${batch.id}/edit`}>编辑草稿</Link> : null}{batch.status === 'READY' ? <Button type="primary" loading={busyAction === 'start'} onClick={() => void transition('start')}>开始拍卖</Button> : null}{batch.status === 'ACTIVE' ? <Button loading={busyAction === 'pause'} onClick={() => void transition('pause')}>暂停拍卖</Button> : null}{batch.status === 'PAUSED' ? <Button type="primary" loading={busyAction === 'resume'} onClick={() => void transition('resume')}>继续拍卖</Button> : null}<Button onClick={() => void load()}>刷新</Button></div><div className="auction-status-panel" role="status" aria-label="当前拍卖状态"><span>当前状态</span><Tag color={batch.status === 'ACTIVE' ? 'processing' : batch.status === 'RECOVERY_REQUIRED' ? 'error' : batch.status === 'COMPLETED' ? 'success' : 'default'}>{statusLabel[batch.status] ?? batch.status}</Tag></div></div></header>
    {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}{notice ? <Alert role="status" type="success" showIcon title={notice} /> : null}
    <Alert className="auction-review-boundary" type="info" showIcon title={batch.bidChannel === 'MINIPROGRAM' ? '倒计时结束后，最高有效出价即为成交结果。' : '审核员记录结果，不会自动修改资金或阵容。'} description={`当前有 ${pendingCount} 位球员可核对；后台记录或纠错不会自动修改资金或阵容，也不会阻塞后续拍卖。`} />
    {batch.bidChannel === 'MINIPROGRAM' ? <Card className="auction-share-card" title="分享小程序拍卖大厅"><div className="auction-share-card__content"><div className="auction-share-card__code">{shareCode ? <img src={shareCode} alt={`${batch.name}小程序码`} /> : <span>{batch.status === 'DRAFT' ? '准备拍卖后生成小程序码' : shareCodeError ? '小程序码暂时无法生成' : '正在生成小程序码…'}</span>}</div><div className="auction-share-card__instructions"><div className="auction-share-card__heading"><strong>电脑后台分享步骤</strong>{shareCodeEnvVersion ? <span>{miniprogramEnvLabel[shareCodeEnvVersion]}</span> : null}</div><p>用手机微信扫码进入拍卖大厅后，点击“分享拍卖”，选择微信群。无需报名联赛；无参赛球队时只能查看和分享。</p><div className="auction-share-path"><code>{`/pages/auction-room/index?batchId=${batch.id}`}</code><Button type="text" size="small" className="auction-copy-path" aria-label="复制页面路径" title="复制页面路径" onClick={() => { void navigator.clipboard.writeText(`/pages/auction-room/index?batchId=${batch.id}`).then(() => setNotice('小程序页面路径已复制。')).catch(() => setError('复制失败，请手动选择页面路径')); }}><span className="auction-copy-icon" aria-hidden="true" /></Button></div><div className="auction-share-card__actions">{shareCode ? <a className="ant-btn" href={shareCode} download={`拍卖大厅-${batch.id}.png`}>下载小程序码</a> : null}</div></div></div></Card> : null}
    {!['COMPLETED', 'CANCELLED'].includes(batch.status) ? <Card className="auction-cancel-card" title="终止本批次"><div><p>仅在误建批次或无法继续时使用，取消后不可恢复。</p><Input aria-label="取消原因" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></div><Popconfirm title="确认取消整个拍卖批次？" description="该操作会立即停止本批次，且不能撤销。" okText="确认取消" cancelText="返回" onConfirm={() => void cancelBatch()}><Button danger loading={busyLotId === 'cancel'}>取消拍卖</Button></Popconfirm></Card> : null}
    {batch.lots.length === 0 ? <Card><Empty description="尚未配置拍卖球员" /></Card> : <PaginatedRecords items={batch.lots} label="拍卖球员分页" initialPage={Math.floor(Math.max(0, batch.lots.findIndex((lot) => lot.id === batch.currentLotId)) / 10) + 1} render={(pageLots) => <>
    <div className="auction-lot-rail" aria-label="拍卖球员顺序">{pageLots.map((lot) => <a key={lot.id} href={`#lot-${lot.id}`} className={lot.id === batch.currentLotId ? 'is-current' : ''}><span>{String(lot.displayOrder).padStart(2, '0')}</span><strong>{lot.playerName}</strong><small>{lotStatusLabel(lot.status)}</small></a>)}</div>
    {pageLots.map((lot) => {
      const decision = decisionByLot[lot.id] ?? 'CONFIRM';
      return <Card id={`lot-${lot.id}`} key={lot.id} className={`auction-review-card ${lot.id === batch.currentLotId ? 'is-current' : ''}`} title={<span><small>第 {lot.displayOrder} 位</small>{lot.playerName}</span>} extra={<Tag>{lotStatusLabel(lot.status)}</Tag>}>
        <div className="auction-result-summary"><div><span>起拍价</span><strong><MoneyAmount value={lot.startingPrice} /></strong></div><div><span>最低加价</span><strong><MoneyAmount value={lot.minimumIncrement} /></strong></div><div><span>成交价</span><strong><MoneyAmount value={lot.currentPrice} /></strong></div><div><span>成交球队与出价人</span><strong>{lot.currentHighestBidId ? (() => { const bid = lot.bids.find((item) => item.id === lot.currentHighestBidId); return bid ? identity(bid.teamNumber, bid.teamName, bid.bidderDisplayName) : '—'; })() : '—'}</strong></div></div>
        <Table className="auction-bid-table" rowKey="id" size="small" pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }} dataSource={lot.bids} locale={{ emptyText: '暂无出价记录' }} columns={[
          { title: batch.bidChannel === 'WECHAT_GROUP' ? '微信群时间' : '小程序提交时间', dataIndex: 'submittedAt', render: (value: string) => formatDateTime(value) },
          { title: '来源', dataIndex: 'source', render: (value: string) => value === 'MINIPROGRAM' ? '小程序' : '微信群' },
          { title: '球队 · 出价人', render: (_: unknown, bid: PlayerAuctionBatchDetail['lots'][number]['bids'][number]) => identity(bid.teamNumber, bid.teamName, bid.bidderDisplayName) },
          { title: '出价', dataIndex: 'amount', render: (value: number) => <MoneyAmount value={value} /> },
          { title: '判定', dataIndex: 'result', render: (value: string) => <Tag color={value === 'VALID' ? 'success' : 'default'}>{resultLabel[value] ?? value}</Tag> }
        ]} />
        {lot.review ? <div className="auction-reviewed"><strong>结果记录：{lot.review.decision === 'CONFIRM' ? '确认' : lot.review.decision === 'ADJUST' ? '调整' : '作废'}</strong><span>{lot.review.reviewedWinnerTeamName ? identity(lot.review.reviewedWinnerTeamNumber, lot.review.reviewedWinnerTeamName, lot.review.reviewedWinnerDisplayName) : '无归属'} · <MoneyAmount value={lot.review.reviewedPrice} /></span>{lot.review.reason ? <p>{lot.review.reason}</p> : null}</div> : null}
        {['PENDING_REVIEW', 'NO_BID'].includes(lot.status) ? <section className="auction-review-form" aria-label={`${lot.playerName}审核`}><h3>结果核对与纠错</h3><Radio.Group value={decision} onChange={(event) => { const next = event.target.value as ReviewDecision; setDecisionByLot((current) => ({ ...current, [lot.id]: next })); if (next === 'ADJUST') void loadTeams(); }}><Radio.Button value="CONFIRM">{lot.status === 'NO_BID' ? '记录流拍' : '记录成交结果'}</Radio.Button>{lot.status === 'PENDING_REVIEW' ? <Radio.Button value="ADJUST">调整结果</Radio.Button> : null}<Radio.Button value="VOID">作废</Radio.Button></Radio.Group>
          {decision === 'ADJUST' ? <div className="auction-adjust-grid"><label>最终球队<Select aria-label="最终球队" loading={!teams} value={teamByLot[lot.id]} onChange={(value) => setTeamByLot((current) => ({ ...current, [lot.id]: value }))} options={(teams ?? []).map((team) => ({ value: team.id, label: identity(team.teamNumber, team.name, team.ownerAlias) }))} /></label><label>最终价格<InputNumber aria-label="最终价格" min={1} precision={0} value={priceByLot[lot.id] ?? lot.currentPrice ?? lot.startingPrice} onChange={(value) => setPriceByLot((current) => ({ ...current, [lot.id]: value ?? 1 }))} /></label></div> : null}
          <label>{decision === 'CONFIRM' ? '备注（可选）' : '原因'}<Input.TextArea aria-label="审核原因" rows={2} value={reasonByLot[lot.id]} onChange={(event) => setReasonByLot((current) => ({ ...current, [lot.id]: event.target.value }))} /></label><Button type="primary" loading={busyLotId === lot.id} onClick={() => void submitReview(lot)}>记录审核结果</Button></section> : null}
      </Card>;
    })}</>} />}
  </div>;
}
