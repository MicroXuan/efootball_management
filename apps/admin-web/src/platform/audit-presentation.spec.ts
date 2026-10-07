import type { AuditLog } from '@efm/contracts';
import { presentAuditLog } from './audit-presentation';

const base: AuditLog = {
  id: '11111111-1111-4111-8111-111111111111',
  actorAdminId: '22222222-2222-4222-8222-222222222222',
  actorUserId: null,
  actorDisplayName: '小宣',
  leagueId: '33333333-3333-4333-8333-333333333333',
  leagueName: 'CELL 联赛',
  action: 'admin.league-season.set-current',
  resourceType: 'League',
  resourceId: '33333333-3333-4333-8333-333333333333',
  subjectDisplayName: 'S2',
  reason: null,
  metadata: { oldSeasonId: null, newSeasonId: '44444444-4444-4444-8444-444444444444' },
  createdAt: '2026-10-02T00:00:00.000Z'
};

it('presents a season switch as a Chinese business event', () => {
  expect(presentAuditLog(base)).toMatchObject({
    actor: '小宣',
    action: '设置当前赛季',
    subject: 'S2',
    result: '已完成',
    summary: '平台管理员“小宣”将 CELL 联赛的当前赛季设置为“S2”'
  });
});

it('presents a season rename as a specific operation', () => {
  expect(presentAuditLog({
    ...base,
    action: 'admin.league-season.rename',
    metadata: { displayName: 'S2 正式赛季' },
  })).toMatchObject({
    action: '修改赛季名称',
    subject: 'S2',
    summary: '平台管理员“小宣”对 S2 执行了“修改赛季名称”',
  });
});

it('presents a configured league center banner update explicitly', () => {
  expect(presentAuditLog({
    ...base,
    leagueId: null,
    leagueName: null,
    action: 'admin.platform-presentation.update',
    resourceType: 'PlatformPresentation',
    resourceId: 'global',
    subjectDisplayName: null,
    metadata: { leagueCenterBannerUrl: 'https://media.example.com/banner.webp' },
  })).toMatchObject({
    action: '更新联赛中心 Banner',
    subject: '联赛中心 Banner',
    summary: '平台管理员“小宣”更新了联赛中心 Banner',
  });
});

it('presents restoring the default league center background explicitly', () => {
  expect(presentAuditLog({
    ...base,
    leagueId: null,
    leagueName: null,
    action: 'admin.platform-presentation.update',
    resourceType: 'PlatformPresentation',
    resourceId: 'global',
    subjectDisplayName: null,
    metadata: { leagueCenterBannerUrl: null },
  })).toMatchObject({
    action: '恢复联赛中心默认背景',
    subject: '联赛中心 Banner',
    summary: '平台管理员“小宣”恢复了联赛中心默认背景',
  });
});

it('shows exact technical identifiers instead of vague copy for a future action', () => {
  expect(presentAuditLog({
    ...base,
    action: 'future.action',
    resourceType: 'FutureResource',
    subjectDisplayName: null,
    leagueName: null,
  })).toMatchObject({
    action: 'future.action',
    subject: 'FutureResource',
    summary: '平台管理员“小宣”对 FutureResource 执行了“future.action”',
  });
});

it('presents data synchronization actions with concrete Chinese business labels', () => {
  expect(presentAuditLog({
    ...base,
    leagueId: null,
    leagueName: null,
    action: 'BATCH_PUBLISH_TEAM_SHELLS',
    resourceType: 'TeamCatalogSyncItemBatch',
    subjectDisplayName: null,
    metadata: { requestedCount: 3, succeededCount: 1, failedCount: 2 },
  })).toMatchObject({
    action: '批量发布球队队壳',
    subject: '球队队壳同步项目',
    summary: '平台管理员“小宣”批量发布球队队壳：成功 1 条，失败 2 条',
  });
});
