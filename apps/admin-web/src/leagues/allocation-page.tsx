import { Alert, Button, Card, Empty, Input, Select, Space, Spin, Table, Tag } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  LeagueSeasonSummarySchema,
  SeasonAllocationProposalSchema,
  type LeagueSeasonSummary,
  type SeasonAllocationProposal
} from '@efm/contracts';
import { z } from 'zod';
import { adminApi, ApiError, type AdminApi } from '../lib/api';
import { useMutationKey } from '../lib/mutation-key';

const SeasonListSchema = z.object({ items: z.array(LeagueSeasonSummarySchema), nextCursor: z.string().nullable() });
const ConfirmedSchema = z.object({
  seasonId: z.string(), competitionId: z.string(), stageCount: z.number(), participantCount: z.number(),
  status: z.literal('READY'), version: z.number(),
  stages: z.array(z.object({ id: z.string(), stageCode: z.string(), displayName: z.string(), participantCount: z.number() }))
});
const SchedulePreviewSchema = z.object({
  id: z.string(), competitionId: z.string(), status: z.enum(['DRAFT', 'PUBLISHED']),
  version: z.number(), roundCount: z.number(), matchCount: z.number(), matches: z.array(z.unknown())
});
type Confirmed = z.infer<typeof ConfirmedSchema>;

const stageLabel = (code: string) => code === 'SUPER' ? '超级组' : `冠军 ${code.replace('CHAMPION_', '')} 组`;

export function AllocationPage({ api = adminApi }: { api?: AdminApi }) {
  const { leagueId = '' } = useParams();
  const [seasons, setSeasons] = useState<LeagueSeasonSummary[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [proposal, setProposal] = useState<SeasonAllocationProposal | null>(null);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [scheduleVersions, setScheduleVersions] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setTargets(Object.fromEntries(result.rows.map((row) => [row.seasonEntryId, row.suggestedStageCode])));
      setReasons({});
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
      mutationKey.reset(); setConfirmed(result);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError('数据已被其他管理员更新，已为你刷新'); await load();
      } else setError('确认分组失败，请重试');
    } finally { setSubmitting(false); }
  };

  const generateSchedule = async (stageId: string) => {
    const version = scheduleVersions[stageId] ?? 1;
    const preview = await api.request(`/v1/admin/leagues/${leagueId}/competition-stages/${stageId}/schedule/generate`, {
      method: 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, schema: SchedulePreviewSchema,
      body: { expectedStageVersion: version }
    });
    mutationKey.reset(); setScheduleVersions((current) => ({ ...current, [stageId]: preview.version }));
  };

  const publishSchedule = async (stageId: string) => {
    if (!confirmed) return;
    const preview = await api.request(`/v1/admin/leagues/${leagueId}/competition-stages/${stageId}/schedule/publish`, {
      method: 'POST', headers: { 'Idempotency-Key': mutationKey.current() }, schema: SchedulePreviewSchema,
      body: { expectedStageVersion: scheduleVersions[stageId] ?? 1, expectedSeasonVersion: confirmed.version }
    });
    mutationKey.reset(); setScheduleVersions((current) => ({ ...current, [stageId]: preview.version }));
  };

  if (loading) return <div className="loading-block"><Spin /></div>;
  return <div className="allocation-workspace">
    <Card className="allocation-toolbar">
      <Space wrap><strong>分组与赛程</strong><Select aria-label="选择赛季" value={seasonId || undefined} placeholder="选择赛季" options={seasons.map((item) => ({ label: item.displayName, value: item.id }))} onChange={(value) => { setSeasonId(value); setConfirmed(null); void loadProposal(value); }} />
        <Button type="primary" disabled={season?.status !== 'ALLOCATION_REVIEW'} loading={submitting} onClick={() => void generate()}>生成分组建议</Button></Space>
      <p>先审阅系统建议，再确认正式组别；赛程发布后不可换组。</p>
    </Card>
    {error ? <Alert role="alert" showIcon type="error" title={error} /> : null}
    {!proposal ? <Card><Empty description="当前赛季暂无分组建议" /></Card> : <Card title={`建议版本 ${proposal.version}`} className="data-card">
      {season?.isFirstSeason ? <Alert type="info" showIcon title="首赛季仅设置冠军组，不创建超级组" /> : null}
      <Table rowKey="seasonEntryId" pagination={false} dataSource={proposal.rows} columns={[
        { title: '球队', dataIndex: 'teamName' },
        { title: '系统建议', render: (_, row) => <Tag>{stageLabel(row.suggestedStageCode)}</Tag> },
        { title: '最终组别', render: (_, row) => <Select aria-label={`${row.teamName}最终组别`} disabled={Boolean(confirmed)} value={targets[row.seasonEntryId]} options={stageOptions} onChange={(value) => setTargets((current) => ({ ...current, [row.seasonEntryId]: value }))} /> },
        { title: '调整说明', render: (_, row) => targets[row.seasonEntryId] !== row.suggestedStageCode ? <Input aria-label={`${row.teamName}调整原因`} disabled={Boolean(confirmed)} placeholder="必填调整原因" value={reasons[row.seasonEntryId] ?? ''} onChange={(event) => setReasons((current) => ({ ...current, [row.seasonEntryId]: event.target.value }))} /> : <span className="muted-copy">沿用建议</span> },
        { title: '状态', render: (_, row) => targets[row.seasonEntryId] !== row.suggestedStageCode ? <Tag color="gold">人工调整</Tag> : <Tag color="green">系统建议</Tag> }
      ]} />
      <Button type="primary" disabled={Boolean(confirmed)} loading={submitting} onClick={() => void confirm()}>确认正式分组</Button>
    </Card>}
    {confirmed ? <Card title="正式组别与赛程" className="data-card"><div className="allocation-stage-grid">{confirmed.stages.map((stage) => <article key={stage.id} className="allocation-stage-card"><div><Tag color="green">{stage.displayName}</Tag><strong>{stage.participantCount} 支球队</strong></div><Space><Button onClick={() => void generateSchedule(stage.id)}>生成预览</Button><Button type="primary" disabled={!scheduleVersions[stage.id]} onClick={() => void publishSchedule(stage.id)}>发布赛程</Button></Space></article>)}</div></Card> : null}
  </div>;
}
