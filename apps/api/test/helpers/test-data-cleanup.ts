import type { PrismaService } from '../../src/database/prisma.service.js';

export interface TestArtifactCleanupResult {
  publisherSources: number;
  publisherCards: number;
  arbitrationLeagues: number;
  adminE2eLeagues: number;
  adminE2eUsers: number;
  orphanRosterAdmins: number;
  testUsers: number;
  testAdmins: number;
}

export async function cleanupKnownTestArtifacts(
  prisma: PrismaService
): Promise<TestArtifactCleanupResult> {
  return prisma.$transaction(async (tx) => {
    const publisherSources = await tx.dataSource.findMany({
      where: { name: 'Publisher test', code: { startsWith: 'publisher-' } },
      select: { id: true }
    });
    const sourceIds = publisherSources.map(({ id }) => id);
    const publisherCards = sourceIds.length === 0 ? [] : await tx.playerCard.findMany({
      where: { sourceId: { in: sourceIds } },
      select: { id: true, playerId: true, skills: { select: { skillId: true } } }
    });
    const cardIds = publisherCards.map(({ id }) => id);
    const playerIds = [...new Set(publisherCards.map(({ playerId }) => playerId))];
    const skillIds = [...new Set(publisherCards.flatMap(({ skills }) => skills.map(({ skillId }) => skillId)))];

    if (sourceIds.length > 0) {
      await tx.externalSyncRun.deleteMany({ where: { sourceId: { in: sourceIds } } });
      if (playerIds.length > 0) {
        await tx.footballPlayerBestCard.deleteMany({ where: { footballPlayerId: { in: playerIds } } });
      }
      if (cardIds.length > 0) {
        await tx.playerCardVersion.deleteMany({ where: { playerCardId: { in: cardIds } } });
      }
      await tx.catalogRelease.deleteMany({ where: { batch: { sourceId: { in: sourceIds } } } });
      await tx.importBatch.deleteMany({ where: { sourceId: { in: sourceIds } } });
      await tx.playerCard.deleteMany({ where: { sourceId: { in: sourceIds } } });
      await tx.cardPack.deleteMany({ where: { sourceId: { in: sourceIds } } });
      await tx.footballPlayerSource.deleteMany({ where: { sourceId: { in: sourceIds } } });
      if (playerIds.length > 0) {
        await tx.footballPlayer.deleteMany({ where: { id: { in: playerIds } } });
      }
      if (skillIds.length > 0) {
        await tx.skill.deleteMany({ where: { id: { in: skillIds }, cards: { none: {} } } });
      }
      await tx.dataSource.deleteMany({ where: { id: { in: sourceIds } } });
    }

    const disputeUsers = await tx.user.findMany({
      where: { displayName: '争议测试', wechatOpenId: { startsWith: 'dispute-' } },
      select: { id: true }
    });
    const disputeUserIds = disputeUsers.map(({ id }) => id);
    const disputeAdmins = await tx.adminAccount.findMany({
      where: { displayName: '仲裁员', username: { startsWith: 'arbitration-' } },
      select: { id: true }
    });
    const disputeAdminIds = disputeAdmins.map(({ id }) => id);
    const competitions = disputeUserIds.length === 0 ? [] : await tx.competition.findMany({
      where: { name: '争议测试', createdById: { in: disputeUserIds } },
      select: { id: true }
    });
    const competitionIds = competitions.map(({ id }) => id);

    if (competitionIds.length > 0) {
      const matchScope = { match: { stage: { competitionId: { in: competitionIds } } } };
      await tx.cupBracketPairing.updateMany({
        where: { round: { proposal: { competitionId: { in: competitionIds } } } },
        data: { homeSourcePairingId: null, awaySourcePairingId: null }
      });
      await tx.cupBracketPairing.deleteMany({
        where: { round: { proposal: { competitionId: { in: competitionIds } } } }
      });
      await tx.cupBracketRound.deleteMany({
        where: { proposal: { competitionId: { in: competitionIds } } }
      });
      await tx.cupBracketProposal.deleteMany({ where: { competitionId: { in: competitionIds } } });
      await tx.stageParticipant.deleteMany({ where: { stage: { competitionId: { in: competitionIds } } } });
      await tx.standingsRow.deleteMany({ where: { snapshot: { competitionId: { in: competitionIds } } } });
      await tx.standingsSnapshot.deleteMany({ where: { competitionId: { in: competitionIds } } });
      await tx.competitionMatch.updateMany({
        where: { stage: { competitionId: { in: competitionIds } } },
        data: { officialResultVersionId: null }
      });
      await tx.matchResultEvent.deleteMany({ where: matchScope });
      await tx.matchResultEvidence.deleteMany({ where: matchScope });
      await tx.matchResultEvidenceUpload.deleteMany({ where: matchScope });
      await tx.matchResultDispute.deleteMany({ where: matchScope });
      await tx.matchResultVersion.deleteMany({ where: matchScope });
      await tx.competitionMatch.deleteMany({ where: { stage: { competitionId: { in: competitionIds } } } });
      await tx.competitionStage.deleteMany({ where: { competitionId: { in: competitionIds } } });
      await tx.competitionParticipant.deleteMany({ where: { competitionId: { in: competitionIds } } });
      await tx.competitionRegistration.deleteMany({ where: { competitionId: { in: competitionIds } } });
      await tx.competitionRuleVersion.deleteMany({ where: { competitionId: { in: competitionIds } } });
      await tx.competition.deleteMany({ where: { id: { in: competitionIds } } });
    }

    const arbitrationLeagues = disputeUserIds.length === 0 ? [] : await tx.league.findMany({
      where: {
        name: '仲裁', shortName: '仲裁', createdById: { in: disputeUserIds },
        teams: { none: {} }
      },
      select: { id: true }
    });
    const leagueIds = arbitrationLeagues.map(({ id }) => id);
    if (leagueIds.length > 0) {
      await tx.auditLog.deleteMany({ where: { leagueId: { in: leagueIds } } });
      await tx.league.updateMany({ where: { id: { in: leagueIds } }, data: { currentSeasonId: null } });
      await tx.leagueSeason.deleteMany({ where: { leagueId: { in: leagueIds } } });
      await tx.league.deleteMany({ where: { id: { in: leagueIds } } });
    }

    const adminE2eLeagueCandidates = await tx.league.findMany({
      where: {
        OR: [
          { name: '测试联赛 A', shortName: '联赛A' },
          { name: '测试联赛 B', shortName: '联赛B' }
        ],
        seasons: { none: {} },
        teams: { none: {} },
        adminCreator: {
          username: { startsWith: 'platform-' },
          displayName: '平台管理员'
        }
      },
      select: { id: true, createdByAdminId: true, _count: true }
    });
    const adminE2eLeagues = adminE2eLeagueCandidates.filter(({ _count }) =>
      Object.entries(_count).every(([relation, count]) =>
        count === 0 || relation === 'adminRoles' || relation === 'auditLogs'
      )
    );
    const adminE2eLeagueIds = adminE2eLeagues.map(({ id }) => id);
    const adminE2eCreatorIds = adminE2eLeagues.flatMap(({ createdByAdminId }) =>
      createdByAdminId ? [createdByAdminId] : []
    );
    const adminE2eRoles = adminE2eLeagueIds.length === 0 ? [] : await tx.adminLeagueRole.findMany({
      where: {
        leagueId: { in: adminE2eLeagueIds },
        admin: { username: { startsWith: 'manager-' }, displayName: '联赛管理员' }
      },
      select: { adminId: true }
    });
    const adminE2eAdminIds = [...new Set([
      ...adminE2eCreatorIds,
      ...adminE2eRoles.map(({ adminId }) => adminId)
    ])];
    const adminE2eAdmins = adminE2eAdminIds.length === 0 ? [] : await tx.adminAccount.findMany({
      where: { id: { in: adminE2eAdminIds } },
      select: { id: true, _count: true }
    });
    const deletableAdminE2eAdminIds = adminE2eAdmins
      .filter(({ _count }) => Object.entries(_count).every(([relation, count]) =>
        count === 0 || [
          'leagueRoles',
          'grantedLeagueRoles',
          'auditLogs',
          'createdLeagues',
          'mutationReceipts'
        ].includes(relation)
      ))
      .map(({ id }) => id);
    const adminE2eUsers = await tx.user.findMany({
      where: { displayName: '六位编号用户', wechatOpenId: { startsWith: 'openid-' } },
      select: { id: true, _count: true }
    });
    const adminE2eUserIds = adminE2eUsers
      .filter(({ _count }) => Object.values(_count).every((count) => count === 0))
      .map(({ id }) => id);

    if (adminE2eLeagueIds.length > 0) {
      await tx.auditLog.deleteMany({
        where: {
          OR: [
            { leagueId: { in: adminE2eLeagueIds } },
            { actorAdminId: { in: deletableAdminE2eAdminIds } }
          ]
        }
      });
      await tx.adminMutationReceipt.deleteMany({
        where: { adminId: { in: deletableAdminE2eAdminIds } }
      });
      await tx.adminSession.deleteMany({ where: { adminId: { in: deletableAdminE2eAdminIds } } });
      await tx.adminLeagueRole.deleteMany({ where: { leagueId: { in: adminE2eLeagueIds } } });
      await tx.league.deleteMany({ where: { id: { in: adminE2eLeagueIds } } });
      await tx.adminAccount.deleteMany({ where: { id: { in: deletableAdminE2eAdminIds } } });
    }
    if (adminE2eUserIds.length > 0) {
      await tx.user.deleteMany({ where: { id: { in: adminE2eUserIds } } });
    }

    const publisherUsers = await tx.user.findMany({
      where: { displayName: '发布测试员', wechatOpenId: { startsWith: 'publisher-test-' } },
      select: { id: true }
    });
    const publisherAdmins = await tx.adminAccount.findMany({
      where: { displayName: '发布管理员', username: { startsWith: 'publisher-admin-' } },
      select: { id: true }
    });
    const rosterAdmins = await tx.adminAccount.findMany({
      where: { displayName: 'Roster Admin', username: { startsWith: 'roster-' } },
      select: { id: true, _count: true }
    });
    const orphanRosterAdminIds = rosterAdmins
      .filter(({ _count }) => Object.values(_count).every((count) => count === 0))
      .map(({ id }) => id);
    const testUserIds = [...new Set([...disputeUserIds, ...publisherUsers.map(({ id }) => id)])];
    const testAdminIds = [...new Set([
      ...disputeAdminIds,
      ...publisherAdmins.map(({ id }) => id),
      ...orphanRosterAdminIds
    ])];

    if (testUserIds.length > 0) {
      await tx.auditLog.deleteMany({ where: { actorUserId: { in: testUserIds } } });
      await tx.mutationReceipt.deleteMany({ where: { actorId: { in: testUserIds } } });
      await tx.gameAccount.deleteMany({ where: { userId: { in: testUserIds } } });
      await tx.user.deleteMany({ where: { id: { in: testUserIds } } });
    }
    if (testAdminIds.length > 0) {
      await tx.auditLog.deleteMany({ where: { actorAdminId: { in: testAdminIds } } });
      await tx.adminMutationReceipt.deleteMany({ where: { adminId: { in: testAdminIds } } });
      await tx.adminAccount.deleteMany({ where: { id: { in: testAdminIds } } });
    }

    return {
      publisherSources: sourceIds.length,
      publisherCards: cardIds.length,
      arbitrationLeagues: leagueIds.length,
      adminE2eLeagues: adminE2eLeagueIds.length,
      adminE2eUsers: adminE2eUserIds.length,
      orphanRosterAdmins: orphanRosterAdminIds.length,
      testUsers: testUserIds.length,
      testAdmins: testAdminIds.length
    };
  }, { timeout: 30_000 });
}
