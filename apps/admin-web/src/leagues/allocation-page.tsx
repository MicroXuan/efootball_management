import { Alert, Button, Card, Empty, Input, InputNumber, Modal, Select, Space, Spin, Table, Tag } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  LeagueSeasonSummarySchema,
  CompetitionMatchResponseSchema,
  MatchResultVersionResponseSchema,
  SeasonAllocationProposalSchema,
  SeasonRosterReadinessResponseSchema,
  type CompetitionMatchResponse,
  type LeagueSeasonSummary,
  type SeasonAllocationProposal
} from '@efm/contracts';
import { z } from 'zod';
import { adminApi, ApiError, type AdminApi } from '../lib/api';
import { formatDateTime } from '../lib/date-time';
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
  version: z.number(), roundCount: z.number(), matchCount: z.number(), matches: z.array(CompetitionMatchResponseSchema.extend({
    wechatMatchNo: z.number().int().positive().nullable().default(null)
  }))
});
const StageParticipantsSchema = z.array(z.object({
  id: z.string(), displayName: z.string(), teamNumber: z.number().nullable().default(null),
  ownerDisplayName: z.string().nullable().default(null), teamName: z.string().nullable().default(null)
}));
type Confirmed = z.infer<typeof ConfirmedSchema>;
type SchedulePreview = z.infer<typeof SchedulePreviewSchema>;
type RosterReadiness = z.infer<typeof SeasonRosterReadinessResponseSchema>;
const rosterIssueLabels: Record<RosterReadiness['teams'][number]['issues'][number], string> = {
  UNDER_MINIMUM: '少于 16 人', OVER_MAXIMUM: '超过 25 人', NO_GOALKEEPER: '缺少默认位置为 GK 的球员',
  SALARY_CAP_UNSET: '未设置工资帽', OVER_CAP: '超出工资帽'
};

const stageLabel = (code: string) => code === 'SUPER' ? '超级组' : `冠军 ${code.replace('CHAMPION_', '')} 组`;
const championCode = (index: number) => {
  let value = index + 1;
  let letters = '';
  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(65 + value % 26) + letters;
    value = Math.floor(value / 26);
  }
  return `CHAMPION_${letters}`;
};

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
            <small>赛程 #{match.matchNumber}</small>
            {preview.status === 'PUBLISHED' ? <small>{match.wechatMatchNo ? `微信报分 M${match.wechatMatchNo}` : '微信 M 编号未生成'}</small> : null}
            {match.plannedAt ? <small>{formatDateTime(match.plannedAt)}</small> : null}
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
  const [rosterReadiness, setRosterReadiness] = useState<RosterReadiness | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [scheduleVersions, setScheduleVersions] = useState<Record<string, number>>({});
  const [schedulePreviews, setSchedulePreviews] = useState<Record<string, SchedulePreview>>({});
  const [scheduleModes, setScheduleModes] = useState<Record<string, 'view' | 'manage'>>({});
  const [activeScheduleStageId, setActiveScheduleStageId] = useState<string | null>(null);
  const [scheduleBusyStageId, setScheduleBusyStageId] = useState<string | null>(null);
  const [scoreEditor, setScoreEditor] = useState<CompetitionMatchResponse | null>(null);
  const [homeScore, setHomeScore] = useState<number | null>(null);
  const [awayScore, setAwayScore] = useState<number | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [scoreBusy, setScoreBusy] = useState(false);
  const [matchStageId, setMatchStageId] = useState<string | null>(null);
  const [matchParticipants, setMatchParticipants] = useState<z.infer<typeof StageParticipantsSchema>>([]);
  const [matchHomeId, setMatchHomeId] = useState<string | null>(null);
  const [matchAwayId, setMatchAwayId] = useState<string | null>(null);
  const [matchRound, setMatchRound] = useState<number | null>(1);
  const [matchTime, setMatchTime] = useState('');
  const [matchBusy, setMatchBusy] = useState(false);
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

  const loadRosterReadiness = useCallback(async (targetSeasonId: string) => {
    try {
      const result = await api.request(`/v1/admin/leagues/${leagueId}/seasons/${targetSeasonId}/roster-readiness`, {
        schema: SeasonRosterReadinessResponseSchema
      });
      setRosterReadiness(result);
    } catch {
      setRosterReadiness(null);
      setError('开赛阵容校验加载失败，请刷新后重试');
    }
  }, [api, leagueId]);
  useEffect(() => {
    setRosterReadiness(null);
    if (confirmed?.status === 'READY') void loadRosterReadiness(confirmed.seasonId);
  }, [confirmed?.seasonId, confirmed?.status, loadRosterReadiness]);

  const stageOptions = useMemo(() => {
    const codes = new Set(proposal?.rows.map((row) => row.suggestedStageCode) ?? []);
    if (!season?.isFirstSeason) codes.add('SUPER');
    const championCount = Math.max(2,
      Math.ceil((proposal?.rows.length ?? 0) / Math.max(1, season?.championCapacity ?? 18)) + 1,
      [...codes].filter((code) => code.startsWith('CHAMPION_')).length + 1);
    for (let index = 0; index < championCount; index += 1) codes.add(championCode(index));
    return [...codes].sort().map((code) => ({ label: stageLabel(code), value: code }));
  }, [proposal, season]);
  const matchParticipantOptions = useMemo(() => matchParticipants.map((item) => ({
    label: `${item.teamNumber === null ? '未编号' : `${item.teamNumber}号`} · ${item.ownerDisplayName ?? '未知用户'} · ${item.teamName ?? item.displayName}`,
    value: item.id
  })), [matchParticipants]);

  const generate = async (mode: 'AUTO' | 'MANUAL' = 'AUTO') => {
    if (!season) return;
    setSubmitting(true); setError(null);
    try {
      const result = await api.request(`/v1/admin/leagues/${leagueId}/seasons/${season.id}/allocation-proposals`, {
        method: 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, schema: SeasonAllocationProposalSchema,
        body: { expectedSeasonVersion: season.version, randomSeed: Date.now() % 2_147_483_647 || 1, mode }
      });
      mutationKey.reset(); setProposal(result); setConfirmed(null); setReasons({});
      setTargets(Object.fromEntries(result.rows.map((row) => [row.seasonEntryId, row.suggestedStageCode])));
    } catch { setError(mode === 'MANUAL' ? '创建手动分组失败，请确认赛季已进入分组确认阶段' : '生成建议失败，请确认赛季已进入分组确认阶段'); }
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
      setActiveScheduleStageId(stageId);
      setNotice(`赛程预览已生成，共 ${preview.matchCount} 场`);
      setConfirmed((current) => current ? {
        ...current,
        stages: current.stages.map((item) => item.id === stageId
          ? { ...item, version: preview.version, matchCount: preview.matchCount }
          : item)
      } : current);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === 'SCHEDULE_MANUAL_MATCHES_PRESENT'
        ? '已有手动安排的比赛，不能自动覆盖'
        : '生成赛程预览失败，请刷新后重试');
    } finally {
      setScheduleBusyStageId(null);
    }
  };

  const publishSchedule = async (stageId: string) => {
    if (!confirmed) return;
    setError(null); setScheduleBusyStageId(stageId);
    try {
      const stageVersion = confirmed.stages.find((stage) => stage.id === stageId)?.version ?? scheduleVersions[stageId] ?? 1;
      const preview = await api.request(`/v1/admin/leagues/${leagueId}/competition-stages/${stageId}/schedule/publish`, {
        method: 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, schema: SchedulePreviewSchema,
        body: { expectedStageVersion: stageVersion, expectedSeasonVersion: confirmed.version }
      });
      mutationKey.reset();
      setScheduleVersions((current) => ({ ...current, [stageId]: preview.version }));
      setSchedulePreviews((current) => ({ ...current, [stageId]: preview }));
      setConfirmed((current) => current ? {
        ...current,
        status: 'IN_PROGRESS',
        version: current.status === 'READY' ? current.version + 1 : current.version,
        stages: current.stages.map((stage) => stage.id === stageId
          ? { ...stage, version: preview.version, status: 'PUBLISHED' }
          : stage)
      } : current);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === 'SEASON_ROSTER_NOT_READY'
        ? '开赛阵容未达标，请查看下方逐队校验结果并刷新'
        : '发布赛程失败，请刷新后重试');
      if (confirmed.status === 'READY') await loadRosterReadiness(confirmed.seasonId);
    } finally { setScheduleBusyStageId(null); }
  };

  const openMatchEditor = async (stageId: string) => {
    setError(null);
    try {
      const participants = await api.request(`/v1/admin/leagues/${leagueId}/competition-stages/${stageId}/participants`, {
        schema: StageParticipantsSchema
      });
      setMatchParticipants(participants);
      setMatchHomeId(null); setMatchAwayId(null); setMatchRound(1); setMatchTime('');
      setMatchStageId(stageId);
    } catch { setError('组别球队加载失败，请重试'); }
  };

  const submitMatch = async () => {
    if (!matchStageId || !matchHomeId || !matchAwayId || !matchRound || !matchTime) {
      setError('请选择双方球队、轮次和开赛时间'); return;
    }
    if (matchHomeId === matchAwayId) { setError('主队和客队不能相同'); return; }
    const plannedAt = new Date(`${matchTime}:00+08:00`);
    if (Number.isNaN(plannedAt.valueOf())) { setError('开赛时间无效'); return; }
    const stage = confirmed?.stages.find((item) => item.id === matchStageId);
    setMatchBusy(true); setError(null);
    try {
      const preview = await api.request(`/v1/admin/leagues/${leagueId}/competition-stages/${matchStageId}/matches`, {
        method: 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, schema: SchedulePreviewSchema,
        body: {
          expectedStageVersion: stage?.version ?? scheduleVersions[matchStageId] ?? 1,
          roundNumber: matchRound,
          homeParticipantId: matchHomeId,
          awayParticipantId: matchAwayId,
          plannedAt: plannedAt.toISOString()
        }
      });
      mutationKey.reset();
      setSchedulePreviews((current) => ({ ...current, [matchStageId]: preview }));
      setScheduleVersions((current) => ({ ...current, [matchStageId]: preview.version }));
      setConfirmed((current) => current ? {
        ...current,
        stages: current.stages.map((item) => item.id === matchStageId
          ? { ...item, matchCount: preview.matchCount, version: preview.version } : item)
      } : current);
      setActiveScheduleStageId(matchStageId);
      setScheduleModes((current) => ({ ...current, [matchStageId]: 'view' }));
      setMatchStageId(null);
      setNotice('比赛已加入赛程');
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === 'SCHEDULE_PAIR_ALREADY_EXISTS'
        ? '这两支球队已有一场比赛'
        : caught instanceof ApiError && caught.code === 'SCHEDULE_ROUND_CONFLICT'
          ? '同一轮中每支球队只能参加一场比赛'
          : '新增比赛失败，请检查组别和版本后重试');
    } finally { setMatchBusy(false); }
  };

  const openPublishedSchedule = async (stageId: string, mode: 'view' | 'manage') => {
    if (scheduleModes[stageId] === mode) {
      setScheduleModes((current) => {
        const next = { ...current };
        delete next[stageId];
        return next;
      });
      setActiveScheduleStageId(null);
      return;
    }
    if (schedulePreviews[stageId]) {
      setScheduleModes((current) => ({ ...current, [stageId]: mode }));
      setActiveScheduleStageId(stageId);
      return;
    }
    setScheduleBusyStageId(stageId); setError(null);
    try {
      const preview = await api.request(`/v1/admin/leagues/${leagueId}/competition-stages/${stageId}/schedule`, {
        schema: SchedulePreviewSchema
      });
      setSchedulePreviews((current) => ({ ...current, [stageId]: preview }));
      setScheduleModes((current) => ({ ...current, [stageId]: mode }));
      setActiveScheduleStageId(stageId);
    } catch {
      setError('已发布赛程加载失败，请刷新后重试');
    } finally {
      setScheduleBusyStageId(null);
    }
  };

  const ensureWechatMatchNumbers = async (stageId: string) => {
    setScheduleBusyStageId(stageId); setError(null);
    try {
      const preview = await api.request(`/v1/admin/leagues/${leagueId}/competition-stages/${stageId}/wechat-match-numbers`, {
        method: 'POST', schema: SchedulePreviewSchema
      });
      setSchedulePreviews((current) => ({ ...current, [stageId]: preview }));
      setNotice('微信报分 M 编号已生成，可按赛程中的 M 编号私聊机器人报分');
    } catch {
      setError('生成微信 M 编号失败，请重试');
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
    if (!correctionReason.trim()) {
      setError(scoreEditor.officialResult ? '修改已有官方比分时必须填写修正原因' : '录入官方比分时必须填写原因');
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
            reason: correctionReason.trim()
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
  const activeScheduleStage = confirmed?.stages.find(({ id }) => id === activeScheduleStageId) ?? null;
  const activeSchedulePreview = activeScheduleStage ? schedulePreviews[activeScheduleStage.id] : null;
  return <div className="allocation-workspace">
    <Card className="allocation-toolbar">
      <Space wrap><strong>分组与赛程</strong><Select aria-label="选择赛季" value={seasonId || undefined} placeholder="选择赛季" options={seasons.map((item) => ({ label: item.displayName, value: item.id }))} onChange={(value) => { setSeasonId(value); setConfirmed(null); void loadProposal(value); }} />
        <Button type="primary" disabled={season?.status !== 'ALLOCATION_REVIEW'} loading={submitting} onClick={() => void generate('AUTO')}>生成分组建议</Button>
        <Button disabled={season?.status !== 'ALLOCATION_REVIEW'} loading={submitting} onClick={() => void generate('MANUAL')}>手动创建分组</Button></Space>
      <p>可采用系统建议或手动分组；组别确认后可逐场安排比赛，赛程发布后不可换组。</p>
    </Card>
    {error ? <Alert role="alert" showIcon type="error" title={error} /> : null}
    {notice ? <Alert role="status" showIcon type="success" title={notice} /> : null}
    {!proposal ? <Card><Empty description="当前赛季暂无分组草案" /></Card> : <Card title={`${proposal.algorithmVersion === 'manual-v1' ? '手动分组' : '建议'}版本 ${proposal.version}`} className="data-card">
      {season?.isFirstSeason ? <Alert type="info" showIcon title="首赛季仅设置冠军组，不创建超级组" /> : null}
      <Table rowKey="seasonEntryId" pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }} dataSource={proposal.rows} columns={[
        { title: '球队', render: (_, row) => <span className="allocation-team-identity"><strong>{row.teamName}</strong><small>玩家：{row.ownerDisplayName}</small></span> },
        { title: proposal.algorithmVersion === 'manual-v1' ? '初始组别' : '系统建议', render: (_, row) => <Tag>{stageLabel(row.suggestedStageCode)}</Tag> },
        { title: '最终组别', render: (_, row) => <Select aria-label={`${row.teamName}最终组别`} disabled={Boolean(confirmed)} value={targets[row.seasonEntryId]} options={stageOptions} onChange={(value) => {
          setTargets((current) => ({ ...current, [row.seasonEntryId]: value }));
          if (proposal.algorithmVersion === 'manual-v1' && value !== row.suggestedStageCode) {
            setReasons((current) => ({ ...current, [row.seasonEntryId]: current[row.seasonEntryId] || '管理员手动分组' }));
          }
        }} /> },
        { title: '调整说明', render: (_, row) => targets[row.seasonEntryId] !== row.suggestedStageCode ? <Input aria-label={`${row.teamName}调整原因`} disabled={Boolean(confirmed)} placeholder="必填调整原因" value={reasons[row.seasonEntryId] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [row.seasonEntryId]: event.target.value }))} /> : <span className="muted-copy">{proposal.algorithmVersion === 'manual-v1' ? '保留当前组别' : '沿用建议'}</span> },
        { title: '状态', render: (_, row) => targets[row.seasonEntryId] !== row.suggestedStageCode ? <Tag color="gold">人工调整</Tag> : <Tag color={proposal.algorithmVersion === 'manual-v1' ? 'blue' : 'green'}>{proposal.algorithmVersion === 'manual-v1' ? '手动分组' : '系统建议'}</Tag> }
      ]} />
      <Button type="primary" disabled={Boolean(confirmed)} loading={submitting} onClick={() => void confirm()}>确认正式分组</Button>
    </Card>}
    {confirmed?.status === 'READY' ? <Card title="开赛阵容校验" className="data-card">
      <Space orientation="vertical" style={{ width: '100%' }}>
        <Space><Tag color={rosterReadiness?.ready ? 'success' : 'warning'}>{rosterReadiness?.ready ? '全部合格' : '待处理'}</Tag><Button onClick={() => void loadRosterReadiness(confirmed.seasonId)}>刷新校验</Button></Space>
        {rosterReadiness ? <Table rowKey="leagueTeamId" pagination={{ pageSize: 10 }} dataSource={rosterReadiness.teams} columns={[
          { title: '球队', render: (_, row) => `${row.teamNumber ?? '—'}号 · ${row.teamName}` },
          { title: '现役人数', dataIndex: 'playerCount' },
          { title: 'GK 人数', dataIndex: 'goalkeeperCount' },
          { title: '工资 / 工资帽', render: (_, row) => `${row.salaryMinor} / ${row.salaryCapMinor ?? '未设置'}` },
          { title: '校验结果', render: (_, row) => row.issues.length ? row.issues.map((issue) => rosterIssueLabels[issue]).join('、') : '合格' }
        ]} /> : <span className="muted-copy">正在检查参赛球队阵容…</span>}
      </Space>
    </Card> : null}
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
            <Button onClick={() => void openMatchEditor(stage.id)}>逐场添加比赛</Button>
            {stage.status === 'PUBLISHED'
              ? <>
                <Button loading={scheduleBusyStageId === stage.id && !preview} onClick={() => void openPublishedSchedule(stage.id, 'view')}>{scheduleModes[stage.id] === 'view' ? '收起赛程' : '查看赛程'}</Button>
                <Button type={scheduleModes[stage.id] === 'manage' ? 'primary' : 'default'} loading={scheduleBusyStageId === stage.id && !preview} onClick={() => void openPublishedSchedule(stage.id, 'manage')}>{scheduleModes[stage.id] === 'manage' ? '收起比分管理' : '比分管理'}</Button>
              </>
              : <Button loading={scheduleBusyStageId === stage.id}
                  disabled={Boolean(preview?.matches.some((match) => match.plannedAt))}
                  onClick={() => void generateSchedule(stage.id)}>
                  {preview?.matches.some((match) => match.plannedAt) ? '已有手动比赛' : preview ? '重新生成预览' : '生成预览'}
                </Button>}
            <Button type="primary" disabled={stage.status === 'PUBLISHED' || (confirmed.status === 'READY' && !rosterReadiness?.ready)} loading={scheduleBusyStageId === stage.id} onClick={() => void publishSchedule(stage.id)}>{stage.matchCount === 0 ? '发布组别（暂不安排比赛）' : '发布赛程'}</Button>
          </Space>
        </article>;
      })}</div>
      {activeScheduleStage && activeSchedulePreview ? <section className="allocation-schedule-panel" aria-label={`${activeScheduleStage.displayName}赛程`}>
        <header className="allocation-schedule-panel__header">
          <div><span className="section-kicker">当前查看</span><h3>{activeScheduleStage.displayName}赛程</h3></div>
          <Tag color={activeScheduleStage.status === 'PUBLISHED' ? 'green' : 'gold'}>{activeScheduleStage.status === 'PUBLISHED' ? '已发布' : '预览'}</Tag>
          {activeScheduleStage.status === 'PUBLISHED' && activeSchedulePreview.matches.some((match) => !match.wechatMatchNo)
            ? <Button loading={scheduleBusyStageId === activeScheduleStage.id} onClick={() => void ensureWechatMatchNumbers(activeScheduleStage.id)}>生成微信 M 编号</Button>
            : null}
        </header>
        <ScheduleBoard preview={activeSchedulePreview} onEditScore={scheduleModes[activeScheduleStage.id] === 'manage' ? openScoreEditor : undefined} />
      </section> : null}
    </Card> : null}
    <Modal open={Boolean(matchStageId)} title="逐场添加比赛" okText="添加比赛" cancelText="取消"
      confirmLoading={matchBusy} onOk={() => void submitMatch()} onCancel={() => { if (!matchBusy) setMatchStageId(null); }}>
      <div className="match-editor">
        <div className="match-editor__teams">
          <label>主队<Select aria-label="主队" placeholder="选择主队" value={matchHomeId} showSearch optionFilterProp="label"
            options={matchParticipantOptions} onChange={setMatchHomeId} /></label>
          <label>客队<Select aria-label="客队" placeholder="选择客队" value={matchAwayId} showSearch optionFilterProp="label"
            options={matchParticipantOptions} onChange={setMatchAwayId} /></label>
        </div>
        <div className="match-editor__details">
          <label>比赛轮次<InputNumber aria-label="轮次" min={1} precision={0} value={matchRound} onChange={setMatchRound} /></label>
          <label>开赛时间（北京时间）<Input aria-label="开赛时间（北京时间）" type="datetime-local" value={matchTime} onChange={(event) => setMatchTime(event.target.value)} /></label>
        </div>
        <p className="match-editor__hint">轮次 1 表示第 1 轮；同一轮每支球队只能参加一场比赛。</p>
      </div>
    </Modal>
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
          <InputNumber aria-label="主队比分" controls={false} min={0} max={99} precision={0} value={homeScore} onChange={setHomeScore} placeholder="主队" />
          <span>:</span>
          <InputNumber aria-label="客队比分" controls={false} min={0} max={99} precision={0} value={awayScore} onChange={setAwayScore} placeholder="客队" />
        </div>
        <Input.TextArea
          aria-label={scoreEditor.officialResult ? '比分修正原因' : '比分录入原因'}
          value={correctionReason}
          onChange={(event) => setCorrectionReason(event.target.value)}
          placeholder={scoreEditor.officialResult ? '修改已有官方比分时必须填写原因' : '请填写录入官方比分的依据'}
          maxLength={512}
        />
      </div> : null}
    </Modal>
  </div>;
}
