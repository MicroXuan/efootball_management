import { Alert, Button, Card, Drawer, Empty, Form, Input, InputNumber, Select, Spin, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CupBracketViewSchema,
  CupBracketProposalSchema,
  CreateSeasonCupRequestSchema,
  LeagueSeasonSummarySchema,
  SeasonCupSummarySchema,
  SeasonCupListResponseSchema,
  type CupBracketView,
  type LeagueSeasonSummary,
  type SeasonCupSummary
} from '@efm/contracts';
import { z } from 'zod';
import { adminApi, ApiError, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';

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

type CupFormFields = {
  name: string;
  description?: string;
  competitionType: 'GROUP_KNOCKOUT_CUP' | 'KNOCKOUT_CUP';
  platform: 'MOBILE' | 'PLAYSTATION' | 'XBOX' | 'STEAM';
  serverRegion: string;
  registrationOpensAt: string;
  registrationClosesAt: string;
  startsAt: string;
  endsAt: string;
  participantLimit: number;
  targetGroupSize?: number;
  qualifiersPerGroup?: number;
};

const asIso = (value: string) => new Date(value).toISOString();
const randomSeed = () => Math.max(1, Math.floor(Date.now() % 2_147_483_647));

export function CupsPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [seasons, setSeasons] = useState<LeagueSeasonSummary[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [cups, setCups] = useState<SeasonCupSummary[]>([]);
  const [selectedCup, setSelectedCup] = useState<SeasonCupSummary | null>(null);
  const [bracket, setBracket] = useState<CupBracketView | null>(null);
  const [loading, setLoading] = useState(true);
  const [bracketLoading, setBracketLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [cupType, setCupType] = useState<CupFormFields['competitionType']>('KNOCKOUT_CUP');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm<CupFormFields>();
  const createKey = useMutationKey();
  const bracketKey = useMutationKey();

  const loadCups = useCallback(async (targetSeasonId: string, preserveCupId?: string) => {
    if (!targetSeasonId) return [];
    const result = await api.request(
      `/v1/admin/leagues/${leagueId}/seasons/${targetSeasonId}/cups`,
      { schema: SeasonCupListResponseSchema }
    );
    setCups(result.items);
    const preserved = preserveCupId ? result.items.find(({ id }) => id === preserveCupId) ?? null : null;
    setSelectedCup(preserved);
    if (!preserved) setBracket(null);
    return result.items;
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

  const createCup = async (values: CupFormFields) => {
    if (!seasonId || submitting) return;
    setSubmitting(true);
    setError(null);
    const isGrouped = values.competitionType === 'GROUP_KNOCKOUT_CUP';
    try {
      const body = CreateSeasonCupRequestSchema.parse({
        seasonId,
        name: values.name,
        description: values.description ?? '',
        competitionType: values.competitionType,
        format: isGrouped ? 'GROUP_KNOCKOUT' : 'SINGLE_ELIMINATION',
        platform: values.platform,
        serverRegion: values.serverRegion,
        registrationOpensAt: asIso(values.registrationOpensAt),
        registrationClosesAt: asIso(values.registrationClosesAt),
        startsAt: asIso(values.startsAt),
        endsAt: asIso(values.endsAt),
        participantLimit: values.participantLimit,
        targetGroupSize: isGrouped ? values.targetGroupSize : null,
        qualifiersPerGroup: isGrouped ? values.qualifiersPerGroup : null
      });
      await api.request(`/v1/admin/leagues/${leagueId}/seasons/${seasonId}/cups`, {
        method: 'POST',
        headers: { 'Idempotency-Key': createKey.current() },
        schema: SeasonCupSummarySchema,
        body
      });
      createKey.reset();
      form.resetFields();
      setCupType('KNOCKOUT_CUP');
      setCreateOpen(false);
      await loadCups(seasonId);
    } catch {
      setError('杯赛创建失败，请检查时间、人数与赛制设置');
    } finally {
      setSubmitting(false);
    }
  };

  const generateBracket = async () => {
    if (!selectedCup || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.request(
        `/v1/admin/leagues/${leagueId}/seasons/${selectedCup.seasonId}/cups/${selectedCup.id}/bracket-proposals`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': bracketKey.current() },
          schema: CupBracketProposalSchema,
          body: { expectedCompetitionVersion: selectedCup.version, randomSeed: randomSeed() }
        }
      );
      bracketKey.reset();
      await openBracket(selectedCup);
    } catch (caught) {
      setError(caught instanceof ApiError
        ? '签表建议生成失败，请确认报名已截止且小组赛已完成'
        : '签表建议生成失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmBracket = async () => {
    if (!selectedCup || !bracket || submitting || bracket.proposalStatus !== 'DRAFT') return;
    setSubmitting(true);
    setError(null);
    try {
      await api.request(
        `/v1/admin/leagues/${leagueId}/seasons/${selectedCup.seasonId}/cups/${selectedCup.id}/bracket-decisions`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': bracketKey.current() },
          schema: CupBracketProposalSchema,
          body: { proposalId: bracket.proposalId, expectedCompetitionVersion: selectedCup.version }
        }
      );
      bracketKey.reset();
      const refreshed = await loadCups(selectedCup.seasonId, selectedCup.id);
      const updatedCup = refreshed.find(({ id }) => id === selectedCup.id) ?? selectedCup;
      await openBracket(updatedCup);
    } catch {
      setError('签表发布失败，赛事可能已被其他管理员修改，请刷新后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const canGenerateBracket = selectedCup
    ? selectedCup.competitionType === 'KNOCKOUT_CUP'
      ? selectedCup.status === 'REGISTRATION_CLOSED'
      : selectedCup.status === 'IN_PROGRESS'
    : false;

  if (loading) return <div className="loading-block"><Spin /></div>;
  return <div className="cup-workspace">
    <Card className="cup-command-bar">
      <div>
        <span className="section-kicker">杯赛中心</span>
        <h2>赛季杯赛与淘汰签表</h2>
        <p>在同一条比赛轨道上查看报名、当前轮次和晋级结果。</p>
      </div>
      <div className="cup-command-bar__actions">
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
        <Button type="primary" disabled={!seasonId} onClick={() => setCreateOpen(true)}>新建杯赛</Button>
      </div>
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

    {selectedCup && !bracket && !bracketLoading ? <Card className="cup-bracket-empty">
      <div><span className="section-kicker">签表工作台</span><h3>{selectedCup.name}</h3>
        <p>{selectedCup.competitionType === 'GROUP_KNOCKOUT_CUP'
          ? '小组赛结束后生成淘汰签表建议，确认前不会对外发布。'
          : '报名截止后生成淘汰签表建议，确认前不会对外发布。'}</p></div>
      <Button type="primary" disabled={!canGenerateBracket} loading={submitting} onClick={() => void generateBracket()}>生成签表建议</Button>
    </Card> : null}

    {bracketLoading ? <Card className="bracket-stage"><Spin /></Card> : bracket ? <BracketBoard
      bracket={bracket}
      confirming={submitting}
      onConfirm={() => void confirmBracket()}
    /> : null}

    <Drawer
      title="新建杯赛"
      size={560}
      open={createOpen}
      onClose={() => { setCreateOpen(false); createKey.reset(); }}
    >
      <p className="cup-form-intro">先建立赛制与时间窗口。创建后，球队报名、签表建议和正式发布会分步进行。</p>
      <Form<CupFormFields>
        form={form}
        layout="vertical"
        onValuesChange={() => createKey.reset()}
        onFinish={createCup}
        initialValues={{
          competitionType: 'KNOCKOUT_CUP', platform: 'MOBILE', serverRegion: '国服', participantLimit: 16,
          targetGroupSize: 4, qualifiersPerGroup: 2
        }}
      >
        <Form.Item label="杯赛名称" name="name" rules={[{ required: true, message: '请输入杯赛名称' }]}><Input maxLength={80} placeholder="例如：S3 足总杯" /></Form.Item>
        <Form.Item label="杯赛说明" name="description"><Input.TextArea maxLength={2000} rows={3} placeholder="说明赛事定位、报名范围或奖励" /></Form.Item>
        <Form.Item label="赛制" name="competitionType" rules={[{ required: true }]}><Select
          options={[
            { label: '单场淘汰', value: 'KNOCKOUT_CUP' },
            { label: '小组赛 + 淘汰赛', value: 'GROUP_KNOCKOUT_CUP' }
          ]}
          onChange={(value) => setCupType(value)}
        /></Form.Item>
        <div className="inline-fields">
          <Form.Item label="游戏平台" name="platform" rules={[{ required: true }]}><Select options={[
            { label: '移动端', value: 'MOBILE' }, { label: 'PlayStation', value: 'PLAYSTATION' },
            { label: 'Xbox', value: 'XBOX' }, { label: 'Steam', value: 'STEAM' }
          ]} /></Form.Item>
          <Form.Item label="服务器区域" name="serverRegion" rules={[{ required: true }]}><Input maxLength={32} /></Form.Item>
          <Form.Item label="参赛上限" name="participantLimit" rules={[{ required: true }]}><InputNumber min={2} max={128} /></Form.Item>
        </div>
        {cupType === 'GROUP_KNOCKOUT_CUP' ? <div className="inline-fields">
          <Form.Item label="每组目标球队数" name="targetGroupSize" rules={[{ required: true }]}><InputNumber min={2} max={16} /></Form.Item>
          <Form.Item label="每组出线数" name="qualifiersPerGroup" rules={[{ required: true }]}><InputNumber min={1} max={15} /></Form.Item>
        </div> : null}
        <div className="cup-time-grid">
          <Form.Item label="报名开始" name="registrationOpensAt" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
          <Form.Item label="报名截止" name="registrationClosesAt" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
          <Form.Item label="开赛时间" name="startsAt" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
          <Form.Item label="结束时间" name="endsAt" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
        </div>
        <Button block type="primary" htmlType="submit" loading={submitting}>创建杯赛</Button>
      </Form>
    </Drawer>
  </div>;
}

function BracketBoard({ bracket, confirming, onConfirm }: {
  bracket: CupBracketView;
  confirming: boolean;
  onConfirm: () => void;
}) {
  return <section className="bracket-stage" aria-label="淘汰签表">
    <header>
      <div><span className="section-kicker">签表版本 {bracket.proposalVersion}</span><h2>通往决赛</h2>
        <p className={`bracket-status bracket-status--${bracket.proposalStatus.toLowerCase()}`}>{bracket.proposalStatus === 'DRAFT' ? '签表建议 · 尚未发布' : '正式签表 · 已发布'}</p>
      </div>
      <div className="bracket-stage__actions">
        <strong>{bracket.proposalStatus === 'DRAFT' ? '等待管理员确认' : bracket.currentRoundNumber ? `第 ${bracket.currentRoundNumber} 轮进行中` : '赛事已决出冠军'}</strong>
        {bracket.proposalStatus === 'DRAFT' ? <Button type="primary" loading={confirming} onClick={onConfirm}>确认并发布签表</Button> : null}
      </div>
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
