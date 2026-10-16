import { GUARDS_METADATA } from '@nestjs/common/constants';
import { randomUUID } from 'node:crypto';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { AdminMatchResultDisputesController } from './admin-match-result-disputes.controller.js';

describe('administrator dispute routes', () => {
  it('parses admin list and detail with the match token while excluding private storage keys', async () => {
    const id = randomUUID(); const time = new Date().toISOString();
    const record = { id, matchId: id, triggerResultVersionId: id, trigger: 'REJECTED', status: 'READY_FOR_REVIEW',
      competitionName: '测试联赛', stageName: '小组赛', homeParticipantName: '主队', awayParticipantName: '客队', submitterSide: 'HOME',
      triggerHomeScore: 2, triggerAwayScore: 1,
      openedByUserId: id, evidenceDeadlineAt: time, decidedByAdminId: null, decisionType: null, finalHomeScore: null, finalAwayScore: null,
      decisionReason: null, decidedAt: null, version: 2, matchVersion: 7, createdAt: time, updatedAt: time,
      objectKey: 'private-key', evidence: [], timeline: [] };
    const controller = new AdminMatchResultDisputesController({ list: async () => [record], detail: async () => record } as never, {} as never);
    const admin = { id, status: 'ACTIVE' as const, platformRole: null };
    const detail = await controller.detail(admin, id, id);
    expect(detail).toHaveProperty('matchVersion', 7);
    expect(detail).not.toHaveProperty('objectKey');
    expect(await controller.list(admin, id)).toEqual([detail]);
  });
  it('requires admin authentication on all list/detail/decision/upload/private object routes', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminMatchResultDisputesController)).toContain(AdminAuthGuard);
  });
});
