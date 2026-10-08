import { Alert, Button, Card, Drawer, Empty, Form, Input, InputNumber, Select, Spin, Tag } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CupBracketViewSchema,
  CupBracketProposalSchema,
  CupGroupProposalSchema,
  CupGroupViewSchema,
  CreateSeasonCupRequestSchema,
  LeagueSeasonSummarySchema,
  SeasonCupSummarySchema,
  SeasonCupListResponseSchema,
  type CupBracketView,
  type CupGroupView,
  type LeagueSeasonSummary,
  type SeasonCupSummary
} from '@efm/contracts';
import { z } from 'zod';
import { adminApi, ApiError, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';

const SeasonListSchema = z.object({ items: z.array(LeagueSeasonSummarySchema), nextCursor: z.string().nullable() });
const CupGroupDecisionSchema = z.object({
  competitionId: z.string(), proposalId: z.string(), version: z.number(),
  stages: z.array(z.object({
    id: z.string(), stageCode: z.string(), displayName: z.string(), participantCount: z.number()
  }))
});
const SchedulePreviewSchema = z.object({
  id: z.string(), competitionId: z.string(), status: z.enum(['DRAFT', 'PUBLISHED']),
  version: z.number(), roundCount: z.number(), matchCount: z.number(), matches: z.array(z.unknown())
});
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
  const [groupView, setGroupView] = useState<CupGroupView | null>(null);
  const [groupTargets, setGroupTargets] = useState<Record<string, string>>({});
  const [groupReasons, setGroupReasons] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [bracketLoading, setBracketLoading] = useState(false);
  const [groupLoading, setGroupLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [cupType, setCupType] = useState<CupFormFields['competitionType']>('KNOCKOUT_CUP');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm<CupFormFields>();
  const createKey = useMutationKey();
  const bracketKey = useMutationKey();
  const groupKey = useMutationKey();
  const scheduleKey = useMutationKey();
  const selectedSeason = seasons.find(({ id }) => id === seasonId) ?? null;

  const loadCups = useCallback(async (targetSeasonId: string, preserveCupId?: string) => {
    if (!targetSeasonId) return [];
    const result = await api.request(
      `/v1/admin/leagues/${leagueId}/seasons/${targetSeasonId}/cups`,
      { schema: SeasonCupListResponseSchema }
    );
    setCups(result.items);
    const preserved = preserveCupId ? result.items.find(({ id }) => id === preserveCupId) ?? null : null;
    setSelectedCup(preserved);
    if (!preserved) {
      setBracket(null);
      setGroupView(null);
    }
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
    setGroupView(null);
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

  const applyGroupView = (view: CupGroupView) => {
    setGroupView(view);
    setGroupTargets(Object.fromEntries(view.proposal?.rows.map((row) => [
      row.participantId, row.finalGroupCode ?? row.suggestedGroupCode
    ]) ?? []));
    setGroupReasons(Object.fromEntries(view.proposal?.rows.map((row) => [row.participantId, row.reason ?? '']) ?? []));
  };

  const loadGroups = async (cup: SeasonCupSummary) => {
    setSelectedCup(cup);
    setBracket(null);
    setGroupLoading(true);
    setError(null);
    try {
      const result = await api.request(
        `/v1/admin/leagues/${leagueId}/seasons/${cup.seasonId}/cups/${cup.id}/groups`,
        { schema: CupGroupViewSchema }
      );
      applyGroupView(result);
    } catch {
      setGroupView(null);
      setError('分组工作台加载失败，请稍后重试');
    } finally {
      setGroupLoading(false);
    }
  };

  const generateGroups = async () => {
    if (!selectedCup || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const proposal = await api.request(
        `/v1/admin/leagues/${leagueId}/seasons/${selectedCup.seasonId}/cups/${selectedCup.id}/group-proposals`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': groupKey.current() },
          schema: CupGroupProposalSchema,
          body: { expectedCompetitionVersion: groupView?.competitionVersion ?? selectedCup.version, randomSeed: randomSeed() }
        }
      );
      groupKey.reset();
      applyGroupView({
        competitionId: selectedCup.id,
        competitionVersion: groupView?.competitionVersion ?? selectedCup.version,
        proposal,
        stages: []
      });
    } catch {
      setError('分组建议生成失败，请确认报名已截止且至少有 2 支球队');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmGroups = async () => {
    if (!selectedCup || !groupView?.proposal || groupView.proposal.status !== 'DRAFT' || submitting) return;
    const overrides = groupView.proposal.rows
      .filter((row) => groupTargets[row.participantId] !== row.suggestedGroupCode)
      .map((row) => ({
        participantId: row.participantId,
        targetGroupCode: groupTargets[row.participantId],
        reason: groupReasons[row.participantId]?.trim() ?? ''
      }));
    if (overrides.some(({ reason }) => !reason)) {
      setError('人工调整组别时必须填写原因');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.request(
        `/v1/admin/leagues/${leagueId}/seasons/${selectedCup.seasonId}/cups/${selectedCup.id}/group-decisions`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': groupKey.current() },
          schema: CupGroupDecisionSchema,
          body: {
            proposalId: groupView.proposal.id,
            expectedCompetitionVersion: groupView.competitionVersion,
            overrides
          }
        }
      );
      groupKey.reset();
      const refreshed = await loadCups(selectedCup.seasonId, selectedCup.id);
      const updatedCup = refreshed.find(({ id }) => id === selectedCup.id) ?? {
        ...selectedCup,
        version: groupView.competitionVersion + 1
      };
      await loadGroups(updatedCup);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409
        ? '分组已被其他管理员修改，请重新打开工作台'
        : '正式分组发布失败，请检查各组人数是否均衡');
    } finally {
      setSubmitting(false);
    }
  };

  const generateGroupSchedule = async (stageId: string) => {
    const stage = groupView?.stages.find(({ id }) => id === stageId);
    if (!stage || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const preview = await api.request(`/v1/admin/leagues/${leagueId}/competition-stages/${stageId}/schedule/generate`, {
        method: 'POST', headers: { 'Idempotency-Key': scheduleKey.current() }, schema: SchedulePreviewSchema,
        body: { expectedStageVersion: stage.version }
      });
      scheduleKey.reset();
      setGroupView((current) => current ? {
        ...current,
        stages: current.stages.map((item) => item.id === stageId
          ? { ...item, version: preview.version, matchCount: preview.matchCount }
          : item)
      } : current);
    } catch {
      setError('小组赛程生成失败，请刷新后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const publishGroupSchedule = async (stageId: string) => {
    const stage = groupView?.stages.find(({ id }) => id === stageId);
    if (!stage || !selectedCup || !selectedSeason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const preview = await api.request(`/v1/admin/leagues/${leagueId}/competition-stages/${stageId}/schedule/publish`, {
        method: 'POST', headers: { 'Idempotency-Key': scheduleKey.current() }, schema: SchedulePreviewSchema,
        body: { expectedStageVersion: stage.version, expectedSeasonVersion: selectedSeason.version }
      });
      scheduleKey.reset();
      if (selectedSeason.status === 'READY') {
        setSeasons((current) => current.map((item) => item.id === selectedSeason.id
          ? { ...item, status: 'IN_PROGRESS', version: item.version + 1 }
          : item));
      }
      setGroupView((current) => current ? {
        ...current,
        stages: current.stages.map((item) => item.id === stageId
          ? { ...item, version: preview.version, matchCount: preview.matchCount, status: 'PUBLISHED' }
          : item)
      } : current);
      await loadCups(selectedCup.seasonId, selectedCup.id);
    } catch {
      setError('小组赛程发布失败，请确认预览已生成且版本未变更');
    } finally {
      setSubmitting(false);
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
        <Button type="primary" onClick={() => void (cup.competitionType === 'GROUP_KNOCKOUT_CUP'
          ? loadGroups(cup)
          : openBracket(cup))}>
          {cup.competitionType === 'GROUP_KNOCKOUT_CUP' ? '管理分组' : '查看签表'}
        </Button>
      </Card>)}
    </div>}

    {groupLoading ? <Card className="cup-group-stage"><Spin /></Card> : null}

    {selectedCup && groupView && !groupLoading ? <GroupWorkspace
      cup={selectedCup}
      view={groupView}
      targets={groupTargets}
      reasons={groupReasons}
      submitting={submitting}
      onTargetChange={(participantId, value) => setGroupTargets((current) => ({ ...current, [participantId]: value }))}
      onReasonChange={(participantId, value) => setGroupReasons((current) => ({ ...current, [participantId]: value }))}
      onGenerate={() => void generateGroups()}
      onConfirm={() => void confirmGroups()}
      onGenerateSchedule={(stageId) => void generateGroupSchedule(stageId)}
      onPublishSchedule={(stageId) => void publishGroupSchedule(stageId)}
      onOpenBracket={() => void openBracket(selectedCup)}
    /> : null}

    {selectedCup && !groupView && !groupLoading && !bracket && !bracketLoading ? <Card className="cup-bracket-empty">
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

const cupGroupLabel = (code: string) => `${code.replace('GROUP_', '')} 组`;

function GroupWorkspace({
  cup,
  view,
  targets,
  reasons,
  submitting,
  onTargetChange,
  onReasonChange,
  onGenerate,
  onConfirm,
  onGenerateSchedule,
  onPublishSchedule,
  onOpenBracket
}: {
  cup: SeasonCupSummary;
  view: CupGroupView;
  targets: Record<string, string>;
  reasons: Record<string, string>;
  submitting: boolean;
  onTargetChange: (participantId: string, value: string) => void;
  onReasonChange: (participantId: string, value: string) => void;
  onGenerate: () => void;
  onConfirm: () => void;
  onGenerateSchedule: (stageId: string) => void;
  onPublishSchedule: (stageId: string) => void;
  onOpenBracket: () => void;
}) {
  const proposal = view.proposal;
  const groupCodes = [...new Set(proposal?.rows.map(({ suggestedGroupCode }) => suggestedGroupCode) ?? [])].sort();
  const confirmed = proposal?.status === 'CONFIRMED';
  const allSchedulesPublished = view.stages.length > 0 && view.stages.every(({ status }) => status === 'PUBLISHED');

  return <section className="cup-group-stage" aria-label="杯赛分组工作台">
    <header className="cup-group-stage__header">
      <div>
        <span className="section-kicker">小组赛工作台</span>
        <h2>{cup.name}</h2>
        <p>审阅分组、发布各组赛程，小组赛结束后在同一条赛事轨道上生成淘汰签表。</p>
      </div>
      <div className="cup-stage-rail" aria-label="杯赛阶段">
        <span className={proposal ? 'is-complete' : 'is-current'}>1 <small>分组建议</small></span>
        <span className={confirmed ? 'is-complete' : proposal ? 'is-current' : ''}>2 <small>正式分组</small></span>
        <span className={allSchedulesPublished ? 'is-complete' : confirmed ? 'is-current' : ''}>3 <small>小组赛程</small></span>
        <span>4 <small>淘汰签表</small></span>
      </div>
    </header>

    {!proposal ? <div className="cup-group-empty">
      <Empty description="尚未生成分组建议" />
      <p>系统会按报名球队和目标小组人数均衡分配，发布前可人工调整。</p>
      <Button type="primary" disabled={cup.status !== 'REGISTRATION_CLOSED'} loading={submitting} onClick={onGenerate}>生成分组建议</Button>
    </div> : <>
      <div className="cup-group-stage__titlebar">
        <div>
          <strong>分组建议版本 {proposal.version}</strong>
          <span>{confirmed ? '已发布，球队已锁定' : '待审阅，调整后需明确说明原因'}</span>
        </div>
        <Tag color={confirmed ? 'green' : 'gold'}>{confirmed ? '正式分组' : '草案'}</Tag>
      </div>
      <div className="cup-group-board">
        {groupCodes.map((groupCode) => <article key={groupCode} className="cup-group-column">
          <header><span>{cupGroupLabel(groupCode)}</span><small>{proposal.rows.filter((row) => targets[row.participantId] === groupCode).length} 支</small></header>
          <div className="cup-group-team-list">
            {proposal.rows.filter((row) => targets[row.participantId] === groupCode).map((row) => {
              const adjusted = targets[row.participantId] !== row.suggestedGroupCode;
              return <div key={row.participantId} className={`cup-group-team${adjusted ? ' is-adjusted' : ''}`}>
                <div className="cup-group-team__identity"><strong>{row.teamName}</strong><span>{adjusted ? '人工调整' : '系统建议'}</span></div>
                <Select
                  aria-label={`${row.teamName}最终组别`}
                  disabled={confirmed}
                  value={targets[row.participantId]}
                  options={groupCodes.map((code) => ({ label: cupGroupLabel(code), value: code }))}
                  onChange={(value) => onTargetChange(row.participantId, value)}
                />
                {adjusted ? <Input
                  aria-label={`${row.teamName}调整原因`}
                  disabled={confirmed}
                  value={reasons[row.participantId] ?? ''}
                  placeholder="填写换组原因"
                  onChange={(event) => onReasonChange(row.participantId, event.target.value)}
                /> : null}
              </div>;
            })}
          </div>
        </article>)}
      </div>
      {!confirmed ? <div className="cup-group-stage__actions">
        <Button loading={submitting} onClick={onGenerate}>重新生成建议</Button>
        <Button type="primary" loading={submitting} onClick={onConfirm}>确认并发布分组</Button>
      </div> : null}
    </>}

    {view.stages.length > 0 ? <div className="cup-group-schedules">
      <div className="cup-group-schedules__heading">
        <div><span className="section-kicker">赛程发布</span><h3>正式组别与小组赛程</h3></div>
        <Button onClick={onOpenBracket}>查看淘汰签表</Button>
      </div>
      <div className="cup-group-schedule-grid">
        {view.stages.map((stage) => <article key={stage.id} className="cup-group-schedule-card">
          <div className="cup-group-schedule-card__status"><Tag color={stage.status === 'PUBLISHED' ? 'green' : 'gold'}>{stage.status === 'PUBLISHED' ? '已发布' : '待发布'}</Tag><span>{stage.matchCount ? `${stage.matchCount} 场` : '尚无赛程'}</span></div>
          <h4>{stage.displayName}</h4>
          <p><strong>{stage.participantCount} 支球队</strong><span>{stage.status === 'PUBLISHED' ? '赛程已发布' : stage.matchCount ? '预览已生成' : '等待生成对阵'}</span></p>
          <div>
            <Button aria-label={`${stage.displayName}生成赛程`} disabled={stage.status === 'PUBLISHED'} loading={submitting} onClick={() => onGenerateSchedule(stage.id)}>生成预览</Button>
            <Button aria-label={`${stage.displayName}发布赛程`} type="primary" disabled={stage.status === 'PUBLISHED' || stage.matchCount === 0} loading={submitting} onClick={() => onPublishSchedule(stage.id)}>发布赛程</Button>
          </div>
        </article>)}
      </div>
    </div> : null}
  </section>;
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
              <span>{pairing.homeParticipant?.displayName ?? '待定'}{pairing.homeParticipant?.teamLifecycleStatus === 'ARCHIVED' ? '（已退赛）' : ''}</span>
              <strong>{pairing.match?.homeScore ?? (pairing.isBye ? '轮空' : '—')}</strong>
            </div>
            <div className={pairing.winnerParticipant?.id === pairing.awayParticipant?.id ? 'is-winner' : ''}>
              <span>{pairing.awayParticipant?.displayName ?? (pairing.isBye ? '轮空' : '待定')}{pairing.awayParticipant?.teamLifecycleStatus === 'ARCHIVED' ? '（已退赛）' : ''}</span>
              <strong>{pairing.match?.awayScore ?? '—'}</strong>
            </div>
          </div>)}
        </div>
      </article>)}
    </div>
  </section>;
}
