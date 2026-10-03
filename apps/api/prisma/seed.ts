import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../src/generated/prisma/client.js';

const url = new URL(process.env.DATABASE_URL ?? '');
const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1)
});
const prisma = new PrismaClient({ adapter });

const roles = [
  ['PLAYER', '玩家'],
  ['TEAM_CAPTAIN', '战队队长'],
  ['LEAGUE_MANAGER', '联赛管理员'],
  ['SEASON_MANAGER', '赛季管理员'],
  ['EVENT_MANAGER', '赛事管理员'],
  ['REFEREE', '裁判'],
  ['PLATFORM_ADMIN', '平台管理员']
] as const;

const catalogPermissions = [
  ['catalog.import.create', 'Create player import batches'],
  ['catalog.import.read', 'Read player import batches'],
  ['catalog.import.publish', 'Publish player import batches']
] as const;

const competitionPermissions = [
  ['competition.create', 'Create competitions'],
  ['competition.manage', 'Manage a competition'],
  ['competition.registration.review', 'Review competition registrations'],
  ['competition.schedule.manage', 'Manage competition schedules'],
  ['competition.result.manage', 'Manage official competition results']
] as const;

const leaguePermissions = [
  ['league.create', 'Create leagues'],
  ['league.manage', 'Manage a league'],
  ['season.manage', 'Manage a league season'],
  ['season.registration.review', 'Review season entries']
] as const;

const localAdminUsername = process.env.LOCAL_ADMIN_USERNAME?.trim();
const localAdminPasswordHash = process.env.LOCAL_ADMIN_PASSWORD_HASH?.trim();
const seedEconomyDemo = process.env.SEED_ECONOMY_DEMO?.trim().toLowerCase() === 'true';
const seedTieredLeagueDemo = process.env.SEED_TIERED_LEAGUE_DEMO?.trim().toLowerCase() === 'true';

if (Boolean(localAdminUsername) !== Boolean(localAdminPasswordHash)) {
  throw new Error('LOCAL_ADMIN_USERNAME and LOCAL_ADMIN_PASSWORD_HASH must be provided together');
}
if (seedTieredLeagueDemo && !localAdminUsername) {
  throw new Error('SEED_TIERED_LEAGUE_DEMO requires LOCAL_ADMIN_USERNAME and LOCAL_ADMIN_PASSWORD_HASH');
}

await prisma.$transaction(async (transaction) => {
  await transaction.publicUserNumberSequence.upsert({
    where: { key: 'public-users' },
    update: {},
    create: { key: 'public-users', nextValue: 100001 }
  });

  if (localAdminUsername && localAdminPasswordHash) {
    await transaction.adminAccount.upsert({
      where: { username: localAdminUsername },
      update: {
        passwordHash: localAdminPasswordHash,
        status: 'ACTIVE',
        platformRole: 'PLATFORM_ADMIN'
      },
      create: {
        username: localAdminUsername,
        displayName: 'Local Platform Administrator',
        passwordHash: localAdminPasswordHash,
        platformRole: 'PLATFORM_ADMIN'
      }
    });
  }

  for (const [code, name] of roles) {
    await transaction.role.upsert({
      where: { code },
      update: { name },
      create: { code, name }
    });
  }

  const platformAdmin = await transaction.role.findUniqueOrThrow({
    where: { code: 'PLATFORM_ADMIN' }
  });
  const eventManager = await transaction.role.findUniqueOrThrow({
    where: { code: 'EVENT_MANAGER' }
  });
  const leagueManager = await transaction.role.findUniqueOrThrow({
    where: { code: 'LEAGUE_MANAGER' }
  });
  const seasonManager = await transaction.role.findUniqueOrThrow({
    where: { code: 'SEASON_MANAGER' }
  });

  for (const [code, name] of catalogPermissions) {
    const permission = await transaction.permission.upsert({
      where: { code },
      update: { name },
      create: { code, name }
    });
    await transaction.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: platformAdmin.id,
          permissionId: permission.id
        }
      },
      update: {},
      create: {
        roleId: platformAdmin.id,
        permissionId: permission.id
      }
    });
  }

  for (const [index, [code, name]] of competitionPermissions.entries()) {
    const permission = await transaction.permission.upsert({
      where: { code },
      update: { name },
      create: { code, name }
    });
    const rolesToGrant = index === 0 ? [platformAdmin] : [platformAdmin, eventManager];

    for (const role of rolesToGrant) {
      await transaction.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id
          }
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id
        }
      });
    }
  }

  for (const [index, [code, name]] of leaguePermissions.entries()) {
    const permission = await transaction.permission.upsert({
      where: { code },
      update: { name },
      create: { code, name }
    });
    const rolesToGrant = index === 0
      ? [platformAdmin]
      : index === 1
        ? [platformAdmin, leagueManager]
        : [platformAdmin, leagueManager, seasonManager];

    for (const role of rolesToGrant) {
      await transaction.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId: permission.id
          }
        },
        update: {},
        create: {
          roleId: role.id,
          permissionId: permission.id
        }
      });
    }
  }

  await transaction.dataSource.upsert({
    where: { code: 'manual' },
    update: { name: 'Manual import', isEnabled: true },
    create: { code: 'manual', name: 'Manual import', type: 'MANUAL' }
  });

  await transaction.dataSource.upsert({
    where: { code: 'pesdata' },
    update: { name: 'PESDATA authorized sync', type: 'API', isEnabled: true },
    create: { code: 'pesdata', name: 'PESDATA authorized sync', type: 'API' }
  });

  if (localAdminUsername && seedEconomyDemo) {
    const demoAdmin = await transaction.adminAccount.findUniqueOrThrow({
      where: { username: localAdminUsername }
    });
    const now = Date.now();
    const ids = {
      league: '10000000-0000-4000-8000-000000000001',
      season: '10000000-0000-4000-8000-000000000002',
      completeTeam: '10000000-0000-4000-8000-000000000003',
      reviewTeam: '10000000-0000-4000-8000-000000000004',
      salaryRule: '10000000-0000-4000-8000-000000000005',
      transferWindow: '10000000-0000-4000-8000-000000000006',
      valuationWindow: '10000000-0000-4000-8000-000000000007',
      valuationRule: '10000000-0000-4000-8000-000000000008',
      completePlayer: '10000000-0000-4000-8000-000000000009',
      reviewPlayer: '10000000-0000-4000-8000-000000000010',
      completeCard: '10000000-0000-4000-8000-000000000011',
      reviewCard: '10000000-0000-4000-8000-000000000012',
      completeOwnership: '10000000-0000-4000-8000-000000000013',
      reviewOwnership: '10000000-0000-4000-8000-000000000014',
      completeEntry: '10000000-0000-4000-8000-000000000015',
      reviewEntry: '10000000-0000-4000-8000-000000000016',
      completeSnapshot: '10000000-0000-4000-8000-000000000017',
      reviewSnapshot: '10000000-0000-4000-8000-000000000018',
      reviewSubmission: '10000000-0000-4000-8000-000000000019',
      reviewItem: '10000000-0000-4000-8000-000000000020',
      feeRule: '10000000-0000-4000-8000-000000000021',
      financeCredit: '10000000-0000-4000-8000-000000000022',
      financeDebit: '10000000-0000-4000-8000-000000000023'
    } as const;
    const existingDemo = await transaction.league.findUnique({ where: { id: ids.league } });
    if (existingDemo) return;
    const completeOwner = await transaction.user.upsert({
      where: { wechatOpenId: 'test-openid-economy-demo-complete' },
      update: { displayName: '完整资产球队老板', publicUserNo: '990001' },
      create: {
        wechatOpenId: 'test-openid-economy-demo-complete',
        displayName: '完整资产球队老板',
        publicUserNo: '990001'
      }
    });
    const reviewOwner = await transaction.user.upsert({
      where: { wechatOpenId: 'test-openid-economy-demo-review' },
      update: { displayName: '待审核球队老板', publicUserNo: '990002' },
      create: {
        wechatOpenId: 'test-openid-economy-demo-review',
        displayName: '待审核球队老板',
        publicUserNo: '990002'
      }
    });
    await transaction.league.upsert({
      where: { id: ids.league },
      update: {
        name: '本地经营演示联赛', shortName: '经营演示', currentSeasonId: null,
        createdByAdminId: demoAdmin.id
      },
      create: {
        id: ids.league,
        name: '本地经营演示联赛',
        shortName: '经营演示',
        description: '身价、资产、交易手续费与财务闭环的本地演示数据',
        defaultPlatform: 'MOBILE',
        defaultServerRegion: 'CN',
        createdByAdminId: demoAdmin.id
      }
    });
    await transaction.leagueSeason.upsert({
      where: { id: ids.season },
      update: {
        displayName: 'S1 经营演示',
        registrationOpensAt: new Date(now - 14 * 86_400_000),
        registrationClosesAt: new Date(now - 10 * 86_400_000),
        startsAt: new Date(now - 7 * 86_400_000),
        endsAt: new Date(now + 30 * 86_400_000),
        status: 'IN_PROGRESS'
      },
      create: {
        id: ids.season,
        leagueId: ids.league,
        seasonNumber: 1,
        displayName: 'S1 经营演示',
        isFirstSeason: true,
        registrationOpensAt: new Date(now - 14 * 86_400_000),
        registrationClosesAt: new Date(now - 10 * 86_400_000),
        startsAt: new Date(now - 7 * 86_400_000),
        endsAt: new Date(now + 30 * 86_400_000),
        superCapacity: 23,
        championCapacity: 18,
        promotionCount: 4,
        status: 'IN_PROGRESS',
        createdByAdminId: demoAdmin.id
      }
    });
    await transaction.league.update({
      where: { id: ids.league },
      data: { currentSeasonId: ids.season }
    });
    const demoTeams = [
      { id: ids.completeTeam, ownerUserId: completeOwner.id, teamNumber: 1, name: '完整资产演示队', shortName: '完整队' },
      { id: ids.reviewTeam, ownerUserId: reviewOwner.id, teamNumber: 2, name: '超限待审演示队', shortName: '待审队' }
    ] as const;
    for (const team of demoTeams) {
      await transaction.leagueTeam.upsert({
        where: { id: team.id },
        update: { ...team, leagueId: ids.league, shellValueMinor: 50_000 },
        create: { ...team, leagueId: ids.league, shellValueMinor: 50_000 }
      });
    }
    const entries = [
      { id: ids.completeEntry, team: demoTeams[0], owner: completeOwner },
      { id: ids.reviewEntry, team: demoTeams[1], owner: reviewOwner }
    ] as const;
    for (const entry of entries) {
      await transaction.seasonEntry.upsert({
        where: { id: entry.id },
        update: { status: 'APPROVED' },
        create: {
          id: entry.id,
          seasonId: ids.season,
          leagueTeamId: entry.team.id,
          ownerUserId: entry.owner.id,
          source: 'NEW_APPLICATION',
          status: 'APPROVED',
          teamNameSnapshot: entry.team.name,
          teamShortNameSnapshot: entry.team.shortName,
          teamNumberSnapshot: entry.team.teamNumber,
          leagueEditionSnapshot: 'INTERNATIONAL'
        }
      });
    }
    await transaction.leagueSalaryRuleVersion.upsert({
      where: { id: ids.salaryRule },
      update: { salaryCapMinor: 20_000, effectiveAt: new Date(now - 30 * 86_400_000) },
      create: {
        id: ids.salaryRule,
        leagueId: ids.league,
        version: 1,
        salaryCapMinor: 20_000,
        effectiveAt: new Date(now - 30 * 86_400_000),
        createdByAdminId: demoAdmin.id
      }
    });
    const salaryTiers = [
      { minDtRating: 0, maxDtRating: 92, salaryMinor: 100 },
      { minDtRating: 93, maxDtRating: 96, salaryMinor: 300 },
      { minDtRating: 97, maxDtRating: 120, salaryMinor: 600 }
    ];
    for (const tier of salaryTiers) {
      await transaction.leagueSalaryTier.upsert({
        where: {
          salaryRuleVersionId_minDtRating: {
            salaryRuleVersionId: ids.salaryRule,
            minDtRating: tier.minDtRating
          }
        },
        update: tier,
        create: { salaryRuleVersionId: ids.salaryRule, ...tier }
      });
    }
    await transaction.transferWindow.upsert({
      where: { id: ids.transferWindow },
      update: {
        startsAt: new Date(now - 86_400_000), endsAt: new Date(now + 14 * 86_400_000)
      },
      create: {
        id: ids.transferWindow,
        seasonId: ids.season,
        name: '本地演示转会窗',
        startsAt: new Date(now - 86_400_000),
        endsAt: new Date(now + 14 * 86_400_000),
        allowBuy: true,
        allowSell: true,
        allowTransfer: true,
        allowCardUpgrade: true,
        createdByAdminId: demoAdmin.id
      }
    });
    const demoSource = await transaction.dataSource.upsert({
      where: { code: 'economy-demo' },
      update: { name: '经营闭环演示数据' },
      create: { code: 'economy-demo', name: '经营闭环演示数据' }
    });
    const demoPlayers = [
      { id: ids.completePlayer, cardId: ids.completeCard, externalId: 'economy-demo-complete', name: '完整身价球员', position: 'CF' as const, rating: 95 },
      { id: ids.reviewPlayer, cardId: ids.reviewCard, externalId: 'economy-demo-review', name: '超限申报球员', position: 'CMF' as const, rating: 94 }
    ] as const;
    for (const player of demoPlayers) {
      await transaction.footballPlayer.upsert({
        where: { id: player.id },
        update: { nameZh: player.name },
        create: { id: player.id, nameZh: player.name, nationality: '中国', club: '经营演示俱乐部' }
      });
      await transaction.playerCard.upsert({
        where: { id: player.cardId },
        update: { cardName: `${player.name}精选卡`, overallRating: player.rating },
        create: {
          id: player.cardId,
          sourceId: demoSource.id,
          externalId: player.externalId,
          playerId: player.id,
          cardName: `${player.name}精选卡`,
          position: player.position,
          overallRating: player.rating,
          cardType: 'FEATURED'
        }
      });
    }
    const ownerships = [
      { id: ids.completeOwnership, teamId: ids.completeTeam, player: demoPlayers[0], salaryMinor: 300 },
      { id: ids.reviewOwnership, teamId: ids.reviewTeam, player: demoPlayers[1], salaryMinor: 300 }
    ] as const;
    for (const ownership of ownerships) {
      await transaction.leaguePlayerOwnership.upsert({
        where: { id: ownership.id },
        update: {},
        create: {
          id: ownership.id,
          leagueId: ids.league,
          leagueTeamId: ownership.teamId,
          footballPlayerId: ownership.player.id,
          currentPlayerCardId: ownership.player.cardId,
          dtRatingSnapshot: ownership.player.rating,
          salaryRuleVersionId: ids.salaryRule,
          salaryMinor: ownership.salaryMinor
        }
      });
      await transaction.leaguePlayerValuation.upsert({
        where: {
          leagueId_footballPlayerId: {
            leagueId: ids.league,
            footballPlayerId: ownership.player.id
          }
        },
        update: {},
        create: {
          leagueId: ids.league,
          footballPlayerId: ownership.player.id,
          currentValueMinor: 20_000,
          effectiveAt: new Date(now - 86_400_000)
        }
      });
    }
    await transaction.valuationWindow.upsert({
      where: { id: ids.valuationWindow },
      update: {
        name: '本地演示身价窗口',
        startsAt: new Date(now - 3_600_000),
        endsAt: new Date(now + 7 * 86_400_000),
        closedAt: null,
        snapshotInitializedAt: new Date()
      },
      create: {
        id: ids.valuationWindow,
        seasonId: ids.season,
        name: '本地演示身价窗口',
        startsAt: new Date(now - 3_600_000),
        endsAt: new Date(now + 7 * 86_400_000),
        snapshotInitializedAt: new Date(),
        createdByAdminId: demoAdmin.id
      }
    });
    await transaction.valuationWindowRuleVersion.upsert({
      where: { id: ids.valuationRule },
      update: {
        minimumValueMinor: 1_000,
        maximumValueMinor: 100_000,
        maximumIncreaseBps: 1_000,
        maximumDecreaseBps: 1_000
      },
      create: {
        id: ids.valuationRule,
        windowId: ids.valuationWindow,
        version: 1,
        minimumValueMinor: 1_000,
        maximumValueMinor: 100_000,
        maximumIncreaseBps: 1_000,
        maximumDecreaseBps: 1_000,
        createdByAdminId: demoAdmin.id
      }
    });
    await transaction.valuationWindow.update({
      where: { id: ids.valuationWindow }, data: { currentRuleVersionId: ids.valuationRule }
    });
    const snapshots = [
      { id: ids.completeSnapshot, teamId: ids.completeTeam, ownershipId: ids.completeOwnership, playerId: ids.completePlayer },
      { id: ids.reviewSnapshot, teamId: ids.reviewTeam, ownershipId: ids.reviewOwnership, playerId: ids.reviewPlayer }
    ] as const;
    for (const snapshot of snapshots) {
      await transaction.valuationRosterSnapshot.upsert({
        where: { id: snapshot.id },
        update: { baseValueMinor: 20_000 },
        create: {
          id: snapshot.id,
          windowId: ids.valuationWindow,
          leagueTeamId: snapshot.teamId,
          ownershipId: snapshot.ownershipId,
          footballPlayerId: snapshot.playerId,
          baseValueMinor: 20_000
        }
      });
    }
    await transaction.valuationSubmission.upsert({
      where: { id: ids.reviewSubmission },
      update: {},
      create: {
        id: ids.reviewSubmission,
        windowId: ids.valuationWindow,
        leagueTeamId: ids.reviewTeam,
        ruleVersionId: ids.valuationRule,
        attemptNumber: 1,
        status: 'DRAFT',
        submittedByUserId: reviewOwner.id
      }
    });
    await transaction.valuationSubmissionItem.upsert({
      where: { id: ids.reviewItem },
      update: {},
      create: {
        id: ids.reviewItem,
        submissionId: ids.reviewSubmission,
        snapshotId: ids.reviewSnapshot,
        baseValueMinor: 20_000,
        proposedValueMinor: 30_000,
        minimumAllowedMinor: 18_000,
        maximumAllowedMinor: 22_000,
        exceedsRange: true
      }
    });
    await transaction.leagueTransactionFeeRuleVersion.upsert({
      where: { id: ids.feeRule },
      update: { rateBps: 500, minimumFeeMinor: 500, effectiveAt: new Date(now - 86_400_000) },
      create: {
        id: ids.feeRule,
        leagueId: ids.league,
        version: 1,
        rateBps: 500,
        minimumFeeMinor: 500,
        effectiveAt: new Date(now - 86_400_000),
        createdByAdminId: demoAdmin.id
      }
    });
    const financeEntries = [
      { id: ids.financeCredit, direction: 'CREDIT' as const, type: 'MANUAL_ADJUSTMENT' as const, amountMinor: 8_000, note: '本地演示运营补贴' },
      { id: ids.financeDebit, direction: 'DEBIT' as const, type: 'LUXURY_TAX' as const, amountMinor: 1_200, note: '本地演示奢侈税' }
    ];
    for (const entry of financeEntries) {
      await transaction.financeLedgerEntry.upsert({
        where: { id: entry.id },
        update: {},
        create: {
          ...entry,
          leagueId: ids.league,
          leagueTeamId: ids.completeTeam,
          seasonId: ids.season
        }
      });
    }
  }

  if (localAdminUsername && seedTieredLeagueDemo) {
    const demoAdmin = await transaction.adminAccount.findUniqueOrThrow({ where: { username: localAdminUsername } });
    const leagueId = '20000000-0000-4000-8000-000000000001';
    const seasonId = '20000000-0000-4000-8000-000000000002';
    const now = Date.now();
    await transaction.league.upsert({
      where: { id: leagueId },
      update: { name: '本地分级联赛演示', shortName: '分级演示', createdByAdminId: demoAdmin.id },
      create: {
        id: leagueId, name: '本地分级联赛演示', shortName: '分级演示',
        description: '19 支球队的首赛季双冠军组分配与赛程验收数据',
        defaultPlatform: 'MOBILE', defaultServerRegion: 'CN', createdByAdminId: demoAdmin.id
      }
    });
    await transaction.leagueSeason.upsert({
      where: { id: seasonId },
      update: { displayName: 'S1 分级演示', createdByAdminId: demoAdmin.id },
      create: {
        id: seasonId, leagueId, seasonNumber: 1, displayName: 'S1 分级演示', isFirstSeason: true,
        registrationOpensAt: new Date(now - 14 * 86_400_000),
        registrationClosesAt: new Date(now - 7 * 86_400_000),
        startsAt: new Date(now + 86_400_000), endsAt: new Date(now + 90 * 86_400_000),
        superCapacity: 23, championCapacity: 18, promotionCount: 4,
        status: 'ALLOCATION_REVIEW', createdByAdminId: demoAdmin.id
      }
    });
    await transaction.league.update({ where: { id: leagueId }, data: { currentSeasonId: seasonId } });
    for (let index = 1; index <= 19; index += 1) {
      const suffix = String(index).padStart(12, '0');
      const user = await transaction.user.upsert({
        where: { wechatOpenId: `test-openid-tiered-demo-${index}` },
        update: { displayName: `分级演示老板 ${index}` },
        create: { wechatOpenId: `test-openid-tiered-demo-${index}`, displayName: `分级演示老板 ${index}` }
      });
      const teamId = `20000000-0000-4000-8001-${suffix}`;
      const entryId = `20000000-0000-4000-8002-${suffix}`;
      await transaction.leagueTeam.upsert({
        where: { id: teamId },
        update: { ownerUserId: user.id, teamNumber: index, name: `分级演示球队 ${index}`, shortName: `演示${index}` },
        create: {
          id: teamId, leagueId, ownerUserId: user.id, teamNumber: index,
          name: `分级演示球队 ${index}`, shortName: `演示${index}`
        }
      });
      await transaction.seasonEntry.upsert({
        where: { id: entryId },
        update: {},
        create: {
          id: entryId, seasonId, leagueTeamId: teamId, ownerUserId: user.id,
          source: 'NEW_APPLICATION', status: 'APPROVED', teamNameSnapshot: `分级演示球队 ${index}`,
          teamShortNameSnapshot: `演示${index}`, teamNumberSnapshot: index,
          leagueEditionSnapshot: 'INTERNATIONAL'
        }
      });
    }
  }
});

await prisma.$disconnect();
