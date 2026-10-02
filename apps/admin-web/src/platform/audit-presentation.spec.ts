import type { AuditLog } from '@efm/contracts';
import { presentAuditLog } from './audit-presentation';

const base: AuditLog = {
  id: '11111111-1111-4111-8111-111111111111',
  actorAdminId: '22222222-2222-4222-8222-222222222222',
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

it('uses a safe Chinese fallback for unknown actions', () => {
  expect(presentAuditLog({ ...base, action: 'future.action' }).action).toBe('其他后台操作');
});
