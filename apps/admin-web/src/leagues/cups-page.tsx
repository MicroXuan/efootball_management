import { Alert, Button, Card, Empty, Select, Spin, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CupBracketViewSchema,
  LeagueSeasonSummarySchema,
  SeasonCupListResponseSchema,
  type CupBracketView,
  type LeagueSeasonSummary,
  type SeasonCupSummary
} from '@efm/contracts';
import { z } from 'zod';
import { adminApi, ApiError, type AdminApi } from '../lib/api';

const SeasonListSchema = z.object({ items: z.array(LeagueSeasonSummarySchema), nextCursor: z.string().nullable() });
const statusLabel: Record<SeasonCupSummary['status'], string> = {
  DRAFT: '筹备中',
  REGISTRATION_OPEN: '报名中',
  REGISTRATION_CLOSED: '报名已截止',
  SCHEDULED: '待开赛',
  IN_PROGRESS: '进行中',
  COMPLETED: '已结束',
  CANCELLED: '已取消'
};

export function CupsPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [seasons, setSeasons] = useState<LeagueSeasonSummary[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [cups, setCups] = useState<SeasonCupSummary[]>([]);
  const [selectedCup, setSelectedCup] = useState<SeasonCupSummary | null>(null);
  const [bracket, setBracket] = useState<CupBracketView | null>(null);
  const [loading, setLoading] = useState(true);
  const [bracketLoading, setBracketLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCups = useCallback(async (targetSeasonId: string) => {
    if (!targetSeasonId) return;
    const result = await api.request(
      `/v1/admin/leagues/${leagueId}/seasons/${targetSeasonId}/cups`,
      { schema: SeasonCupListResponseSchema }
    );
    setCups(result.items);
    setSelectedCup(null);
    setBracket(null);
  }, [api, leagueId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.request(`/v1/admin/leagues/${leagueId}/seasons`, { schema: SeasonListSchema });
      setSeasons(result.items);
      const selected = result.items.find(({ status }) => status === 'IN_PROGRESS') ?? result.items[0];
      setSeasonId(selected?.id ?? '');
      if (selected) await loadCups(selected.id);
    } catch {
      setError('杯赛数据加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [api, leagueId, loadCups]);

  useEffect(() => { void load(); }, [load]);

  const openBracket = async (cup: SeasonCupSummary) => {
    setSelectedCup(cup);
    setBracketLoading(true);
    setError(null);
    try {
      const result = await api.request(
        `/v1/admin/leagues/${leagueId}/seasons/${cup.seasonId}/cups/${cup.id}/bracket`,
        { schema: CupBracketViewSchema }
      );
      setBracket(result);
    } catch (caught) {
      setBracket(null);
      if (caught instanceof ApiError && caught.status === 404) {
        setError('该杯赛尚未生成淘汰签表');
      } else {
        setError('签表加载失败，请稍后重试');
      }
    } finally {
      setBracketLoading(false);
    }
  };

  if (loading) return <div className="loading-block"><Spin /></div>;
  return <div className="cup-workspace">
    <Card className="cup-command-bar">
      <div>
        <span className="section-kicker">杯赛中心</span>
        <h2>赛季杯赛与淘汰签表</h2>
        <p>在同一条比赛轨道上查看报名、当前轮次和晋级结果。</p>
      </div>
      <Select
        aria-label="选择杯赛赛季"
        value={seasonId || undefined}
        options={seasons.map((season) => ({ label: season.displayName, value: season.id }))}
        onChange={(value) => {
          setSeasonId(value);
          setError(null);
          void loadCups(value).catch(() => setError('杯赛数据加载失败，请稍后重试'));
        }}
      />
    </Card>

    {error ? <Alert role="alert" showIcon type="warning" title={error} /> : null}
    {cups.length === 0 ? <Card><Empty description="当前赛季还没有杯赛" /></Card> : <div className="cup-card-grid">
      {cups.map((cup) => <Card key={cup.id} className={`cup-card${selectedCup?.id === cup.id ? ' cup-card--selected' : ''}`}>
        <div className="cup-card__top">
          <Tag color={cup.status === 'IN_PROGRESS' ? 'success' : 'default'}>{statusLabel[cup.status]}</Tag>
          <span>{cup.competitionType === 'GROUP_KNOCKOUT_CUP' ? '小组 + 淘汰' : '单场淘汰'}</span>
        </div>
        <h3>{cup.name}</h3>
        <p>{cup.description || '暂无杯赛说明'}</p>
        <div className="cup-card__meter"><strong>{cup.participantCount} / {cup.participantLimit}</strong><span>已报名 / 上限</span></div>
        <Button type="primary" onClick={() => void openBracket(cup)}>查看签表</Button>
      </Card>)}
    </div>}

    {bracketLoading ? <Card className="bracket-stage"><Spin /></Card> : bracket ? <BracketBoard bracket={bracket} /> : null}
  </div>;
}

function BracketBoard({ bracket }: { bracket: CupBracketView }) {
  return <section className="bracket-stage" aria-label="淘汰签表">
    <header>
      <div><span className="section-kicker">签表版本 {bracket.proposalVersion}</span><h2>通往决赛</h2></div>
      <strong>{bracket.currentRoundNumber ? `第 ${bracket.currentRoundNumber} 轮进行中` : '赛事已决出冠军'}</strong>
    </header>
    <div className="bracket-track">
      {bracket.rounds.map((round) => <article key={round.roundNumber} className={`bracket-round${round.roundNumber === bracket.currentRoundNumber ? ' bracket-round--current' : ''}`}>
        <div className="bracket-round__heading"><span>{round.displayName}</span><small>{round.status === 'PUBLISHED' ? '进行中' : '待开始'}</small></div>
        <div className="bracket-round__matches">
          {round.pairings.map((pairing) => <div key={pairing.id} className="bracket-match">
            <div className={pairing.winnerParticipant?.id === pairing.homeParticipant?.id ? 'is-winner' : ''}>
              <span>{pairing.homeParticipant?.displayName ?? '待定'}</span>
              <strong>{pairing.match?.homeScore ?? (pairing.isBye ? '轮空' : '—')}</strong>
            </div>
            <div className={pairing.winnerParticipant?.id === pairing.awayParticipant?.id ? 'is-winner' : ''}>
              <span>{pairing.awayParticipant?.displayName ?? (pairing.isBye ? '轮空' : '待定')}</span>
              <strong>{pairing.match?.awayScore ?? '—'}</strong>
            </div>
          </div>)}
        </div>
      </article>)}
    </div>
  </section>;
}
