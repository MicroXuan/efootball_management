import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaService } from '../../src/database/prisma.service.js';
import { MutationReceiptService } from '../../src/competitions/mutation-receipt.service.js';
import { ResultsService } from '../../src/competitions/results.service.js';
import { StandingsService } from '../../src/competitions/standings.service.js';
import { CupProgressionService } from '../../src/competitions/cup-progression.service.js';
import { MatchResultDisputesService } from '../../src/competitions/match-result-disputes.service.js';

config({ path: '../../.env', quiet: true });

export function disputeFixture() {
  const prisma = new PrismaService();
  const users = [randomUUID(), randomUUID(), randomUUID()];
  const ids: string[] = [];
  const receipts = new MutationReceiptService(prisma);
  const disputes = new MatchResultDisputesService(prisma, receipts);
  const results = new ResultsService(prisma, receipts, new StandingsService(prisma), new CupProgressionService());
  beforeAll(async () => {
    await prisma.$connect();
    await prisma.user.createMany({ data: users.map((id) => ({ id, wechatOpenId: `dispute-${id}`, displayName: '争议测试' })) });
  });
  afterEach(async () => {
    const matches = { match: { stage: { competitionId: { in: ids } } } };
    await prisma.mutationReceipt.deleteMany({ where: { actorId: { in: users } } });
    await prisma.matchResultEvent.deleteMany({ where: matches });
    await prisma.matchResultEvidence.deleteMany({ where: matches });
    await prisma.matchResultEvidenceUpload.deleteMany({ where: matches });
    await prisma.matchResultDispute.deleteMany({ where: matches });
    await prisma.matchResultVersion.deleteMany({ where: matches });
    await prisma.competitionMatch.deleteMany({ where: { stage: { competitionId: { in: ids } } } });
    await prisma.competitionStage.deleteMany({ where: { competitionId: { in: ids } } });
    await prisma.competitionParticipant.deleteMany({ where: { competitionId: { in: ids } } });
    await prisma.competitionRegistration.deleteMany({ where: { competitionId: { in: ids } } });
    await prisma.gameAccount.deleteMany({ where: { userId: { in: users } } });
    await prisma.competition.deleteMany({ where: { id: { in: ids } } });
    ids.splice(0);
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.$disconnect();
  });
  async function fixture() {
    const competition = await prisma.competition.create({ data: {
      name: '争议测试', description: '', platform: 'MOBILE', serverRegion: 'GLOBAL',
      participantType: 'INDIVIDUAL', format: 'ROUND_ROBIN', status: 'IN_PROGRESS',
      registrationOpensAt: new Date('2026-09-01'), registrationClosesAt: new Date('2026-09-02'),
      startsAt: new Date('2026-09-03'), endsAt: new Date('2026-12-01'), participantLimit: 2,
      createdById: users[0]!, activeRuleVersion: 1, boundRuleVersion: 1
    } });
    ids.push(competition.id);
    const participants = [];
    for (const [index, userId] of users.slice(0, 2).entries()) {
      const account = await prisma.gameAccount.create({ data: { userId, platform: 'MOBILE', serverRegion: 'GLOBAL', gamerTag: `dispute-${randomUUID()}` } });
      const registration = await prisma.competitionRegistration.create({ data: {
        competitionId: competition.id, applicantId: userId, gameAccountId: account.id, acceptedRuleVersion: 1, status: 'APPROVED'
      } });
      participants.push(await prisma.competitionParticipant.create({ data: {
        competitionId: competition.id, registrationId: registration.id, individualUserId: userId,
        admissionSequence: index + 1, displayNameSnapshot: '测试'
      } }));
    }
    const stage = await prisma.competitionStage.create({ data: { competitionId: competition.id, sequence: 1, status: 'PUBLISHED' } });
    const match = await prisma.competitionMatch.create({ data: {
      stageId: stage.id, roundNumber: 1, matchNumber: 1, pairingKey: randomUUID(),
      homeParticipantId: participants[0]!.id, awayParticipantId: participants[1]!.id, status: 'AWAITING_RESULT'
    } });
    const proposal = await results.submit(users[0]!, match.id, { homeScore: 2, awayScore: 1, expectedVersion: 1 }, randomUUID());
    return { match, proposal, competition, stage };
  }
  async function upload(matchId: string, role: 'SUBMITTER' | 'OPPONENT' = 'SUBMITTER', userId = users[role === 'SUBMITTER' ? 0 : 1]!) {
    return prisma.matchResultEvidenceUpload.create({ data: {
      matchId, role, uploadedByUserId: userId, objectKey: `match-result-evidence/${randomUUID()}.png`,
      mimeType: 'image/png', byteSize: 8, checksumSha256: 'a'.repeat(64), status: 'UPLOADED',
      completedAt: new Date(), expiresAt: new Date(Date.now() + 600_000)
    } });
  }
  async function rejected() {
    const data = await fixture();
    await results.reject(users[1]!, data.match.id, data.proposal.version, { expectedVersion: 2, reason: '比分不符' }, randomUUID());
    return data;
  }
  return { prisma, users, disputes, results, fixture, upload, rejected };
}
