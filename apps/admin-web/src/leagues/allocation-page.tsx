import { Alert, Button, Card, Empty, Input, InputNumber, Modal, Select, Space, Spin, Table, Tag } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  LeagueSeasonSummarySchema,
  CompetitionMatchResponseSchema,
  MatchResultVersionResponseSchema,
  SeasonAllocationProposalSchema,
  type CompetitionMatchResponse,
  type LeagueSeasonSummary,
  type SeasonAllocationProposal
} from '@efm/contracts';
import { z } from 'zod';
import { adminApi, ApiError, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';

const SeasonListSchema = z.object({ items: z.array(LeagueSeasonSummarySchema), nextCursor: z.string().nullable() });
const ConfirmedSchema = z.object({
  seasonId: z.string(), competitionId: z.string(), stageCount: z.number(), participantCount: z.number(),
  status: z.enum(['READY', 'IN_PROGRESS']), version: z.number(),
  stages: z.array(z.object({
    id: z.string(), stageCode: z.string(), displayName: z.string(), participantCount: z.number(),
    matchCount: z.number().default(0), status: z.enum(['DRAFT', 'PUBLISHED']).default('DRAFT'), version: z.number().default(1)
  }))
});
const SchedulePreviewSchema = z.object({
  id: z.string(), competitionId: z.string(), status: z.enum(['DRAFT', 'PUBLISHED']),
  version: z.number(), roundCount: z.number(), matchCount: z.number(), matches: z.array(CompetitionMatchResponseSchema)
});
type Confirmed = z.infer<typeof ConfirmedSchema>;
type SchedulePreview = z.infer<typeof SchedulePreviewSchema>;

const stageLabel = (code: string) => code === 'SUPER' ? '超级组' : `冠军 ${code.replace('CHAMPION_', '')} 组`;

function TeamCrest({ name, url }: { name: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return <span className="fixture-team__crest fixture-team__crest--fallback" aria-label={`${name}队徽占位`}>
      {name.trim().slice(0, 2).toUpperCase()}
    </span>;
  }
  return <span className="fixture-team__crest">
    <img src={url} alt={`${name}队徽`} onError={() => setFailed(true)} />
  </span>;
}

function ScheduleBoard({ preview, onEditScore }: {
  preview: SchedulePreview;
  onEditScore?: (match: CompetitionMatchResponse) => void;
}) {
  const rounds = [...new Set(preview.matches.map((match) => match.roundNumber))]
    .sort((left, right) => left - right);
  return <div className="allocation-schedule-preview">
    <div className="allocation-schedule-preview__heading">
      <div><span>MATCHDAY</span><strong>赛程预览</strong></div>
      <span>{preview.roundCount} 轮 · {preview.matchCount} 场</span>
    </div>
    <div className="fixture-round-list">{rounds.map((roundNumber) => {
      const matches = preview.matches
        .filter((match) => match.roundNumber === roundNumber)
        .sort((left, right) => left.matchNumber - right.matchNumber);
      return <section key={roundNumber} className="fixture-round">
        <header><span>ROUND {String(roundNumber).padStart(2, '0')}</span><strong>第 {roundNumber} 轮</strong><small>{matches.length} 场</small></header>
        <div className="fixture-round__matches">{matches.map((match) => <div key={match.id} className="fixture-match">
          <div className="fixture-team fixture-team--home">
            <span className="fixture-team__identity">
              <strong title={match.homeParticipant.displayName}>{match.homeParticipant.displayName}</strong>
              {match.homeParticipant.ownerDisplayName ? <small>玩家：{match.homeParticipant.ownerDisplayName}</small> : null}
            </span>
            <TeamCrest name={match.homeParticipant.displayName} url={match.homeParticipant.teamLogoUrl} />
          </div>
          <div className="fixture-match__versus">
            <span>{match.officialResult ? `${match.officialResult.homeScore} : ${match.officialResult.awayScore}` : 'VS'}</span>
            <small>#{match.matchNumber}</small>
            {onEditScore ? <Button
              size="small"
              type="link"
              className={`fixture-score-action ${match.officialResult ? 'fixture-score-action--recorded' : 'fixture-score-action--pending'}`}
              disabled={match.homeParticipant.teamLifecycleStatus === 'ARCHIVED' || match.awayParticipant.teamLifecycleStatus === 'ARCHIVED'}
              onClick={() => onEditScore(match)}
            >{match.officialResult ? '修改比分' : '录入比分'}</Button> : null}
          </div>
          <div className="fixture-team fixture-team--away">
            <TeamCrest name={match.awayParticipant.displayName} url={match.awayParticipant.teamLogoUrl} />
            <span className="fixture-team__identity">
              <strong title={match.awayParticipant.displayName}>{match.awayParticipant.displayName}</strong>
              {match.awayParticipant.ownerDisplayName ? <small>玩家：{match.awayParticipant.ownerDisplayName}</small> : null}
            </span>
          </div>
        </div>)}</div>
      </section>;
    })}</div>
  </div>;
}

export function AllocationPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [seasons, setSeasons] = useState<LeagueSeasonSummary[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [proposal, setProposal] = useState<SeasonAllocationProposal | null>(null);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [scheduleVersions, setScheduleVersions] = useState<Record<string, number>>({});
  const [schedulePreviews, setSchedulePreviews] = useState<Record<string, SchedulePreview>>({});
  const [scheduleModes, setScheduleModes] = useState<Record<string, 'view' | 'manage'>>({});
  const [scheduleBusyStageId, setScheduleBusyStageId] = useState<string | null>(null);
  const [scoreEditor, setScoreEditor] = useState<CompetitionMatchResponse | null>(null);
  const [homeScore, setHomeScore] = useState<number | null>(null);
  const [awayScore, setAwayScore] = useState<number | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [scoreBusy, setScoreBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mutationKey = useMutationKey();
  const season = seasons.find((item) => item.id === seasonId) ?? null;

  const loadProposal = useCallback(async (targetSeasonId: string) => {
    if (!targetSeasonId) return;
    try {
      const result = await api.request(
        `/v1/admin/leagues/${leagueId}/seasons/${targetSeasonId}/allocation-proposals/latest`,
        { schema: SeasonAllocationProposalSchema }
      );
      setProposal(result);
      const decisions = new Map(result.confirmedAllocation?.decisions.map((decision) => [decision.seasonEntryId, decision]));
      setTargets(Object.fromEntries(result.rows.map((row) => [row.seasonEntryId, decisions.get(row.seasonEntryId)?.finalStageCode ?? row.suggestedStageCode])));
      setReasons(Object.fromEntries(result.confirmedAllocation?.decisions.map((decision) => [decision.seasonEntryId, decision.reason ?? '']) ?? []));
      if (result.confirmedAllocation) {
        setConfirmed(ConfirmedSchema.parse({
          seasonId: targetSeasonId,
          competitionId: result.confirmedAllocation.competitionId,
          stageCount: result.confirmedAllocation.stages.length,
          participantCount: result.confirmedAllocation.stages.reduce((total, stage) => total + stage.participantCount, 0),
          status: result.confirmedAllocation.seasonStatus === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'READY',
          version: result.confirmedAllocation.seasonVersion,
          stages: result.confirmedAllocation.stages
        }));
      } else setConfirmed(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) setProposal(null);
      else setError('分组建议加载失败，请重试');
    }
  }, [api, leagueId]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await api.request(`/v1/admin/leagues/${leagueId}/seasons`, { schema: SeasonListSchema });
      setSeasons(result.items);
      const selected = result.items.find((item) => ['ALLOCATION_REVIEW', 'READY', 'IN_PROGRESS'].includes(item.status))
        ?? result.items[0];
      setSeasonId(selected?.id ?? '');
      if (selected) await loadProposal(selected.id);
    } catch { setError('赛季数据加载失败，请重试'); }
    finally { setLoading(false); }
  }, [api, leagueId, loadProposal]);

  useEffect(() => { void load(); }, [load]);

  const stageOptions = useMemo(() => {
    const codes = new Set(proposal?.rows.map((row) => row.suggestedStageCode) ?? []);
    if (!season?.isFirstSeason) codes.add('SUPER');
    const championCount = Math.max(2, [...codes].filter((code) => code.startsWith('CHAMPION_')).length + 1);
    for (let index = 0; index < championCount; index += 1) codes.add(`CHAMPION_${String.fromCharCode(65 + index)}`);
    return [...codes].sort().map((code) => ({ label: stageLabel(code), value: code }));
  }, [proposal, season]);

  const generate = async () => {
    if (!season) return;
    setSubmitting(true); setError(null);
    try {
      const result = await api.request(`/v1/admin/leagues/${leagueId}/seasons/${season.id}/allocation-proposals`, {
        method: 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, schema: SeasonAllocationProposalSchema,
        body: { expectedSeasonVersion: season.version, randomSeed: Date.now() % 2_147_483_647 || 1 }
      });
      mutationKey.reset(); setProposal(result);
      setTargets(Object.fromEntries(result.rows.map((row) => [row.seasonEntryId, row.suggestedStageCode])));
    } catch { setError('生成建议失败，请确认赛季已进入分组确认阶段'); }
    finally { setSubmitting(false); }
  };

  const confirm = async () => {
    if (!season || !proposal) return;
    const overrides = proposal.rows.filter((row) => targets[row.seasonEntryId] !== row.suggestedStageCode).map((row) => ({
      seasonEntryId: row.seasonEntryId,
      targetStageCode: targets[row.seasonEntryId],
      reason: reasons[row.seasonEntryId]?.trim() ?? ''
    }));
    if (overrides.some((override) => !override.reason)) {
      setError('人工调整组别时必须填写原因'); return;
    }
    setSubmitting(true); setError(null);
    try {
      const result = await api.request(`/v1/admin/leagues/${leagueId}/seasons/${season.id}/allocation-decisions`, {
        method: 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, schema: ConfirmedSchema,
        body: { proposalId: proposal.id, expectedSeasonVersion: season.version, overrides }
      });
      mutationKey.reset(); setConfirmed(ConfirmedSchema.parse(result));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError('数据已被其他管理员更新，已为你刷新'); await load();
      } else setError('确认分组失败，请重试');
    } finally { setSubmitting(false); }
  };

  const generateSchedule = async (stageId: string) => {
    const stage = confirmed?.stages.find((item) => item.id === stageId);
    const version = stage?.version ?? scheduleVersions[stageId] ?? 1;
    setScheduleBusyStageId(stageId); setError(null); setNotice(null);
    try {
      const preview = await api.request(`/v1/admin/leagues/${leagueId}/competition-stages/${stageId}/schedule/generate`, {
        method: 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, schema: SchedulePreviewSchema,
        body: { expectedStageVersion: version }
      });
      mutationKey.reset();
      setScheduleVersions((current) => ({ ...current, [stageId]: preview.version }));
      setSchedulePreviews((current) => ({ ...current, [stageId]: preview }));
      setNotice(`赛程预览已生成，共 ${preview.matchCount} 场`);
      setConfirmed((current) => current ? {
        ...current,
        stages: current.stages.map((item) => item.id === stageId
          ? { ...item, version: preview.version, matchCount: preview.matchCount }
          : item)
      } : current);
    } catch {
      setError('生成赛程预览失败，请刷新后重试');
    } finally {
      setScheduleBusyStageId(null);
    }
  };

  const publishSchedule = async (stageId: string) => {
    if (!confirmed) return;
    const stageVersion = confirmed.stages.find((stage) => stage.id === stageId)?.version ?? scheduleVersions[stageId] ?? 1;
    const preview = await api.request(`/v1/admin/leagues/${leagueId}/competition-stages/${stageId}/schedule/publish`, {
      method: 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, schema: SchedulePreviewSchema,
      body: { expectedStageVersion: stageVersion, expectedSeasonVersion: confirmed.version }
    });
    mutationKey.reset();
    setScheduleVersions((current) => ({ ...current, [stageId]: preview.version }));
    setConfirmed((current) => current ? {
      ...current,
      status: 'IN_PROGRESS',
      version: current.status === 'READY' ? current.version + 1 : current.version,
      stages: current.stages.map((stage) => stage.id === stageId
        ? { ...stage, version: preview.version, status: 'PUBLISHED' }
        : stage)
    } : current);
  };

  const openPublishedSchedule = async (stageId: string, mode: 'view' | 'manage') => {
    if (scheduleModes[stageId] === mode) {
      setScheduleModes((current) => {
        const next = { ...current };
        delete next[stageId];
        return next;
      });
      return;
    }
    if (schedulePreviews[stageId]) {
      setScheduleModes((current) => ({ ...current, [stageId]: mode }));
      return;
    }
    setScheduleBusyStageId(stageId); setError(null);
    try {
      const preview = await api.request(`/v1/admin/leagues/${leagueId}/competition-stages/${stageId}/schedule`, {
        schema: SchedulePreviewSchema
      });
      setSchedulePreviews((current) => ({ ...current, [stageId]: preview }));
      setScheduleModes((current) => ({ ...current, [stageId]: mode }));
    } catch {
      setError('已发布赛程加载失败，请刷新后重试');
    } finally {
      setScheduleBusyStageId(null);
    }
  };

  const openScoreEditor = (match: CompetitionMatchResponse) => {
    setScoreEditor(match);
    setHomeScore(match.officialResult?.homeScore ?? null);
    setAwayScore(match.officialResult?.awayScore ?? null);
    setCorrectionReason('');
    setError(null);
  };

  const submitScore = async () => {
    if (!confirmed || !scoreEditor || homeScore === null || awayScore === null) return;
    if (scoreEditor.officialResult && !correctionReason.trim()) {
      setError('修改已有官方比分时必须填写修正原因');
      return;
    }
    setScoreBusy(true); setError(null); setNotice(null);
    try {
      const result = await api.request(
        `/v1/admin/leagues/${leagueId}/competitions/${confirmed.competitionId}/matches/${scoreEditor.id}/results`,
        {
          method: 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, schema: MatchResultVersionResponseSchema,
          body: {
            homeScore, awayScore, expectedVersion: scoreEditor.version,
            reason: correctionReason.trim() || null
          }
        }
      );
      mutationKey.reset();
      setSchedulePreviews((current) => Object.fromEntries(Object.entries(current).map(([stageId, preview]) => [
        stageId,
        {
          ...preview,
          matches: preview.matches.map((match) => match.id === scoreEditor.id ? {
            ...match,
            version: match.version + 1,
            status: 'ADMIN_DECIDED' as const,
            officialResult: {
              resultVersionId: result.id,
              version: result.version,
              homeScore: result.homeScore,
              awayScore: result.awayScore,
              status: 'OFFICIAL' as const
            }
          } : match)
        }
      ])));
      setScoreEditor(null);
      setNotice(`官方比分已更新：${result.homeScore} : ${result.awayScore}`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'VERSION_CONFLICT') {
        setError('该场比赛已被其他管理员更新，请重新打开赛程');
      } else if (caught instanceof ApiError && caught.code === 'RESULT_CORRECTION_REASON_REQUIRED') {
        setError('修改已有官方比分时必须填写修正原因');
      } else {
        setError('官方比分提交失败，请检查赛事状态后重试');
      }
    } finally {
      setScoreBusy(false);
    }
  };

  if (loading) return <div className="loading-block"><Spin /></div>;
  return <div className="allocation-workspace">
    <Card className="allocation-toolbar">
      <Space wrap><strong>分组与赛程</strong><Select aria-label="选择赛季" value={seasonId || undefined} placeholder="选择赛季" options={seasons.map((item) => ({ label: item.displayName, value: item.id }))} onChange={(value) => { setSeasonId(value); setConfirmed(null); void loadProposal(value); }} />
        <Button type="primary" disabled={season?.status !== 'ALLOCATION_REVIEW'} loading={submitting} onClick={() => void generate()}>生成分组建议</Button></Space>
      <p>先审阅系统建议，再确认正式组别；赛程发布后不可换组。</p>
    </Card>
    {error ? <Alert role="alert" showIcon type="error" title={error} /> : null}
    {notice ? <Alert role="status" showIcon type="success" title={notice} /> : null}
    {!proposal ? <Card><Empty description="当前赛季暂无分组建议" /></Card> : <Card title={`建议版本 ${proposal.version}`} className="data-card">
      {season?.isFirstSeason ? <Alert type="info" showIcon title="首赛季仅设置冠军组，不创建超级组" /> : null}
      <Table rowKey="seasonEntryId" pagination={false} dataSource={proposal.rows} columns={[
        { title: '球队', render: (_, row) => <span className="allocation-team-identity"><strong>{row.teamName}</strong><small>玩家：{row.ownerDisplayName}</small></span> },
        { title: '系统建议', render: (_, row) => <Tag>{stageLabel(row.suggestedStageCode)}</Tag> },
        { title: '最终组别', render: (_, row) => <Select aria-label={`${row.teamName}最终组别`} disabled={Boolean(confirmed)} value={targets[row.seasonEntryId]} options={stageOptions} onChange={(value) => setTargets((current) => ({ ...current, [row.seasonEntryId]: value }))} /> },
        { title: '调整说明', render: (_, row) => targets[row.seasonEntryId] !== row.suggestedStageCode ? <Input aria-label={`${row.teamName}调整原因`} disabled={Boolean(confirmed)} placeholder="必填调整原因" value={reasons[row.seasonEntryId] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [row.seasonEntryId]: event.target.value }))} /> : <span className="muted-copy">沿用建议</span> },
        { title: '状态', render: (_, row) => targets[row.seasonEntryId] !== row.suggestedStageCode ? <Tag color="gold">人工调整</Tag> : <Tag color="green">系统建议</Tag> }
      ]} />
      <Button type="primary" disabled={Boolean(confirmed)} loading={submitting} onClick={() => void confirm()}>确认正式分组</Button>
    </Card>}
    {confirmed ? <Card title="正式组别与赛程" className="data-card">
      <div className="allocation-stage-grid">{confirmed.stages.map((stage) => {
        const preview = schedulePreviews[stage.id];
        return <article key={stage.id} className="allocation-stage-card">
          <div className="allocation-stage-card__summary">
            <Tag color={stage.status === 'PUBLISHED' ? 'green' : 'gold'}>{stage.displayName}</Tag>
            <strong>{stage.participantCount} 支球队</strong>
            <span className="muted-copy">{stage.status === 'PUBLISHED' ? '赛程已发布' : stage.matchCount ? `${stage.matchCount} 场待发布` : '尚未生成赛程'}</span>
          </div>
          <Space>
            {stage.status === 'PUBLISHED'
              ? <>
                <Button loading={scheduleBusyStageId === stage.id && !preview} onClick={() => void openPublishedSchedule(stage.id, 'view')}>{scheduleModes[stage.id] === 'view' ? '收起赛程' : '查看赛程'}</Button>
                <Button type={scheduleModes[stage.id] === 'manage' ? 'primary' : 'default'} loading={scheduleBusyStageId === stage.id && !preview} onClick={() => void openPublishedSchedule(stage.id, 'manage')}>{scheduleModes[stage.id] === 'manage' ? '收起比分管理' : '比分管理'}</Button>
              </>
              : <Button loading={scheduleBusyStageId === stage.id} onClick={() => void generateSchedule(stage.id)}>{preview ? '重新生成预览' : '生成预览'}</Button>}
            <Button type="primary" disabled={stage.status === 'PUBLISHED' || stage.matchCount === 0} onClick={() => void publishSchedule(stage.id)}>发布赛程</Button>
          </Space>
          {preview && (stage.status !== 'PUBLISHED' || scheduleModes[stage.id])
            ? <ScheduleBoard preview={preview} onEditScore={scheduleModes[stage.id] === 'manage' ? openScoreEditor : undefined} />
            : null}
        </article>;
      })}</div>
    </Card> : null}
    <Modal
      open={Boolean(scoreEditor)}
      title={scoreEditor?.officialResult ? '修改官方比分' : '录入官方比分'}
      okText="确认提交"
      cancelText="取消"
      confirmLoading={scoreBusy}
      onOk={() => void submitScore()}
      onCancel={() => { if (!scoreBusy) setScoreEditor(null); }}
    >
      {scoreEditor ? <div className="score-editor">
        <div className="score-editor__fixture">
          <strong>{scoreEditor.homeParticipant.displayName}</strong><span>对阵</span><strong>{scoreEditor.awayParticipant.displayName}</strong>
        </div>
        <div className="score-editor__inputs">
          <InputNumber aria-label="主队比分" min={0} max={99} precision={0} value={homeScore} onChange={setHomeScore} placeholder="主队" />
          <span>:</span>
          <InputNumber aria-label="客队比分" min={0} max={99} precision={0} value={awayScore} onChange={setAwayScore} placeholder="客队" />
        </div>
        {scoreEditor.officialResult ? <Input.TextArea
          aria-label="比分修正原因"
          value={correctionReason}
          onChange={(event) => setCorrectionReason(event.target.value)}
          placeholder="修改已有官方比分时必须填写原因"
          maxLength={512}
        /> : null}
      </div> : null}
    </Modal>
  </div>;
}
