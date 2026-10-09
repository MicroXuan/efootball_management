import { Alert, Button, Card, Empty, Input, InputNumber, Select, Spin } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AdminLeagueWechatBotConfigSchema,
  PlayerAuctionBatchDetailSchema,
  RosterPlayerCandidateListResponseSchema,
  type AdminWechatGroupBinding,
  type PlayerAuctionBatchDetail,
  type RosterPlayerCandidate
} from '@efm/contracts';
import { ApiError, adminApi, type AdminApi } from '../lib/api';

type DraftLot = { playerId: string; playerCardId: string; playerName: string; cardName: string; startingPrice: number; minimumIncrement: number };
const key = () => crypto.randomUUID();

export function AuctionEditorPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '', batchId } = useParams();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<AdminWechatGroupBinding[] | null>(null);
  const [batch, setBatch] = useState<PlayerAuctionBatchDetail | null>(null);
  const [name, setName] = useState('球员拍卖');
  const [groupBindingId, setGroupBindingId] = useState<string>();
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<RosterPlayerCandidate[]>([]);
  const [lots, setLots] = useState<DraftLot[]>([]);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    void Promise.all([
      api.request(`/v1/admin/leagues/${leagueId}/wechat-bot`, { schema: AdminLeagueWechatBotConfigSchema }),
      batchId ? api.request(`/v1/admin/leagues/${leagueId}/player-auctions/${batchId}`, { schema: PlayerAuctionBatchDetailSchema }) : Promise.resolve(null)
    ]).then(([config, existing]) => {
      setGroups(config.bindings.filter((binding) => binding.enabled));
      setGroupBindingId(existing?.groupBindingId ?? config.bindings.find((binding) => binding.enabled)?.id);
      if (existing) {
        setBatch(existing); setName(existing.name);
        setLots(existing.lots.map((lot) => ({ playerId: lot.playerId, playerCardId: lot.playerCardId ?? '', playerName: lot.playerName, cardName: String((lot.playerSnapshot.card as { cardName?: string } | null)?.cardName ?? '默认卡'), startingPrice: lot.startingPrice, minimumIncrement: lot.minimumIncrement }))
      ); }
    }).catch(() => setError('拍卖草稿加载失败，请返回列表重试'));
  }, [api, batchId, leagueId]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const duplicateNames = useMemo(() => lots.filter((lot, index) => lots.findIndex((item) => item.playerId === lot.playerId) !== index).map((lot) => lot.playerName), [lots]);
  const search = async () => {
    if (!keyword.trim()) return;
    setBusy(true); setError(undefined);
    try {
      const response = await api.request(`/v1/admin/roster/leagues/${leagueId}/player-candidates?keyword=${encodeURIComponent(keyword.trim())}`, { schema: RosterPlayerCandidateListResponseSchema });
      setResults(response.items);
    } catch { setError('球员搜索失败，请修改关键词后重试'); } finally { setBusy(false); }
  };
  const add = (player: RosterPlayerCandidate, cardId: string) => {
    const card = player.cards.find((item) => item.id === cardId); if (!card) return;
    setLots((current) => [...current, { playerId: player.playerId, playerCardId: card.id, playerName: player.playerName, cardName: card.cardName, startingPrice: 50, minimumIncrement: 10 }]);
    setDirty(true);
  };
  const move = (index: number, offset: number) => setLots((current) => {
    const target = index + offset; if (target < 0 || target >= current.length) return current;
    const next = [...current]; [next[index], next[target]] = [next[target]!, next[index]!]; setDirty(true); return next;
  });
  const save = async (prepare = false) => {
    if (!groupBindingId || !name.trim() || lots.length === 0 || busy) { setError('请选择微信群，并至少添加一位球员'); return; }
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const group = groups?.find((item) => item.id === groupBindingId);
      let current = batch;
      if (!current) current = await api.request(`/v1/admin/leagues/${leagueId}/player-auctions`, { method: 'POST', headers: { 'Idempotency-Key': key() }, schema: PlayerAuctionBatchDetailSchema, body: { groupBindingId, name: name.trim(), expectedVersion: group?.version ?? 1 } });
      else if (current.name !== name.trim()) current = await api.request(`/v1/admin/leagues/${leagueId}/player-auctions/${current.id}`, { method: 'PATCH', headers: { 'Idempotency-Key': key() }, schema: PlayerAuctionBatchDetailSchema, body: { name: name.trim(), expectedVersion: current.version } });
      current = await api.request(`/v1/admin/leagues/${leagueId}/player-auctions/${current.id}/lots`, { method: 'PUT', headers: { 'Idempotency-Key': key() }, schema: PlayerAuctionBatchDetailSchema, body: { expectedVersion: current.version, lots: lots.map((lot, index) => ({ playerId: lot.playerId, playerCardId: lot.playerCardId, displayOrder: index + 1, startingPrice: lot.startingPrice, minimumIncrement: lot.minimumIncrement })) } });
      if (prepare) current = await api.request(`/v1/admin/leagues/${leagueId}/player-auctions/${current.id}/prepare`, { method: 'POST', headers: { 'Idempotency-Key': key() }, schema: PlayerAuctionBatchDetailSchema, body: { expectedVersion: current.version } });
      setBatch(current); setDirty(false); setNotice(prepare ? '拍卖已准备完成，可在微信群发送“开始拍卖”。' : '草稿已保存。');
      if (prepare) navigate(`/leagues/${leagueId}/auctions/${current.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === 'VERSION_CONFLICT' ? '草稿已被其他管理员更新，请刷新后重新确认' : '草稿保存失败，表单内容已保留');
    } finally { setBusy(false); }
  };

  if (!groups && !error) return <div className="loading-block"><Spin /><span>正在准备拍卖编辑器…</span></div>;
  return <div className="auction-editor">
    <header className="auction-page__header"><div><span className="section-kicker">拍卖编排台</span><h2>{batch ? '编辑拍卖草稿' : '创建拍卖批次'}</h2><p>顺序就是群内的拍卖顺序；上下移动按钮可完全用键盘操作。</p></div></header>
    {error ? <Alert role="alert" type="error" showIcon title={error} /> : null}{notice ? <Alert role="status" type="success" showIcon title={notice} /> : null}
    {duplicateNames.length ? <Alert type="warning" showIcon title={`重复球员：${[...new Set(duplicateNames)].join('、')}`} description="允许保存，但请确认是否确实需要重复拍卖。" /> : null}
    <div className="auction-editor__grid"><Card className="form-card" title="批次与微信群"><label>批次名称<Input value={name} onChange={(event) => { setName(event.target.value); setDirty(true); }} /></label><label>绑定微信群<Select value={groupBindingId} disabled={Boolean(batch)} onChange={(value) => { setGroupBindingId(value); setDirty(true); }} options={(groups ?? []).map((group) => ({ value: group.id, label: group.displayName }))} /></label></Card>
      <Card className="form-card" title="搜索并添加球员"><div className="auction-player-search"><Input aria-label="搜索球员" value={keyword} onChange={(event) => setKeyword(event.target.value)} onPressEnter={() => void search()} placeholder="中文名、英文名或卡名" /><Button aria-label="搜索" loading={busy} onClick={() => void search()}>搜索</Button></div>{results.length ? results.map((player) => <div className="auction-search-result" key={player.playerId}><strong>{player.playerName}</strong><span>{player.cards[0]?.cardName}</span><Button aria-label={`添加${player.playerName}`} onClick={() => add(player, player.recommendedPlayerCardId ?? player.cards[0]!.id)}>添加</Button></div>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="搜索后从具体球员卡添加" />}</Card>
    </div>
    <Card className="auction-lot-card" title={`拍卖顺序 · ${lots.length} 位`}>
      {lots.length ? <ol className="auction-lot-list">{lots.map((lot, index) => <li key={`${lot.playerId}-${index}`}><div className="auction-lot-order"><span>{String(index + 1).padStart(2, '0')}</span><Button aria-label={`上移${lot.playerName}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</Button><Button aria-label={`下移${lot.playerName}`} disabled={index === lots.length - 1} onClick={() => move(index, 1)}>↓</Button></div><div className="auction-lot-player"><strong>{lot.playerName}</strong><small>{lot.cardName}</small></div><label>起拍价<InputNumber min={1} precision={0} value={lot.startingPrice} onChange={(value) => { setLots((current) => current.map((item, currentIndex) => currentIndex === index ? { ...item, startingPrice: value ?? 1 } : item)); setDirty(true); }} /><span className="auction-money-preview">⭐{lot.startingPrice}⭐</span></label><label>最低加价<InputNumber min={1} precision={0} value={lot.minimumIncrement} onChange={(value) => { setLots((current) => current.map((item, currentIndex) => currentIndex === index ? { ...item, minimumIncrement: value ?? 1 } : item)); setDirty(true); }} /><span className="auction-money-preview">⭐{lot.minimumIncrement}⭐</span></label><Button danger onClick={() => { setLots((current) => current.filter((_, currentIndex) => currentIndex !== index)); setDirty(true); }}>移除</Button></li>)}</ol> : <Empty description="还没有球员，请先搜索并添加" />}
      <div className="auction-editor__actions"><Button loading={busy} onClick={() => void save(false)}>保存草稿</Button><Button type="primary" loading={busy} disabled={!lots.length} onClick={() => void save(true)}>保存并准备拍卖</Button></div>
    </Card>
  </div>;
}
