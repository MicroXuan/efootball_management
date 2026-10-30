import { Alert, Button } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { AdminTransferProposalListSchema, LeagueListResponseSchema, LeagueSeasonSummarySchema, type CompetitionMatchResponse } from '@efm/contracts';
import { useAdminSession } from '../auth/admin-session';
import { adminApi, type AdminApi } from '../lib/api';
import { collectCursorPages } from '../lib/cursor-pages';
import { formatDateTime } from '../lib/date-time';
import { filterFixtures, loadFixtures, teamName, type Fixture } from './mobile-data';
import { ScoreEditor, TransferEditor, transferStatus, type Proposal } from './mobile-editors';
import './mobile.css';

const SeasonsSchema = z.object({ items: z.array(LeagueSeasonSummarySchema), nextCursor: z.string().nullable() });
type LeagueOption = { id: string; name: string };

// Each dependency change hides the previous response immediately; late responses are discarded.
function useResource<T>(load: () => Promise<T>, revision = 0): { data?: T; failed?: boolean } {
  const [state, setState] = useState<{ load: typeof load; revision: number; data?: T; failed?: boolean }>();
  useEffect(() => {
    let active = true;
    void load().then((data) => { if (active) setState({ load, revision, data }); })
      .catch(() => { if (active) setState({ load, revision, failed: true }); });
    return () => { active = false; };
  }, [load, revision]);
  return state?.load === load && state.revision === revision ? state : {};
}

export function MobileWorkbench({ api = adminApi }: { api?: AdminApi }) {
  const session = useAdminSession();
  const { leagueId, tab = 'home' } = useParams();
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const identity = session.identity;
  const loadLeagues = useCallback(async (): Promise<LeagueOption[]> => {
    if (!identity?.platformAdmin) return (identity?.leagueGrants ?? []).map((grant) => ({ id: grant.leagueId, name: grant.leagueName }));
    return collectCursorPages((cursor) => api.request(`/v1/admin/platform/leagues${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { schema: LeagueListResponseSchema }));
  }, [api, identity]);
  const leagues = useResource(loadLeagues, revision);
  const validTab = ['home', 'matches', 'transfers'].includes(tab) ? tab : 'home';
  const selected = leagues.data?.find((league) => league.id === leagueId);
  const storageKey = `efm.mobile.league.${identity?.admin.id}`;
  useEffect(() => {
    if (selected) { try { localStorage.setItem(storageKey, selected.id); } catch { /* Storage is optional. */ } }
  }, [selected, storageKey]);
  if (!leagueId && leagues.data?.length) {
    let remembered: string | null = null;
    try { remembered = localStorage.getItem(storageKey); } catch { /* Storage is optional. */ }
    return <Navigate replace to={`/mobile/${leagues.data.find((item) => item.id === remembered)?.id ?? leagues.data[0]!.id}/home`} />;
  }
  return <main className="mobile-workbench">
    <header className="mobile-header"><div><span className="mobile-eyebrow">非概念实况 · 管理员</span><h1>手机工作台</h1></div><Link to="/">完整后台 ↗</Link></header>
    <div className="mobile-league-picker"><label htmlFor="mobile-league">管理联赛</label><select id="mobile-league" value={selected?.id ?? ''} onChange={(event) => navigate(`/mobile/${event.target.value}/${validTab}`)} disabled={!leagues.data?.length}>
      {!selected && <option value="">选择联赛</option>}{leagues.data?.map((league) => <option key={league.id} value={league.id}>{league.name}</option>)}
    </select></div>
    {leagues.failed ? <Failure text="联赛加载失败，请重试。" retry={() => setRevision((value) => value + 1)} />
      : !leagues.data ? <Loading />
      : !leagues.data.length ? <Empty text="尚未分配联赛，请联系平台管理员。" />
      : !selected ? <Alert type="error" title="你没有此联赛的管理权限" />
      : <LeagueWorkspace key={selected.id} leagueId={selected.id} tab={validTab} api={api} />}
    <footer className="mobile-account"><span>使用现有管理员账号</span><button onClick={() => void session.logout()}>退出登录</button></footer>
    {selected && <nav className="mobile-bottom-nav" aria-label="手机工作台导航">{[['home', '工作台'], ['matches', '赛程 / 比分'], ['transfers', '转会审核']].map(([value, label]) => <Link key={value} to={`/mobile/${selected.id}/${value}`} aria-current={validTab === value ? 'page' : undefined}>{label}</Link>)}</nav>}
  </main>;
}

function Loading() { return <p className="mobile-empty" role="status">正在加载…</p>; }
function Empty({ text }: { text: string }) { return <p className="mobile-empty">{text}</p>; }
function Failure({ text, retry }: { text: string; retry(): void }) { return <div className="mobile-error"><Alert role="alert" type="error" title={text} /><Button onClick={retry}>重新加载</Button></div>; }

function LeagueWorkspace({ leagueId, tab, api }: { leagueId: string; tab: string; api: AdminApi }) {
  const [seasonId, setSeasonId] = useState('');
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState('');
  const seasons = useResource(useCallback(() => collectCursorPages((cursor) => api.request(`/v1/admin/leagues/${leagueId}/seasons${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { schema: SeasonsSchema })), [api, leagueId]), revision);
  const selectedSeason = seasons.data?.find((season) => season.id === seasonId)
    ?? seasons.data?.find((season) => season.status === 'IN_PROGRESS') ?? seasons.data?.[0];
  const refresh = () => { setNotice(''); setRevision((value) => value + 1); };
  return <>
    <div className="mobile-section-heading"><h2>{tab === 'home' ? '联赛事务，随手处理' : tab === 'matches' ? '赛程与比分' : '转会审核'}</h2><Button onClick={refresh}>刷新</Button></div>
    {notice && <Alert role="status" type="success" title={notice} closable onClose={() => setNotice('')} />}
    {tab !== 'transfers' && <>
      {seasons.failed ? <Failure text="赛季加载失败，请重试。" retry={refresh} /> : !seasons.data ? <Loading /> : seasons.data.length ?
        <label className="mobile-season-picker">赛季<select aria-label="赛季" value={selectedSeason?.id ?? ''} onChange={(event) => { setSeasonId(event.target.value); setNotice(''); }}>{seasons.data.map((season) => <option key={season.id} value={season.id}>{season.displayName}</option>)}</select></label>
        : <Empty text="此联赛暂无赛季，请在完整后台创建。" />}
      {selectedSeason && <MatchSection key={selectedSeason.id} api={api} leagueId={leagueId} seasonId={selectedSeason.id} revision={revision} compact={tab === 'home'} onSaved={() => { setNotice('官方比分已保存，赛程正在刷新。'); setRevision((value) => value + 1); }} />}
    </>}
    {tab !== 'matches' && <TransferSection api={api} leagueId={leagueId} revision={revision} compact={tab === 'home'} onSaved={() => { setNotice('转会审核已保存，列表正在刷新。'); setRevision((value) => value + 1); }} />}
  </>;
}

function MatchSection({ api, leagueId, seasonId, revision, compact, onSaved }: { api: AdminApi; leagueId: string; seasonId: string; revision: number; compact: boolean; onSaved(): void }) {
  const [retry, setRetry] = useState(0);
  const resource = useResource(useCallback(() => loadFixtures(api, seasonId), [api, seasonId]), revision + retry);
  const [query, setQuery] = useState('');
  const [round, setRound] = useState('');
  const [status, setStatus] = useState('ALL');
  const [selected, setSelected] = useState<CompetitionMatchResponse | null>(null);
  const [limit, setLimit] = useState(20);
  const items = resource.data ?? [];
  const filtered = filterFixtures(items, { query, round, status: compact ? 'UPCOMING' : status });
  const shown = compact ? filtered.slice(0, 3) : filtered.slice(0, limit);
  if (resource.failed) return <Failure text="赛程加载失败，请重试。" retry={() => setRetry((value) => value + 1)} />;
  if (!resource.data) return <Loading />;
  return <section className="mobile-section" aria-label="已发布赛程">
    {compact ? <div className="mobile-section-heading"><div><span className="mobile-eyebrow">所选赛季 · 已发布比赛</span><h3>待录比分 <b>{filtered.length}</b></h3></div><Link to={`/mobile/${leagueId}/matches`}>全部赛程 →</Link></div> : <div className="mobile-filters">
      <label>搜索球队<input type="search" placeholder="球队名称或编号" maxLength={64} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(20); }} /></label>
      <label>轮次<select aria-label="轮次" value={round} onChange={(event) => { setRound(event.target.value); setLimit(20); }}><option value="">全部轮次</option>{[...new Set(items.map(({ match }) => match.roundNumber))].sort((a, b) => a - b).map((number) => <option key={number} value={number}>第 {number} 轮</option>)}</select></label>
      <div className="mobile-segments" aria-label="比分状态">{[['ALL', '全部'], ['UPCOMING', '待录比分'], ['FINISHED', '已有比分']].map(([value, label]) => <button key={value} aria-pressed={status === value} onClick={() => { setStatus(value!); setLimit(20); }}>{label}</button>)}</div>
      <p className="mobile-muted">共 {filtered.length} 场已发布比赛 · 时间为北京时间</p>
    </div>}
    {!shown.length && <Empty text={!items.length ? '暂无已发布赛程' : compact ? '此赛季已发布比赛的比分均已录入。' : '没有符合筛选条件的比赛。'} />}
    <div className="mobile-card-list">{shown.map((fixture) => <MatchCard key={fixture.match.id} fixture={fixture} onEdit={() => setSelected(fixture.match)} />)}</div>
    {!compact && filtered.length > limit && <Button block onClick={() => setLimit((value) => value + 20)}>继续显示比赛（剩余 {filtered.length - limit} 场）</Button>}
    {selected && <ScoreEditor match={selected} leagueId={leagueId} api={api} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); onSaved(); }} />}
  </section>;
}

function MatchCard({ fixture: { competition, match }, onEdit }: { fixture: Fixture; onEdit(): void }) {
  const canScore = ['IN_PROGRESS', 'COMPLETED'].includes(competition.status);
  return <article className="mobile-match-card">
    <div className="mobile-match-meta"><span>{competition.name} · {match.stageDisplayName ?? '赛事'} · 第 {match.roundNumber} 轮</span><span className={match.officialResult ? 'mobile-badge done' : 'mobile-badge'}>{match.officialResult ? '已有比分' : '待录比分'}</span></div>
    <div className="mobile-scoreboard"><div><small>主队</small><strong>{teamName(match.homeParticipant)}</strong></div><b>{match.officialResult ? `${match.officialResult.homeScore} : ${match.officialResult.awayScore}` : 'VS'}</b><div><small>客队</small><strong>{teamName(match.awayParticipant)}</strong></div></div>
    <div className="mobile-match-footer"><span>{match.plannedAt ? `${formatDateTime(match.plannedAt)}（北京时间）` : '比赛时间待定'}</span><Button disabled={!canScore} onClick={onEdit}>{match.officialResult ? '修正比分' : '录入比分'}</Button></div>
    {!canScore && <p className="mobile-muted">{competition.status === 'CANCELLED' ? '赛事已取消' : '赛事尚未开赛'}，暂不可录分。</p>}
  </article>;
}

function TransferSection({ api, leagueId, revision, compact, onSaved }: { api: AdminApi; leagueId: string; revision: number; compact: boolean; onSaved(): void }) {
  const [retry, setRetry] = useState(0);
  const resource = useResource(useCallback(async () => (await api.request(`/v1/admin/leagues/${leagueId}/transfer-proposals`, { schema: AdminTransferProposalListSchema })).items, [api, leagueId]), revision + retry);
  const [status, setStatus] = useState('PENDING_ADMIN');
  const [selected, setSelected] = useState<Proposal | null>(null);
  const [limit, setLimit] = useState(20);
  if (resource.failed) return <Failure text="转会申请加载失败，请重试。" retry={() => setRetry((value) => value + 1)} />;
  if (!resource.data) return <Loading />;
  const filtered = resource.data.filter((item) => compact ? item.status === 'PENDING_ADMIN' : status === 'ALL' || item.status === status);
  const shown = filtered.slice(0, compact ? 3 : limit);
  return <section className="mobile-section" aria-label="转会申请">
    {compact ? <div className="mobile-section-heading"><div><span className="mobile-eyebrow">此联赛 · 全部赛季</span><h3>待审核转会 <b>{filtered.length}</b></h3></div><Link to={`/mobile/${leagueId}/transfers`}>全部转会 →</Link></div> : <><p className="mobile-muted">此联赛的全部赛季申请，双方确认后由管理员终审。</p><div className="mobile-segments" aria-label="转会状态">{[['PENDING_ADMIN', '待审核'], ['PENDING_COUNTERPARTY', '待确认'], ['ALL', '全部记录']].map(([value, label]) => <button key={value} aria-pressed={status === value} onClick={() => { setStatus(value!); setLimit(20); }}>{label}</button>)}</div></>}
    {!shown.length && <Empty text="当前没有符合条件的转会申请。" />}
    <div className="mobile-card-list">{shown.map((proposal) => <article className="mobile-transfer-card" key={proposal.id}>
      <div className="mobile-match-meta"><h3>{proposal.playerName}</h3><span className="mobile-badge">{transferStatus[proposal.status] ?? proposal.status}</span></div>
      <p>{proposal.sourceTeamNumber == null ? '' : `${proposal.sourceTeamNumber}号 · `}{proposal.sourceTeamName} → {proposal.targetTeamNumber == null ? '' : `${proposal.targetTeamNumber}号 · `}{proposal.targetTeamName}</p>
      <div className="mobile-match-footer"><strong>报价 {proposal.amountMinor.toLocaleString('zh-CN')}</strong><Button onClick={() => setSelected(proposal)}>{proposal.status === 'PENDING_ADMIN' ? '查看并审核' : '查看详情'}</Button></div>
    </article>)}</div>
    {!compact && filtered.length > limit && <Button block onClick={() => setLimit((value) => value + 20)}>继续显示申请</Button>}
    {selected && <TransferEditor proposal={selected} leagueId={leagueId} api={api} onClose={() => setSelected(null)} onSaved={() => { setSelected(null); onSaved(); }} />}
  </section>;
}
