import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  AdminAccountSummarySchema,
  AcquirePlayerRequestSchema,
  AdminAuthResponseSchema,
  AdminLeagueGrantSchema,
  AdminLoginRequestSchema,
  BatchMutationRequestSchema,
  CompetitionDetailSchema,
  CompetitionFormatSchema,
  CompetitionListQuerySchema,
  CompetitionParticipantTypeSchema,
  CompetitionStageCodeSchema,
  CompetitionStageSummarySchema,
  CompetitionTypeSchema,
  ConfirmSeasonAllocationRequestSchema,
  DivisionStandingsResponseSchema,
  LeagueWorkspaceResponseSchema,
  PlatformPresentationSchema,
  PlatformPageRequestSchema,
  GenerateSeasonAllocationRequestSchema,
  GenerateStageScheduleRequestSchema,
  SeasonAllocationDecisionSchema,
  SeasonAllocationProposalSchema,
  SeasonAllocationProposalRowSchema,
  PublishStageScheduleRequestSchema,
  CreateCompetitionRequestSchema,
  CreateSeasonCupRequestSchema,
  RegisterSeasonCupRequestSchema,
  WithdrawSeasonCupRequestSchema,
  CupRegistrationResponseSchema,
  MyCompetitionResponseSchema,
  GenerateCupGroupProposalRequestSchema,
  ConfirmCupGroupProposalRequestSchema,
  CupGroupProposalSchema,
  GenerateCupBracketProposalRequestSchema,
  ConfirmCupBracketProposalRequestSchema,
  CupBracketProposalSchema,
  CupBracketViewSchema,
  SeasonCupSummarySchema,
  CreatePlayerFavoriteRequestSchema,
  CreateLeagueRequestSchema,
  CreateLeagueSeasonRequestSchema,
  CreateLeagueTeamRequestSchema,
  CreateCustomTeamCatalogItemRequestSchema,
  CreateSalaryRuleVersionRequestSchema,
  CreateTeamProfileRequestSchema,
  EmergencyCorrectRosterRequestSchema,
  GameAccountInputSchema,
  IdempotencyKeySchema,
  MatchResultVersionResponseSchema,
  MoneyMinorSchema,
  NormalizedPlayerCardRecordSchema,
  OverrideSeasonEntryRequestSchema,
  PlayerSearchQuerySchema,
  PlayerCardDetailSchema,
  PlayerFavoriteListQuerySchema,
  PlayerFavoriteStatusQuerySchema,
  PublicUserLookupSchema,
  PublicUserNumberSchema,
  RecalculateLeagueSalaryRequestSchema,
  ResourceIdSchema,
  RosterEntrySchema,
  RosterEntryStatusSchema,
  RosterMutationResponseSchema,
  RosterPlayerCandidateQuerySchema,
  RosterTransactionSchema,
  SalaryRecalculationResponseSchema,
  SalaryRuleVersionSchema,
  StandingsSnapshotResponseSchema,
  SubmitMatchResultRequestSchema,
  TeamNumberSchema,
  TeamCatalogListResponseSchema,
  TeamCatalogSyncDifferenceSchema,
  TeamCatalogSyncRunSummarySchema,
  TeamSyncItemPageSchema,
  TransferWindowSchema,
  FinanceLedgerEntrySchema,
  FinanceLedgerTypeSchema,
  LeagueTeamDetailSchema,
  LeagueTeamSummarySchema,
  LeagueEditionSchema,
  CurrentSeasonSummarySchema,
  CurrentUserSchema,
  EnrollLeagueTeamsRequestSchema,
  SeasonEntrySchema,
  SetCurrentSeasonRequestSchema,
  SeasonEntryListQuerySchema,
  UpdateLeagueRequestSchema,
  UpdatePlatformPresentationRequestSchema,
  UpdateLeagueTeamRequestSchema,
  ChangeTeamShellRequestSchema,
  RefreshTeamShellRequestSchema,
  SwapTeamShellRequestSchema,
  TransferTeamShellRequestSchema,
  UpdateLeagueSeasonRequestSchema,
  UpdateRosterLifecycleRequestSchema,
  UpdateTeamProfileRequestSchema,
  WechatLoginRequestSchema,
  StartPlatformSyncRequestSchema,
  derivePesdataPositionAutoBuild
} from './index.js';
import {
  AuditLogSchema,
  CreateManualFinanceEntryRequestSchema,
  LeagueTransactionListResponseSchema,
  PublishValuationSubmissionRequestSchema,
  ReviewValuationSubmissionRequestSchema,
  SaveValuationDraftRequestSchema,
  TeamAssetOverviewSchema,
  TeamFinanceSummarySchema,
  ValuationWindowSchema,
  ValuationWorkspaceSchema
} from './index.js';

describe('platform data sync contracts', () => {
  it('derives the salary ability from the PESDATA automatic build total', () => {
    assert.deepEqual(derivePesdataPositionAutoBuild({
      position: 'DMF',
      overallRating: 80,
      maxLevel: 80,
      cardType: 'HIGHLIGHT'
    }), {
      allocation: {
        dribbling: 4,
        dexterity: 4,
        shooting: 0,
        lowerBodyStrength: 8,
        passing: 8,
        aerialStrength: 6,
        defending: 16,
        goalkeeping1: 0,
        goalkeeping2: 0,
        goalkeeping3: 0
      },
      maxOverall: 95,
      dtRating: 95,
      algorithmVersion: 'pesdata-position-auto-v1'
    });
  });

  it('accepts supported sync modes and bounded pagination', () => {
    assert.equal(StartPlatformSyncRequestSchema.parse({ mode: 'sample', limit: 2 }).mode, 'sample');
    assert.throws(() => PlatformPageRequestSchema.parse({ page: 1, pageSize: 100 }));
  });

  it('rejects batch mutations larger than one hundred unique resources', () => {
    assert.throws(() => BatchMutationRequestSchema.parse({
      ids: Array.from({ length: 101 }, () => randomUUID())
    }));
  });

  it('parses paginated team sync results without loading all records', () => {
    const itemId = randomUUID();
    const runId = randomUUID();
    const catalogItemId = randomUUID();
    const result = TeamSyncItemPageSchema.parse({
      items: [{
        id: itemId,
        runId,
        sourceExternalId: 'team-101',
        changeType: 'UPDATED',
        reviewStatus: 'PENDING',
        currentCatalogItemId: catalogItemId,
        current: {
          nameZh: '阿贾克斯', nameEn: 'Ajax', shortName: 'AJA',
          remoteLogoUrl: 'https://img.pesdata.net/ajax-v1.png',
          storedLogoUrl: 'https://media.example/ajax-v1.webp',
          logoChecksum: 'a'.repeat(64), sourceChecksum: 'b'.repeat(64)
        },
        candidate: {
          sourceExternalId: 'team-101', sourceLeagueExternalId: 'league-7', sourceLeagueName: '荷甲',
          nameZh: '阿贾克斯', nameEn: 'Ajax', nameJa: null, shortName: 'AJA',
          remoteLogoUrl: 'https://img.pesdata.net/ajax-v2.png',
          storedLogoUrl: 'https://media.example/ajax-v2.webp', sourceUpdatedAt: null
        },
        candidateLogoChecksum: 'c'.repeat(64), candidateSourceChecksum: 'd'.repeat(64),
        errorCode: null, errorMessage: null
      }],
      page: 1,
      pageSize: 20,
      total: 981,
      summary: { pending: 0, failed: 70, published: 911, rejected: 0, errors: [{ code: 'CREST_INVALID', count: 70 }] }
    });
    assert.equal(result.total, 981);
    assert.equal(result.items[0]?.current?.storedLogoUrl, 'https://media.example/ajax-v1.webp');
    assert.equal(result.items[0]?.candidateLogoChecksum, 'c'.repeat(64));
    assert.deepEqual(result.summary.errors, [{ code: 'CREST_INVALID', count: 70 }]);
  });
});

describe('league economy contracts', () => {
  const ids = {
    admin: '11111111-1111-4111-8111-111111111111',
    league: '22222222-2222-4222-8222-222222222222',
    season: '33333333-3333-4333-8333-333333333333',
    team: '44444444-4444-4444-8444-444444444444',
    player: '55555555-5555-4555-8555-555555555555',
    window: '66666666-6666-4666-8666-666666666666',
    rule: '77777777-7777-4777-8777-777777777777',
    snapshot: '88888888-8888-4888-8888-888888888888',
    submission: '99999999-9999-4999-8999-999999999999'
  };
  const startsAt = '2026-10-01T00:00:00.000Z';
  const endsAt = '2026-10-07T00:00:00.000Z';

  it('accepts integer basis-point limits and rejects invalid valuation window rules', () => {
    const window = ValuationWindowSchema.parse({
      id: ids.window,
      seasonId: ids.season,
      name: '季前身价申报',
      startsAt,
      endsAt,
      closedAt: null,
      state: 'OPEN',
      currentRule: {
        id: ids.rule,
        windowId: ids.window,
        version: 2,
        minimumValueMinor: 100,
        maximumValueMinor: 10_000,
        maximumIncreaseBps: 2500,
        maximumDecreaseBps: 1500,
        createdByAdminId: ids.admin,
        createdAt: startsAt
      },
      createdByAdminId: ids.admin,
      version: 3,
      createdAt: startsAt,
      updatedAt: startsAt
    });
    assert.equal(window.currentRule.maximumIncreaseBps, 2500);
    assert.throws(() => ValuationWindowSchema.parse({
      ...window,
      currentRule: { ...window.currentRule, maximumIncreaseBps: 10_001 }
    }));
    assert.throws(() => ValuationWindowSchema.parse({
      ...window,
      currentRule: { ...window.currentRule, minimumValueMinor: 10_001 }
    }));
    assert.throws(() => ValuationWindowSchema.parse({
      ...window,
      currentRule: { ...window.currentRule, minimumValueMinor: 100.5 }
    }));
  });

  it('parses a complete owner workspace and write requests while rejecting unknown states', () => {
    const workspace = ValuationWorkspaceSchema.parse({
      window: {
        id: ids.window,
        name: '季前身价申报',
        state: 'OPEN',
        startsAt,
        endsAt,
        rule: {
          id: ids.rule,
          version: 1,
          minimumValueMinor: 100,
          maximumValueMinor: 10_000,
          maximumIncreaseBps: 2000,
          maximumDecreaseBps: 2000
        }
      },
      team: { id: ids.team, name: '海港竞技' },
      submission: null,
      players: [{
        snapshotId: ids.snapshot,
        playerId: ids.player,
        playerName: '测试球员',
        cardName: '基础卡',
        cardImageUrl: null,
        rosterStatus: 'ACTIVE',
        baseValueMinor: null,
        currentValueMinor: null,
        minimumAllowedMinor: 100,
        maximumAllowedMinor: 10_000,
        draftValueMinor: null,
        exceedsRange: false
      }]
    });
    assert.equal(workspace.players.length, 1);
    assert.throws(() => ValuationWorkspaceSchema.parse({
      ...workspace,
      window: { ...workspace.window, state: 'PAUSED' }
    }));

    const draft = SaveValuationDraftRequestSchema.parse({
      windowId: ids.window,
      expectedVersion: 1,
      items: [{ snapshotId: ids.snapshot, proposedValueMinor: 1200 }]
    });
    assert.equal(draft.items[0]?.proposedValueMinor, 1200);
    assert.throws(() => SaveValuationDraftRequestSchema.parse({
      ...draft,
      items: [{ snapshotId: ids.snapshot, proposedValueMinor: 1.2 }]
    }));
    assert.equal(PublishValuationSubmissionRequestSchema.parse({
      windowId: ids.window,
      expectedVersion: 1,
      idempotencyKey: 'publish-team-1'
    }).expectedVersion, 1);
    assert.equal(ReviewValuationSubmissionRequestSchema.parse({
      expectedVersion: 1,
      idempotencyKey: 'review-team-1',
      reason: '核对完成，整批通过'
    }).reason, '核对完成，整批通过');
    assert.throws(() => ReviewValuationSubmissionRequestSchema.parse({
      expectedVersion: 1,
      idempotencyKey: 'review-team-1',
      reason: ' '
    }));
  });

  it('marks incomplete assets and supports transaction and legacy finance views', () => {
    const assets = TeamAssetOverviewSchema.parse({
      leagueId: ids.league,
      teamId: ids.team,
      teamName: '海港竞技',
      teamNumber: 7,
      divisionName: '冠军 A 组',
      teamLogoUrl: null,
      ownerDisplayName: '小宣',
      ownerPublicUserNo: '100069',
      ownerAvatarUrl: null,
      shellValueMinor: 5000,
      knownPlayerValueMinor: 8000,
      totalKnownValueMinor: 13_000,
      valuationCompleteness: 'INCOMPLETE',
      missingValuationCount: 1,
      activePlayerCount: 3,
      activeSalaryMinor: 1200,
      players: []
    });
    assert.equal(assets.valuationCompleteness, 'INCOMPLETE');
    assert.equal(assets.divisionName, '冠军 A 组');
    assert.throws(() => TeamAssetOverviewSchema.parse({ ...assets, valuationCompleteness: 'PARTIAL' }));

    const transactions = LeagueTransactionListResponseSchema.parse({ items: [], nextCursor: null });
    assert.equal(transactions.items.length, 0);

    const finance = TeamFinanceSummarySchema.parse({
      leagueId: ids.league,
      teamId: ids.team,
      seasonId: null,
      creditTotalMinor: 500,
      debitTotalMinor: 200,
      balanceMinor: 300,
      uncategorizedEntryCount: 2,
      entries: []
    });
    assert.equal(finance.seasonId, null);
    assert.equal(CreateManualFinanceEntryRequestSchema.parse({
      leagueTeamId: ids.team,
      seasonId: null,
      direction: 'DEBIT',
      type: 'MANUAL_ADJUSTMENT',
      amountMinor: 100,
      note: '赛季外调整',
      reason: '管理员纠正历史余额',
      idempotencyKey: 'finance-adjustment-1'
    }).seasonId, null);
  });

  it('requires Chinese-ready audit display context', () => {
    const audit = AuditLogSchema.parse({
      id: ids.submission,
      actorAdminId: ids.admin,
      actorDisplayName: '小宣',
      leagueId: ids.league,
      leagueName: 'CELL 传奇联赛',
      action: 'VALUATION_SUBMISSION_APPROVE',
      resourceType: 'ValuationSubmission',
      resourceId: ids.submission,
      subjectDisplayName: '海港竞技季前身价申报',
      reason: '核对完成',
      metadata: {},
      createdAt: startsAt
    });
    assert.equal(audit.actorDisplayName, '小宣');
    assert.equal(audit.leagueName, 'CELL 传奇联赛');
    assert.equal(audit.subjectDisplayName, '海港竞技季前身价申报');
  });

  it('accepts an opaque identifier for a singleton audit resource', () => {
    const audit = AuditLogSchema.parse({
      id: ids.submission,
      actorAdminId: ids.admin,
      actorDisplayName: '平台管理员',
      leagueId: null,
      leagueName: null,
      action: 'admin.platform-presentation.update',
      resourceType: 'PlatformPresentation',
      resourceId: 'global',
      subjectDisplayName: null,
      reason: null,
      metadata: { leagueCenterBannerUrl: null },
      createdAt: startsAt
    });
    assert.equal(audit.resourceId, 'global');
  });
});

describe('shared API contracts', () => {
  it('validates the public league banner presentation and versioned administrator update', () => {
    assert.deepEqual(PlatformPresentationSchema.parse({
      leagueCenterBannerUrl: null,
      version: 0,
    }), {
      leagueCenterBannerUrl: null,
      version: 0,
    });
    assert.deepEqual(UpdatePlatformPresentationRequestSchema.parse({
      leagueCenterBannerUrl: 'https://media.example.com/league-center.webp',
      expectedVersion: 3,
    }), {
      leagueCenterBannerUrl: 'https://media.example.com/league-center.webp',
      expectedVersion: 3,
    });
    assert.equal(UpdatePlatformPresentationRequestSchema.parse({
      leagueCenterBannerUrl: 'cloud://production/league-center-banners--opaque.webp',
      expectedVersion: 3,
    }).leagueCenterBannerUrl, 'cloud://production/league-center-banners--opaque.webp');
    assert.equal(UpdatePlatformPresentationRequestSchema.parse({
      leagueCenterBannerUrl: 'http://127.0.0.1:3000/v1/media/league-center-banners--local.webp',
      expectedVersion: 3,
    }).leagueCenterBannerUrl, 'http://127.0.0.1:3000/v1/media/league-center-banners--local.webp');
    assert.throws(() => UpdatePlatformPresentationRequestSchema.parse({
      leagueCenterBannerUrl: 'http://media.example.com/league-center.webp',
      expectedVersion: 3,
    }));
    assert.throws(() => UpdatePlatformPresentationRequestSchema.parse({
      leagueCenterBannerUrl: null,
      expectedVersion: -1,
    }));
  });

  it('exposes the current user public number for administrator binding', () => {
    const user = CurrentUserSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      publicUserNo: '000123',
      displayName: '',
      avatarUrl: null,
      region: null,
      status: 'ACTIVE',
      profileComplete: false
    });
    assert.equal(user.publicUserNo, '000123');
  });

  it('rejects an empty WeChat login code', () => {
    assert.throws(() => WechatLoginRequestSchema.parse({ code: ' ' }));
  });

  it('rejects an unsupported game platform', () => {
    assert.throws(() => GameAccountInputSchema.parse({
      platform: 'SWITCH',
      serverRegion: 'international',
      gamerTag: 'Player 1'
    }));
  });

  it('rejects gamer tags longer than 64 characters', () => {
    assert.throws(() => GameAccountInputSchema.parse({
      platform: 'MOBILE',
      serverRegion: 'international',
      gamerTag: 'a'.repeat(65)
    }));
  });

  it('rejects invalid resource identifiers', () => {
    assert.throws(() => ResourceIdSchema.parse('not-a-uuid'));
  });

  it('trims accepted player-facing values', () => {
    const parsed = GameAccountInputSchema.parse({
      platform: 'MOBILE',
      serverRegion: ' international ',
      gamerTag: '  Player 1  '
    });

    assert.equal(parsed.serverRegion, 'international');
    assert.equal(parsed.gamerTag, 'Player 1');
    assert.equal(parsed.isDefault, false);
  });

  it('accepts trimmed league, team profile, and valid season inputs', () => {
    const gameAccountId = '11111111-1111-4111-8111-111111111111';
    const league = CreateLeagueRequestSchema.parse({
      name: '  CELL 传奇联赛  ',
      shortName: '  CELL  ',
      description: '  长期联赛  ',
      logoUrl: null,
      edition: 'INTERNATIONAL'
    });
    const team = CreateTeamProfileRequestSchema.parse({
      name: '  上海申花  ',
      shortName: '  申花  ',
      logoUrl: null,
      defaultGameAccountId: gameAccountId
    });
    const season = CreateLeagueSeasonRequestSchema.parse({
      seasonNumber: 1,
      displayName: '  S20 赛季  ',
      registrationOpensAt: '2026-10-01T00:00:00.000Z',
      registrationClosesAt: '2026-10-08T00:00:00.000Z',
      startsAt: '2026-10-09T00:00:00.000Z',
      endsAt: '2026-11-09T00:00:00.000Z'
    });

    assert.equal(league.name, 'CELL 传奇联赛');
    assert.equal(league.defaultSuperCapacity, 23);
    assert.equal(league.defaultChampionCapacity, 18);
    assert.equal(league.defaultPromotionCount, 4);
    assert.equal(team.name, '上海申花');
    assert.equal(team.logoUrl, null);
    assert.equal(season.displayName, 'S20 赛季');
  });

  it('validates season entry review filters and requires an override reason', () => {
    assert.deepEqual(SeasonEntryListQuerySchema.parse({ status: 'PENDING' }), {
      status: 'PENDING'
    });
    assert.throws(() => OverrideSeasonEntryRequestSchema.parse({
      targetStatus: 'APPROVED',
      expectedVersion: 1,
      reason: '   '
    }));
    assert.equal(OverrideSeasonEntryRequestSchema.parse({
      targetStatus: 'APPROVED',
      expectedVersion: 1,
      reason: '  管理员核验通过  '
    }).reason, '管理员核验通过');
  });

  it('rejects an invalid league season timeline', () => {
    assert.throws(() => CreateLeagueSeasonRequestSchema.parse({
      seasonNumber: 1,
      displayName: 'S20 赛季',
      registrationOpensAt: '2026-10-08T00:00:00.000Z',
      registrationClosesAt: '2026-10-01T00:00:00.000Z',
      startsAt: '2026-10-09T00:00:00.000Z',
      endsAt: '2026-11-09T00:00:00.000Z'
    }));
    assert.throws(() => CreateLeagueSeasonRequestSchema.parse({
      seasonNumber: 1,
      displayName: 'S20 赛季',
      registrationOpensAt: '2026-10-01T00:00:00.000Z',
      registrationClosesAt: '2026-10-08T00:00:00.000Z',
      startsAt: '2026-10-08T00:00:00.000Z',
      endsAt: '2026-11-09T00:00:00.000Z'
    }));
  });

  it('enforces league capacity and promotion bounds', () => {
    const valid = {
      name: 'CELL 传奇联赛',
      shortName: 'CELL',
      description: '',
      logoUrl: null,
      edition: 'INTERNATIONAL' as const
    };

    assert.throws(() => CreateLeagueRequestSchema.parse({ ...valid, defaultSuperCapacity: 1 }));
    assert.throws(() => CreateLeagueRequestSchema.parse({ ...valid, defaultChampionCapacity: 65 }));
    assert.throws(() => CreateLeagueRequestSchema.parse({ ...valid, defaultPromotionCount: 33 }));
  });

  it('accepts nullable logos for league and team profile', () => {
    const gameAccountId = '11111111-1111-4111-8111-111111111111';
    assert.equal(CreateLeagueRequestSchema.parse({
      name: 'CELL 传奇联赛',
      shortName: 'CELL',
      logoUrl: null,
      edition: 'INTERNATIONAL'
    }).logoUrl, null);
    assert.equal(CreateTeamProfileRequestSchema.parse({
      name: '上海申花',
      shortName: '申花',
      logoUrl: null,
      defaultGameAccountId: gameAccountId
    }).logoUrl, null);
  });

  it('requires a supported league edition and strips retired league identity fields', () => {
    assert.equal(LeagueEditionSchema.parse('NATIONAL'), 'NATIONAL');
    assert.throws(() => LeagueEditionSchema.parse('GLOBAL'));
    assert.throws(() => CreateLeagueRequestSchema.parse({
      name: 'CELL 传奇联赛',
      shortName: 'CELL'
    }));

    const parsed = CreateLeagueRequestSchema.parse({
      name: 'CELL 传奇联赛',
      shortName: 'CELL',
      edition: 'INTERNATIONAL',
      defaultPlatform: 'MOBILE',
      defaultServerRegion: 'GLOBAL'
    });

    assert.equal(parsed.edition, 'INTERNATIONAL');
    assert.equal('defaultPlatform' in parsed, false);
    assert.equal('defaultServerRegion' in parsed, false);
  });

  it('strips the retired default game account when creating a league team', () => {
    const parsed = CreateLeagueTeamRequestSchema.parse({
      ownerUserId: '11111111-1111-4111-8111-111111111111',
      ownerAlias: '申花经理',
      teamNumber: 1,
      catalogTeamId: '33333333-3333-4333-8333-333333333333',
      defaultGameAccountId: '22222222-2222-4222-8222-222222222222'
    });

    assert.equal('defaultGameAccountId' in parsed, false);
  });

  it('accepts nullable legacy game identity snapshots on season entries', () => {
    const parsed = SeasonEntrySchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      seasonId: '22222222-2222-4222-8222-222222222222',
      teamProfileId: null,
      leagueTeamId: '33333333-3333-4333-8333-333333333333',
      ownerUserId: '44444444-4444-4444-8444-444444444444',
      gameAccountId: null,
      source: 'NEW_APPLICATION',
      status: 'APPROVED',
      previousSeasonEntryId: null,
      teamNameSnapshot: '上海申花',
      teamShortNameSnapshot: '申花',
      teamNumberSnapshot: 1,
      teamLogoUrlSnapshot: null,
      gamePlatformSnapshot: null,
      serverRegionSnapshot: null,
      gamerTagSnapshot: null,
      gameUidSnapshot: null,
      leagueEditionSnapshot: 'NATIONAL',
      reviewedById: null,
      reviewedAt: null,
      decisionReason: null,
      confirmedAt: null,
      withdrawnAt: null,
      version: 1,
      createdAt: '2026-09-30T00:00:00.000Z',
      updatedAt: '2026-09-30T00:00:00.000Z'
    });

    assert.equal(parsed.gameAccountId, null);
    assert.equal(parsed.leagueEditionSnapshot, 'NATIONAL');
  });

  it('validates the compact current season summary', () => {
    const parsed = CurrentSeasonSummarySchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      displayName: 'S20 赛季',
      status: 'REGISTRATION_OPEN',
      approvedEntryCount: 18
    });

    assert.equal(parsed.approvedEntryCount, 18);
    assert.throws(() => CurrentSeasonSummarySchema.parse({ ...parsed, approvedEntryCount: -1 }));
  });

  it('requires optimistic versions and duplicate-free team enrollment ids', () => {
    const firstId = '11111111-1111-4111-8111-111111111111';
    assert.deepEqual(SetCurrentSeasonRequestSchema.parse({ expectedVersion: 2 }), {
      expectedVersion: 2
    });
    assert.deepEqual(EnrollLeagueTeamsRequestSchema.parse({
      leagueTeamIds: [firstId],
      expectedSeasonVersion: 3
    }), {
      leagueTeamIds: [firstId],
      expectedSeasonVersion: 3
    });
    assert.throws(() => EnrollLeagueTeamsRequestSchema.parse({
      leagueTeamIds: [firstId, firstId],
      expectedSeasonVersion: 3
    }));
  });

  it('requires positive optimistic versions for league foundation updates', () => {
    assert.throws(() => UpdateLeagueRequestSchema.parse({ name: '新名称' }));
    assert.throws(() => UpdateLeagueSeasonRequestSchema.parse({ displayName: 'S21' }));
    assert.throws(() => UpdateTeamProfileRequestSchema.parse({ name: '新球队' }));
    assert.throws(() => UpdateLeagueRequestSchema.parse({ expectedVersion: 0 }));
  });

  it('does not inject create defaults into a league update', () => {
    assert.deepEqual(UpdateLeagueRequestSchema.parse({ expectedVersion: 3 }), {
      expectedVersion: 3
    });
    assert.deepEqual(UpdateTeamProfileRequestSchema.parse({ expectedVersion: 2 }), {
      expectedVersion: 2
    });
  });

  it('applies catalog query defaults and bounds', () => {
    const query = PlayerSearchQuerySchema.parse({ keyword: '  亚马尔  ', minOverall: '90' });

    assert.deepEqual(query, { keyword: '亚马尔', minOverall: 90, limit: 20 });
    assert.throws(() => PlayerSearchQuerySchema.parse({ limit: 101 }));
  });

  it('accepts every PESDATA-specific player category', () => {
    assert.equal(PlayerSearchQuerySchema.parse({ cardType: 'LEGENDARY' }).cardType, 'LEGENDARY');
    assert.equal(PlayerSearchQuerySchema.parse({ cardType: 'SHOW_TIME' }).cardType, 'SHOW_TIME');
  });

  it('validates player favorite requests and bounded list queries', () => {
    const playerId = '11111111-1111-4111-8111-111111111111';
    assert.equal(CreatePlayerFavoriteRequestSchema.parse({ playerId }).playerId, playerId);
    assert.throws(() => CreatePlayerFavoriteRequestSchema.parse({ playerId: 'player-1' }));

    const query = PlayerFavoriteListQuerySchema.parse({ keyword: '  梅西  ' });
    assert.equal(query.keyword, '梅西');
    assert.equal(query.limit, 20);
    assert.equal(PlayerFavoriteListQuerySchema.parse({ limit: 100 }).limit, 100);
    assert.throws(() => PlayerFavoriteListQuerySchema.parse({ limit: 101 }));
  });

  it('rejects oversized favorite status queries', () => {
    const first = '11111111-1111-4111-8111-111111111111';
    const second = '22222222-2222-4222-8222-222222222222';
    assert.deepEqual(
      PlayerFavoriteStatusQuerySchema.parse({ playerIds: `${first},${first},${second}` }).playerIds,
      [first, second]
    );
    const tooMany = Array.from({ length: 101 }, (_, index) => (
      `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    )).join(',');
    assert.throws(() => PlayerFavoriteStatusQuerySchema.parse({ playerIds: tooMany }));
  });

  it('rejects an import record without either player name', () => {
    assert.throws(() => NormalizedPlayerCardRecordSchema.parse({
      externalId: 'card-1',
      cardName: 'Featured',
      position: 'CF',
      overallRating: 95,
      cardType: 'FEATURED'
    }));
  });

  it('rejects non-https artwork and out-of-range ratings', () => {
    const base = {
      externalId: 'card-1',
      playerNameEn: 'Player',
      cardName: 'Featured',
      position: 'CF',
      cardType: 'FEATURED'
    };

    assert.throws(() => NormalizedPlayerCardRecordSchema.parse({ ...base, overallRating: 111 }));
    assert.throws(() => NormalizedPlayerCardRecordSchema.parse({
      ...base,
      overallRating: 95,
      imageUrl: 'http://example.com/card.png'
    }));
  });

  it('accepts complete JSON metadata in player card attributes', () => {
    const parsed = NormalizedPlayerCardRecordSchema.parse({
      externalId: '8801',
      playerNameEn: 'Authorized Player',
      cardName: 'Epic Test',
      position: 'CB',
      overallRating: 87,
      cardType: 'EPIC',
      attributes: {
        speed: 77,
        foot: 'RIGHT',
        positionHot: ['CB', 'DMF'],
        boost: { Tackling: 2 },
        featured: true
      }
    });

    assert.deepEqual(parsed.attributes, {
      speed: 77,
      foot: 'RIGHT',
      positionHot: ['CB', 'DMF'],
      boost: { Tackling: 2 },
      featured: true
    });
  });

  it('accepts a complete automatic build and rejects partial build metadata', () => {
    const base = {
      externalId: '88045755859255',
      playerNameEn: 'Leonardo Bonucci',
      cardName: 'Epic Power Tackle',
      position: 'CB',
      overallRating: 87,
      cardType: 'EPIC'
    } as const;
    const parsed = NormalizedPlayerCardRecordSchema.parse({
      ...base,
      autoBuildAllocation: { defending: 12, aerialStrength: 8 },
      autoBuildMaxOverall: 98,
      dtRating: 97,
      algorithmVersion: 'pesdata-auto-v1'
    });

    assert.equal(parsed.autoBuildMaxOverall, 98);
    assert.equal(parsed.dtRating, 97);
    assert.throws(() => NormalizedPlayerCardRecordSchema.parse({
      ...base,
      autoBuildMaxOverall: 98
    }));
  });

  it('exposes a complete automatic build on a public player card detail', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const parsed = PlayerCardDetailSchema.parse({
      id,
      playerId: '22222222-2222-4222-8222-222222222222',
      playerNameZh: '古利特',
      playerNameEn: 'Ruud Gullit',
      cardName: '史诗卡',
      position: 'SS',
      overallRating: 88,
      cardType: 'EPIC',
      playStyle: '影子前锋',
      imageUrl: null,
      pack: null,
      publishedAt: '2026-10-01T00:00:00.000Z',
      nationality: '荷兰',
      club: 'AC 米兰',
      status: 'ACTIVE',
      skills: [],
      attributes: {},
      otherCards: [],
      autoBuild: {
        allocation: { shooting: 8, passing: 4, dribbling: 12 },
        maxOverall: 101,
        dtRating: 99,
        algorithmVersion: 'pesdata-auto-v1',
      },
    });

    assert.deepEqual(parsed.autoBuild, {
      allocation: { shooting: 8, passing: 4, dribbling: 12 },
      maxOverall: 101,
      dtRating: 99,
      algorithmVersion: 'pesdata-auto-v1',
    });
    assert.equal(PlayerCardDetailSchema.parse({ ...parsed, autoBuild: null }).autoBuild, null);
  });

  it('accepts the first-release individual round-robin competition shape', () => {
    const parsed = CreateCompetitionRequestSchema.parse({
      name: '秋季个人联赛',
      description: '4 人测试联赛',
      platform: 'MOBILE',
      serverRegion: 'GLOBAL',
      participantType: 'INDIVIDUAL',
      format: 'ROUND_ROBIN',
      registrationOpensAt: '2026-10-01T00:00:00.000Z',
      registrationClosesAt: '2026-10-08T00:00:00.000Z',
      startsAt: '2026-10-09T00:00:00.000Z',
      endsAt: '2026-10-31T00:00:00.000Z',
      participantLimit: 16
    });

    assert.equal(parsed.participantLimit, 16);
  });

  it('rejects invalid competition windows and score mutations', () => {
    const validCompetition = {
      name: '秋季个人联赛',
      description: '4 人测试联赛',
      platform: 'MOBILE' as const,
      serverRegion: 'GLOBAL',
      participantType: 'INDIVIDUAL' as const,
      format: 'ROUND_ROBIN' as const,
      registrationOpensAt: '2026-10-01T00:00:00.000Z',
      registrationClosesAt: '2026-10-08T00:00:00.000Z',
      startsAt: '2026-10-09T00:00:00.000Z',
      endsAt: '2026-10-31T00:00:00.000Z',
      participantLimit: 16
    };

    assert.throws(() => CreateCompetitionRequestSchema.parse({
      ...validCompetition,
      registrationClosesAt: '2026-09-30T23:59:59.000Z'
    }));
    assert.throws(() => SubmitMatchResultRequestSchema.parse({
      homeScore: -1,
      awayScore: 2,
      expectedVersion: 1
    }));
    assert.throws(() => SubmitMatchResultRequestSchema.parse({
      homeScore: 1,
      awayScore: 2,
      expectedVersion: 0
    }));
  });

  it('keeps future participant and format enum values reserved but unavailable on create', () => {
    assert.equal(CompetitionParticipantTypeSchema.parse('TEAM'), 'TEAM');
    assert.equal(CompetitionFormatSchema.parse('SINGLE_ELIMINATION'), 'SINGLE_ELIMINATION');

    assert.throws(() => CreateCompetitionRequestSchema.parse({
      name: '团队杯',
      description: '',
      platform: 'MOBILE',
      serverRegion: 'GLOBAL',
      participantType: 'TEAM',
      format: 'SINGLE_ELIMINATION',
      registrationOpensAt: '2026-10-01T00:00:00.000Z',
      registrationClosesAt: '2026-10-08T00:00:00.000Z',
      startsAt: '2026-10-09T00:00:00.000Z',
      endsAt: '2026-10-31T00:00:00.000Z',
      participantLimit: 16
    }));
  });

  it('accepts bounded idempotency keys', () => {
    assert.equal(IdempotencyKeySchema.parse(' score-1 '), 'score-1');
    assert.throws(() => IdempotencyKeySchema.parse(''));
    assert.throws(() => IdempotencyKeySchema.parse('x'.repeat(129)));
  });

  it('exposes tie state, result ownership, and competition capabilities in public responses', () => {
    const competitionId = '11111111-1111-4111-8111-111111111111';
    const participantId = '22222222-2222-4222-8222-222222222222';
    const matchId = '33333333-3333-4333-8333-333333333333';
    const resultId = '44444444-4444-4444-8444-444444444444';

    const standings = StandingsSnapshotResponseSchema.parse({
      competitionId,
      version: 1,
      ruleVersion: 1,
      triggeringResultVersionId: resultId,
      generatedAt: '2026-10-10T12:00:00.000Z',
      rows: [{
        participantId,
        displayName: '球员一',
        played: 1,
        wins: 0,
        draws: 1,
        losses: 0,
        goalsFor: 1,
        goalsAgainst: 1,
        goalDifference: 0,
        basePoints: 1,
        adjustmentPoints: 0,
        totalPoints: 1,
        rank: 1,
        tiePending: true,
        tieBreakValues: { headToHeadPoints: 1 }
      }]
    });
    assert.equal(standings.rows[0]?.tiePending, true);

    const detail = CompetitionDetailSchema.parse({
      id: competitionId,
      name: '秋季个人联赛',
      description: '4 人测试联赛',
      platform: 'MOBILE',
      serverRegion: 'GLOBAL',
      participantType: 'INDIVIDUAL',
      format: 'ROUND_ROBIN',
      status: 'IN_PROGRESS',
      registrationOpensAt: '2026-10-01T00:00:00.000Z',
      registrationClosesAt: '2026-10-08T00:00:00.000Z',
      startsAt: '2026-10-09T00:00:00.000Z',
      endsAt: '2026-10-31T00:00:00.000Z',
      participantLimit: 16,
      participantCount: 4,
      version: 3,
      activeRuleVersion: 1,
      currentRegistration: null,
      rules: { winPoints: 3, drawPoints: 1, lossPoints: 0, tieBreakers: ['TOTAL_POINTS'] },
      schedule: { published: true, matchCount: 6, roundCount: 3 },
      capabilities: {
        canRegister: false,
        canWithdraw: false,
        canManage: true,
        canReviewRegistrations: true,
        canManageSchedule: true,
        canManageResults: true
      },
      createdAt: '2026-09-25T00:00:00.000Z',
      updatedAt: '2026-10-09T00:00:00.000Z'
    });
    assert.equal(detail.capabilities.canManage, true);

    const resultVersion = MatchResultVersionResponseSchema.parse({
      id: resultId,
      matchId,
      version: 1,
      homeScore: 1,
      awayScore: 1,
      status: 'PROPOSED' as const,
      submissionSide: 'HOME' as const,
      submittedByMe: true,
      reason: null,
      createdAt: '2026-10-10T12:00:00.000Z'
    });
    assert.equal(resultVersion.submittedByMe, true);
  });
});

describe('league team administration contracts', () => {
  it('uses an explicit audit description when a player purchase omits its optional reason', () => {
    const parsed = AcquirePlayerRequestSchema.parse({
      seasonId: '11111111-1111-4111-8111-111111111111',
      targetLeagueTeamId: '22222222-2222-4222-8222-222222222222',
      playerCardId: '33333333-3333-4333-8333-333333333333',
      amountMinor: 100,
      idempotencyKey: 'purchase-without-reason'
    });

    assert.equal(parsed.reason, '购买球员（未填写原因）');
  });

  it('validates combined administrator player candidate filters', () => {
    const packId = '11111111-1111-4111-8111-111111111111';
    assert.deepEqual(RosterPlayerCandidateQuerySchema.parse({
      keyword: '  梅西  ', position: 'AMF', cardType: 'EPIC', cardPackId: packId
    }), { keyword: '梅西', position: 'AMF', cardType: 'EPIC', cardPackId: packId });
    assert.throws(() => RosterPlayerCandidateQuerySchema.parse({ keyword: ' ' }));
    assert.throws(() => RosterPlayerCandidateQuerySchema.parse({ keyword: '梅西', position: 'ST' }));
  });

  it('accepts non-active asset lifecycle states and league economy ledger types', () => {
    assert.equal(RosterEntryStatusSchema.parse('DISAPPEARED'), 'DISAPPEARED');
    assert.equal(RosterEntryStatusSchema.parse('RETIRED'), 'RETIRED');
    assert.equal(FinanceLedgerTypeSchema.parse('TRANSACTION_FEE'), 'TRANSACTION_FEE');
    assert.equal(FinanceLedgerTypeSchema.parse('LUXURY_TAX'), 'LUXURY_TAX');
    assert.equal(FinanceLedgerTypeSchema.parse('OFFSEASON_FEE'), 'OFFSEASON_FEE');
    assert.equal(FinanceLedgerTypeSchema.parse('UNFINISHED_MATCH_PENALTY'), 'UNFINISHED_MATCH_PENALTY');
    assert.equal(FinanceLedgerTypeSchema.parse('AUCTION'), 'AUCTION');
    assert.equal(FinanceLedgerTypeSchema.parse('ROOKIE_SELECTION'), 'ROOKIE_SELECTION');
    assert.equal(FinanceLedgerTypeSchema.parse('INSTALLMENT_PAYMENT'), 'INSTALLMENT_PAYMENT');
  });

  it('validates team shell value and roster lifecycle maintenance requests', () => {
    assert.equal(UpdateLeagueTeamRequestSchema.parse({
      shellValueMinor: 12_000,
      expectedVersion: 1
    }).shellValueMinor, 12_000);
    assert.equal(UpdateRosterLifecycleRequestSchema.parse({
      seasonId: '11111111-1111-4111-8111-111111111111',
      ownershipId: '22222222-2222-4222-8222-222222222222',
      status: 'DISAPPEARED',
      reason: '球员从游戏数据库中消失',
      expectedVersion: 1,
      idempotencyKey: 'roster-lifecycle-1'
    }).status, 'DISAPPEARED');
    assert.throws(() => UpdateRosterLifecycleRequestSchema.parse({
      seasonId: '11111111-1111-4111-8111-111111111111',
      ownershipId: '22222222-2222-4222-8222-222222222222',
      status: 'RELEASED',
      reason: '不允许',
      expectedVersion: 1,
      idempotencyKey: 'roster-lifecycle-2'
    }));
  });
  const ids = {
    admin: '11111111-1111-4111-8111-111111111111',
    league: '22222222-2222-4222-8222-222222222222',
    user: '33333333-3333-4333-8333-333333333333',
    team: '44444444-4444-4444-8444-444444444444',
    season: '55555555-5555-4555-8555-555555555555',
    player: '66666666-6666-4666-8666-666666666666',
    card: '77777777-7777-4777-8777-777777777777',
    ownership: '88888888-8888-4888-8888-888888888888',
    rule: '99999999-9999-4999-8999-999999999999',
    transaction: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ledger: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    window: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    grant: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  };
  const createdAt = '2026-09-27T12:00:00.000Z';

  it('requires an exact six-digit public user number', () => {
    assert.equal(PublicUserNumberSchema.parse('100069'), '100069');
    assert.throws(() => PublicUserNumberSchema.parse('00001'));
    assert.throws(() => PublicUserNumberSchema.parse('1000000'));
    assert.throws(() => PublicUserNumberSchema.parse('10A069'));
  });

  it('allows memorable zero-based integer team numbers', () => {
    assert.equal(TeamNumberSchema.parse(0), 0);
    assert.equal(TeamNumberSchema.parse(23), 23);
    assert.throws(() => TeamNumberSchema.parse(-1));
    assert.throws(() => TeamNumberSchema.parse(1.5));
  });

  it('requires a catalog shell and league-specific alias when creating a team', () => {
    const parsed = CreateLeagueTeamRequestSchema.parse({
      ownerUserId: ids.user,
      ownerAlias: '  tidus  ',
      teamNumber: 3,
      catalogTeamId: ids.card
    });

    assert.equal(parsed.ownerAlias, 'tidus');
    assert.equal(parsed.catalogTeamId, ids.card);
    assert.throws(() => CreateLeagueTeamRequestSchema.parse({
      ownerUserId: ids.user,
      ownerAlias: 'tidus',
      teamNumber: 3
    }));
    assert.throws(() => CreateLeagueTeamRequestSchema.parse({
      ownerUserId: ids.user,
      ownerAlias: 'x'.repeat(33),
      teamNumber: 3,
      catalogTeamId: ids.card
    }));
  });

  it('keeps shell identity out of general team updates', () => {
    const parsed = UpdateLeagueTeamRequestSchema.parse({ ownerAlias: ' 新称呼 ', expectedVersion: 2 });
    assert.equal(parsed.ownerAlias, '新称呼');
    assert.throws(() => UpdateLeagueTeamRequestSchema.parse({
      name: '绕过目录改名',
      expectedVersion: 2
    }));
    assert.throws(() => UpdateLeagueTeamRequestSchema.parse({
      logoUrl: 'https://outside.example/logo.png',
      expectedVersion: 2
    }));
  });

  it('parses published catalog items independently from league assignment', () => {
    const item = {
      id: ids.card,
      sourceType: 'PESDATA' as const,
      sourceExternalId: 'team-101',
      sourceLeagueExternalId: 'league-7',
      sourceLeagueName: '荷兰足球甲级联赛',
      nameZh: '阿贾克斯',
      nameEn: 'Ajax',
      nameJa: null,
      shortName: '阿贾克斯',
      remoteLogoUrl: 'https://img.pesdata.net/ajax.png',
      storedLogoUrl: 'https://media.example/team-crests/ajax.webp',
      status: 'ACTIVE' as const,
      sourceUpdatedAt: null,
      lastSyncedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      isAssigned: true,
      assignedLeagueTeamId: ids.team
    };
    const response = TeamCatalogListResponseSchema.parse({ items: [item], nextCursor: null });
    assert.equal(response.items[0]?.nameZh, '阿贾克斯');
    assert.equal(response.items[0]?.isAssigned, true);
    assert.equal(CreateCustomTeamCatalogItemRequestSchema.parse({
      nameZh: '自定义球队',
      shortName: '自定义',
      storedLogoUrl: 'https://media.example/team-crests/custom.webp'
    }).shortName, '自定义');
  });

  it('parses staged team catalog synchronization differences', () => {
    const run = TeamCatalogSyncRunSummarySchema.parse({
      id: ids.transaction,
      mode: 'INCREMENTAL',
      status: 'READY',
      scannedCount: 12,
      addedCount: 2,
      updatedCount: 1,
      missingCount: 1,
      failedCount: 0,
      createdAt,
      completedAt: createdAt,
      errorCode: null
    });
    const difference = TeamCatalogSyncDifferenceSchema.parse({
      id: ids.ledger,
      runId: run.id,
      sourceExternalId: 'team-101',
      changeType: 'UPDATED',
      reviewStatus: 'PENDING',
      currentCatalogItemId: ids.card,
      candidate: {
        sourceExternalId: 'team-101',
        sourceLeagueExternalId: 'league-7',
        sourceLeagueName: '荷兰足球甲级联赛',
        nameZh: '阿贾克斯',
        nameEn: 'Ajax',
        nameJa: null,
        shortName: '阿贾克斯',
        remoteLogoUrl: 'https://img.pesdata.net/ajax.png',
        storedLogoUrl: 'https://media.example/team-crests/ajax-v2.webp',
        sourceUpdatedAt: null
      },
      errorCode: null
    });
    assert.equal(difference.changeType, 'UPDATED');
  });

  it('requires complete and distinct shell operation requests', () => {
    assert.equal(ChangeTeamShellRequestSchema.parse({
      catalogTeamId: ids.card,
      expectedVersion: 1
    }).catalogTeamId, ids.card);
    assert.throws(() => TransferTeamShellRequestSchema.parse({
      targetTeamId: ids.team,
      expectedSourceVersion: 1,
      expectedTargetVersion: 1
    }));
    assert.equal(TransferTeamShellRequestSchema.parse({
      targetTeamId: ids.team,
      sourceReplacementCatalogTeamId: ids.card,
      expectedSourceVersion: 1,
      expectedTargetVersion: 1
    }).sourceReplacementCatalogTeamId, ids.card);
    assert.throws(() => SwapTeamShellRequestSchema.parse({
      sourceTeamId: ids.team,
      otherTeamId: ids.team,
      expectedSourceVersion: 1,
      expectedOtherVersion: 1
    }));
    assert.equal(RefreshTeamShellRequestSchema.parse({
      catalogTeamId: ids.card,
      expectedVersion: 1
    }).catalogTeamId, ids.card);
  });

  it('requires positive integer minor units for transaction amounts', () => {
    assert.equal(MoneyMinorSchema.parse(1), 1);
    assert.equal(MoneyMinorSchema.parse(4_294_967_295), 4_294_967_295);
    assert.throws(() => MoneyMinorSchema.parse(0));
    assert.throws(() => MoneyMinorSchema.parse(-1));
    assert.throws(() => MoneyMinorSchema.parse(1.5));
    assert.throws(() => MoneyMinorSchema.parse(4_294_967_296));
  });

  it('requires explicit salary recalculation confirmation and a reasoned emergency change', () => {
    const base = {
      seasonId: ids.season,
      idempotencyKey: 'roster-change-1',
      reason: 'Administrator confirmed correction'
    };
    assert.equal(RecalculateLeagueSalaryRequestSchema.parse({
      ...base,
      leagueId: ids.league,
      salaryRuleVersionId: ids.rule,
      confirm: true
    }).confirm, true);
    assert.throws(() => RecalculateLeagueSalaryRequestSchema.parse({
      ...base,
      leagueId: ids.league,
      salaryRuleVersionId: ids.rule,
      confirm: false
    }));
    assert.throws(() => EmergencyCorrectRosterRequestSchema.parse({
      ...base,
      ownershipId: ids.ownership,
      targetLeagueTeamId: null,
      newPlayerCardId: null,
      expectedVersion: 1
    }));
    assert.throws(() => EmergencyCorrectRosterRequestSchema.parse({
      ...base,
      reason: '',
      ownershipId: ids.ownership,
      targetLeagueTeamId: ids.team,
      newPlayerCardId: null,
      expectedVersion: 1
    }));
  });

  it('requires salary tiers to cover every DT value without gaps or overlaps', () => {
    const base = {
      id: ids.rule,
      leagueId: ids.league,
      version: 1,
      salaryCapMinor: 10_000,
      status: 'ACTIVE' as const,
      effectiveAt: createdAt,
      createdByAdminId: ids.admin,
      createdAt
    };
    const validTiers = [
      { minDtRating: 0, maxDtRating: 92, salaryMinor: 100 },
      { minDtRating: 93, maxDtRating: 93, salaryMinor: 200 },
      { minDtRating: 94, maxDtRating: 99, salaryMinor: 300 },
      { minDtRating: 100, maxDtRating: 120, salaryMinor: 900 }
    ];

    assert.equal(SalaryRuleVersionSchema.parse({ ...base, tiers: validTiers }).tiers.length, 4);
    assert.throws(() => SalaryRuleVersionSchema.parse({
      ...base,
      tiers: validTiers.map((tier, index) => index === 1 ? { ...tier, minDtRating: 94 } : tier)
    }));
    assert.throws(() => SalaryRuleVersionSchema.parse({
      ...base,
      tiers: validTiers.map((tier, index) => index === 1 ? { ...tier, minDtRating: 92 } : tier)
    }));
    assert.throws(() => CreateSalaryRuleVersionRequestSchema.parse({
      salaryCapMinor: 10_000,
      tiers: validTiers,
      effectiveAt: '2999-01-01T00:00:00.000Z',
      expectedCurrentVersion: 0
    }));
  });

  it('requires an increasing transfer timeline and at least one enabled operation', () => {
    const valid = {
      id: ids.window,
      seasonId: ids.season,
      name: '冬季窗口',
      startsAt: '2026-12-01T00:00:00.000Z',
      endsAt: '2026-12-15T00:00:00.000Z',
      allowBuy: true,
      allowSell: false,
      allowTransfer: false,
      allowCardUpgrade: true,
      createdByAdminId: ids.admin,
      version: 1,
      createdAt,
      updatedAt: createdAt
    };

    assert.equal(TransferWindowSchema.parse(valid).allowCardUpgrade, true);
    assert.throws(() => TransferWindowSchema.parse({ ...valid, endsAt: valid.startsAt }));
    assert.throws(() => TransferWindowSchema.parse({
      ...valid,
      allowBuy: false,
      allowCardUpgrade: false
    }));
  });

  it('validates every core administrator and league-team response schema', () => {
    const admin = AdminAccountSummarySchema.parse({
      id: ids.admin,
      username: 'manager01',
      displayName: '赛事管理员',
      status: 'ACTIVE',
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      version: 1,
      createdAt,
      updatedAt: createdAt
    });
    assert.equal(AdminLoginRequestSchema.parse({ username: ' manager01 ', password: 'password-123' }).username, 'manager01');
    assert.equal(AdminAuthResponseSchema.parse({
      accessToken: 'access-token',
      expiresInSeconds: 900,
      refreshToken: 'r'.repeat(32),
      refreshExpiresInSeconds: 2_592_000,
      admin
    }).admin.id, ids.admin);
    assert.equal(AdminLeagueGrantSchema.parse({
      id: ids.grant,
      adminId: ids.admin,
      leagueId: ids.league,
      leagueName: 'CELL 联赛',
      role: 'LEAGUE_MANAGER',
      grantedById: ids.admin,
      createdAt,
      revokedAt: null,
      version: 1
    }).leagueName, 'CELL 联赛');

    const user = PublicUserLookupSchema.parse({
      id: ids.user,
      publicUserNo: '100069',
      displayName: '小宣',
      avatarUrl: null
    });
    assert.equal(user.publicUserNo, '100069');

    const team = {
      id: ids.team,
      leagueId: ids.league,
      ownerUserId: ids.user,
      ownerPublicUserNo: '100069',
      ownerDisplayName: '小宣',
      ownerAlias: 'tidus',
      catalogTeamId: ids.card,
      teamNumber: 0,
      name: '巴西红牛',
      shortName: '红牛',
      logoUrl: null,
      status: 'ACTIVE' as const,
      rosterStatus: 'COMPLIANT' as const,
      activePlayerCount: 1,
      salaryTotalMinor: 600,
      salaryCapMinor: 10_000,
      shellValueMinor: 20_000,
      version: 1,
      createdAt,
      updatedAt: createdAt
    };
    assert.equal(LeagueTeamSummarySchema.parse(team).ownerDisplayName, '小宣');
    assert.equal(LeagueTeamDetailSchema.parse({
      ...team,
      ownerDisplayName: '小宣',
      defaultGameAccountId: null,
      participatingSeasonCount: 2
    }).participatingSeasonCount, 2);

    const rosterEntry = RosterEntrySchema.parse({
      id: ids.ownership,
      leagueId: ids.league,
      leagueTeamId: ids.team,
      playerId: ids.player,
      playerName: 'Leonardo Bonucci',
      currentPlayerCardId: ids.card,
      cardName: 'Epic Italy',
      maxOverall: 97,
      dtRating: 97,
      salaryRuleVersionId: ids.rule,
      salaryMinor: 600,
      acquiredAt: createdAt,
      status: 'ACTIVE',
      version: 1
    });
    assert.equal(rosterEntry.playerId, ids.player);

    const transaction = RosterTransactionSchema.parse({
      id: ids.transaction,
      leagueId: ids.league,
      seasonId: ids.season,
      type: 'BUY',
      playerId: ids.player,
      sourceLeagueTeamId: null,
      targetLeagueTeamId: ids.team,
      oldPlayerCardId: null,
      newPlayerCardId: ids.card,
      oldSalaryMinor: null,
      newSalaryMinor: 600,
      amountMinor: 2_000,
      reason: '管理员登记购买',
      createdByAdminId: ids.admin,
      createdAt
    });
    assert.equal(transaction.type, 'BUY');

    assert.equal(RosterMutationResponseSchema.parse({
      ownership: {
        id: ids.ownership,
        leagueId: ids.league,
        leagueTeamId: ids.team,
        playerId: ids.player,
        currentPlayerCardId: ids.card,
        dtRating: 97,
        salaryRuleVersionId: ids.rule,
        salaryMinor: 600,
        acquiredAt: createdAt,
        status: 'ACTIVE',
        version: 2
      },
      transaction,
      summary: { rosterCount: 1, salaryMinor: 600, salaryCapMinor: 10_000 }
    }).transaction.playerId, ids.player);

    assert.equal(SalaryRecalculationResponseSchema.parse({
      leagueId: ids.league,
      seasonId: ids.season,
      salaryRuleVersionId: ids.rule,
      recalculatedPlayers: 1,
      overCapTeams: 1,
      teams: [{
        leagueTeamId: ids.team,
        salaryMinor: 600,
        rosterStatus: 'OVER_CAP'
      }]
    }).teams[0]?.rosterStatus, 'OVER_CAP');

    const ledger = FinanceLedgerEntrySchema.parse({
      id: ids.ledger,
      leagueId: ids.league,
      leagueTeamId: ids.team,
      rosterTransactionId: ids.transaction,
      direction: 'DEBIT',
      type: 'PLAYER_PURCHASE',
      amountMinor: 2_000,
      note: '购买博努奇',
      createdAt
    });
    assert.equal(ledger.direction, 'DEBIT');
  });
});

describe('tiered league contracts', () => {
  const ids = {
    league: '11111111-1111-4111-8111-111111111111',
    season: '22222222-2222-4222-8222-222222222222',
    competition: '33333333-3333-4333-8333-333333333333',
    stage: '44444444-4444-4444-8444-444444444444',
    proposal: '55555555-5555-4555-8555-555555555555',
    row: '66666666-6666-4666-8666-666666666666',
    entry: '77777777-7777-4777-8777-777777777777',
    participant: '88888888-8888-4888-8888-888888888888'
  };
  const createdAt = '2026-10-03T00:00:00.000Z';

  it('parses tiered competition types, stages, proposals, and grouped standings', () => {
    assert.equal(CompetitionTypeSchema.parse('DIVISION_LEAGUE'), 'DIVISION_LEAGUE');
    assert.equal(CompetitionStageCodeSchema.parse('CHAMPION_A'), 'CHAMPION_A');

    const stage = CompetitionStageSummarySchema.parse({
      id: ids.stage,
      competitionId: ids.competition,
      stageCode: 'CHAMPION_A',
      displayName: '冠军 A 组',
      sequence: 1,
      capacity: 18,
      format: 'ROUND_ROBIN',
      status: 'DRAFT',
      participantCount: 1,
      version: 1
    });
    const row = SeasonAllocationProposalRowSchema.parse({
      id: ids.row,
      proposalId: ids.proposal,
      seasonEntryId: ids.entry,
      teamName: '上海海港',
      suggestedStageCode: stage.stageCode,
      source: 'FIRST_SEASON',
      previousRank: null,
      pointsPerMatch: null,
      goalDifferencePerMatch: null,
      goalsForPerMatch: null,
      tiePending: false,
      reason: '首赛季均分'
    });
    assert.equal(SeasonAllocationProposalSchema.parse({
      id: ids.proposal,
      seasonId: ids.season,
      version: 1,
      status: 'DRAFT',
      algorithmVersion: 'tiered-v1',
      randomSeed: 20261003,
      rows: [row],
      createdAt
    }).rows[0]?.suggestedStageCode, 'CHAMPION_A');
    assert.equal(SeasonAllocationDecisionSchema.parse({
      id: ids.row,
      proposalId: ids.proposal,
      seasonEntryId: ids.entry,
      finalStageCode: 'CHAMPION_A',
      overridden: false,
      reason: null,
      createdAt
    }).overridden, false);
    assert.equal(DivisionStandingsResponseSchema.parse({
      seasonId: ids.season,
      competitionId: ids.competition,
      myStageId: ids.stage,
      groups: [{
        stage: { ...stage, status: 'PUBLISHED' },
        standings: {
          competitionId: ids.competition,
          stageId: ids.stage,
          version: 1,
          ruleVersion: 1,
          triggeringResultVersionId: null,
          generatedAt: createdAt,
          rows: [{
            participantId: ids.participant,
            displayName: '上海海港',
            played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            goalDifference: 0,
            basePoints: 0,
            adjustmentPoints: 0,
            totalPoints: 0,
            rank: 1,
            tiePending: false,
            tieBreakValues: {}
          }]
        }
      }]
    }).groups[0]?.standings.rows[0]?.rank, 1);
  });

  it('parses an enrolled league workspace summary', () => {
    const workspace = LeagueWorkspaceResponseSchema.parse({
      leagueId: '11111111-1111-4111-8111-111111111111', seasonId: '22222222-2222-4222-8222-222222222222',
      team: { leagueTeamId: '33333333-3333-4333-8333-333333333333', name: '上海海港', shortName: '海港', logoUrl: null },
      division: { stageId: '44444444-4444-4444-8444-444444444444', stageCode: 'CHAMPION_A', displayName: '冠军 A 组' },
      currentRank: { rank: 2, points: 13, played: 6, tiePending: false },
      nextMatch: { id: '55555555-5555-4555-8555-555555555555', roundNumber: 7, plannedAt: null, opponentName: '申花', side: 'HOME' },
      capabilities: { canViewStandings: true, canViewAssets: true, canViewFinance: true, canManageValuations: true }
    });

    assert.equal(workspace.currentRank?.rank, 2);
    assert.equal(workspace.nextMatch?.opponentName, '申花');
  });

  it('rejects invalid stage codes, seeds, duplicate overrides, and empty reasons', () => {
    assert.throws(() => CompetitionStageCodeSchema.parse('UNKNOWN_STAGE'));
    assert.throws(() => GenerateSeasonAllocationRequestSchema.parse({ expectedSeasonVersion: 1, randomSeed: 0 }));
    const override = {
      seasonEntryId: ids.entry,
      targetStageCode: 'CHAMPION_B',
      reason: '平衡组别人数'
    };
    assert.throws(() => ConfirmSeasonAllocationRequestSchema.parse({
      proposalId: ids.proposal,
      expectedSeasonVersion: 2,
      overrides: [override, override]
    }));
    assert.throws(() => ConfirmSeasonAllocationRequestSchema.parse({
      proposalId: ids.proposal,
      expectedSeasonVersion: 2,
      overrides: [{ ...override, reason: ' ' }]
    }));
  });

  it('requires optimistic versions for stage schedule generation and publication', () => {
    assert.deepEqual(GenerateStageScheduleRequestSchema.parse({ expectedStageVersion: 2 }), {
      expectedStageVersion: 2
    });
    assert.deepEqual(PublishStageScheduleRequestSchema.parse({
      expectedStageVersion: 2,
      expectedSeasonVersion: 4
    }), { expectedStageVersion: 2, expectedSeasonVersion: 4 });
    assert.throws(() => GenerateStageScheduleRequestSchema.parse({ expectedStageVersion: 0 }));
  });
});

describe('cup center contracts', () => {
  const seasonId = '11111111-1111-4111-8111-111111111111';
  const entryId = '22222222-2222-4222-8222-222222222222';
  const competitionId = '33333333-3333-4333-8333-333333333333';
  const userId = '44444444-4444-4444-8444-444444444444';
  const registrationId = '55555555-5555-4555-8555-555555555555';
  const registrationOpensAt = '2026-10-03T12:00:00.000Z';
  const registrationClosesAt = '2026-10-10T12:00:00.000Z';
  const startsAt = '2026-10-11T12:00:00.000Z';
  const endsAt = '2026-11-30T12:00:00.000Z';

  it('accepts a season-scoped cup-only public list query', () => {
    assert.deepEqual(CompetitionListQuerySchema.parse({
      seasonId,
      category: 'CUP',
      limit: '12'
    }), {
      seasonId,
      category: 'CUP',
      limit: 12
    });
    assert.throws(() => CompetitionListQuerySchema.parse({ seasonId: 'invalid', category: 'CUP' }));
    assert.throws(() => CompetitionListQuerySchema.parse({ seasonId, category: 'LEAGUE' }));
  });

  it('accepts a group-knockout cup with explicit group rules', () => {
    const parsed = CreateSeasonCupRequestSchema.parse({
      seasonId,
      name: 'S3 足总杯',
      description: '当前赛季杯赛',
      competitionType: 'GROUP_KNOCKOUT_CUP',
      format: 'GROUP_KNOCKOUT',
      platform: 'MOBILE',
      serverRegion: '国际服',
      registrationOpensAt,
      registrationClosesAt,
      startsAt,
      endsAt,
      participantLimit: 32,
      targetGroupSize: 4,
      qualifiersPerGroup: 2
    });

    assert.equal(parsed.targetGroupSize, 4);
    assert.equal(parsed.qualifiersPerGroup, 2);
  });

  it('accepts pure knockout cups and rejects mismatched formats or invalid qualification rules', () => {
    const knockout = CreateSeasonCupRequestSchema.parse({
      seasonId,
      name: '周末趣味杯',
      description: '',
      competitionType: 'KNOCKOUT_CUP',
      format: 'SINGLE_ELIMINATION',
      platform: 'MOBILE',
      serverRegion: '国际服',
      registrationOpensAt,
      registrationClosesAt,
      startsAt,
      endsAt,
      participantLimit: 16,
      targetGroupSize: null,
      qualifiersPerGroup: null
    });
    assert.equal(knockout.format, 'SINGLE_ELIMINATION');
    assert.throws(() => CreateSeasonCupRequestSchema.parse({
      ...knockout,
      competitionType: 'GROUP_KNOCKOUT_CUP'
    }));
    assert.throws(() => CreateSeasonCupRequestSchema.parse({
      ...knockout,
      competitionType: 'GROUP_KNOCKOUT_CUP',
      format: 'GROUP_KNOCKOUT',
      targetGroupSize: 4,
      qualifiersPerGroup: 4
    }));
  });

  it('binds a cup registration to a formal season entry without requiring a game account', () => {
    assert.deepEqual(RegisterSeasonCupRequestSchema.parse({
      seasonEntryId: entryId,
      acceptedRuleVersion: 1
    }), { seasonEntryId: entryId, acceptedRuleVersion: 1 });

    const response = CupRegistrationResponseSchema.parse({
      id: registrationId,
      competitionId,
      seasonEntryId: entryId,
      applicantId: userId,
      teamName: '上海海港',
      status: 'APPROVED',
      withdrawnAt: null,
      version: 1,
      createdAt: registrationOpensAt,
      updatedAt: registrationOpensAt
    });
    assert.equal(response.teamName, '上海海港');
    assert.deepEqual(WithdrawSeasonCupRequestSchema.parse({ expectedVersion: 2 }), { expectedVersion: 2 });
  });

  it('includes the season and team registration in a cup entry on my competitions', () => {
    const item = MyCompetitionResponseSchema.parse({
      competition: {
        id: competitionId,
        seasonId: entryId,
        competitionType: 'KNOCKOUT_CUP',
        name: 'S3 足总杯',
        description: '赛季球队杯赛',
        platform: 'MOBILE',
        serverRegion: '国际服',
        participantType: 'TEAM',
        format: 'SINGLE_ELIMINATION',
        status: 'REGISTRATION_OPEN',
        registrationOpensAt,
        registrationClosesAt,
        startsAt,
        endsAt,
        participantLimit: 16,
        participantCount: 1,
        version: 1,
        activeRuleVersion: 1,
        createdAt: registrationOpensAt,
        updatedAt: registrationOpensAt
      },
      registration: {
        id: registrationId,
        competitionId,
        seasonEntryId: entryId,
        applicantId: userId,
        teamName: '上海海港',
        status: 'APPROVED',
        withdrawnAt: null,
        version: 1,
        createdAt: registrationOpensAt,
        updatedAt: registrationOpensAt
      },
      nextMatch: null
    });
    assert.equal(item.competition.seasonId, entryId);
    assert.equal('teamName' in item.registration && item.registration.teamName, '上海海港');
  });

  it('validates versioned group proposal generation, overrides, and response rows', () => {
    assert.deepEqual(GenerateCupGroupProposalRequestSchema.parse({
      expectedCompetitionVersion: 2,
      randomSeed: 20261003
    }), { expectedCompetitionVersion: 2, randomSeed: 20261003 });
    assert.deepEqual(ConfirmCupGroupProposalRequestSchema.parse({
      proposalId: registrationId,
      expectedCompetitionVersion: 2,
      overrides: [{
        participantId: entryId,
        targetGroupCode: 'GROUP_B',
        reason: '平衡小组人数'
      }]
    }).overrides[0]?.targetGroupCode, 'GROUP_B');
    assert.throws(() => ConfirmCupGroupProposalRequestSchema.parse({
      proposalId: registrationId,
      expectedCompetitionVersion: 2,
      overrides: [
        { participantId: entryId, targetGroupCode: 'GROUP_A', reason: '第一次调整' },
        { participantId: entryId, targetGroupCode: 'GROUP_B', reason: '重复调整' }
      ]
    }));
    assert.equal(CupGroupProposalSchema.parse({
      id: registrationId,
      competitionId,
      version: 1,
      status: 'DRAFT',
      algorithmVersion: 'cup-groups-v1',
      randomSeed: 20261003,
      rows: [{
        id: userId,
        participantId: entryId,
        teamName: '上海海港',
        suggestedGroupCode: 'GROUP_A',
        finalGroupCode: null,
        overridden: false,
        reason: null
      }],
      createdAt: registrationOpensAt
    }).rows[0]?.suggestedGroupCode, 'GROUP_A');
  });

  it('validates a versioned knockout bracket with explicit byes and future-round sources', () => {
    assert.equal(CompetitionStageCodeSchema.parse('ROUND_OF_128'), 'ROUND_OF_128');
    assert.deepEqual(GenerateCupBracketProposalRequestSchema.parse({
      expectedCompetitionVersion: 3,
      randomSeed: 20261003
    }), { expectedCompetitionVersion: 3, randomSeed: 20261003 });
    assert.deepEqual(ConfirmCupBracketProposalRequestSchema.parse({
      proposalId: registrationId,
      expectedCompetitionVersion: 3
    }), { proposalId: registrationId, expectedCompetitionVersion: 3 });

    const proposal = CupBracketProposalSchema.parse({
      id: registrationId,
      competitionId,
      version: 1,
      status: 'DRAFT',
      algorithmVersion: 'cup-bracket-v1',
      randomSeed: 20261003,
      bracketSize: 4,
      rounds: [{
        roundNumber: 1,
        stageCode: 'SEMI_FINAL',
        displayName: '半决赛',
        pairings: [{
          id: userId,
          pairingNumber: 1,
          homeParticipantId: entryId,
          awayParticipantId: null,
          homeSourcePairingId: null,
          awaySourcePairingId: null,
          byeParticipantId: entryId,
          matchId: null,
          winnerParticipantId: null
        }]
      }, {
        roundNumber: 2,
        stageCode: 'FINAL',
        displayName: '决赛',
        pairings: [{
          id: competitionId,
          pairingNumber: 1,
          homeParticipantId: null,
          awayParticipantId: null,
          homeSourcePairingId: userId,
          awaySourcePairingId: registrationId,
          byeParticipantId: null,
          matchId: null,
          winnerParticipantId: null
        }]
      }],
      createdAt: registrationOpensAt
    });
    assert.equal(proposal.rounds[0]?.pairings[0]?.byeParticipantId, entryId);
    assert.equal(proposal.rounds[1]?.pairings[0]?.homeSourcePairingId, userId);
  });

  it('exposes a Chinese-ready bracket read model with current round and official score', () => {
    const view = CupBracketViewSchema.parse({
      competitionId,
      proposalId: registrationId,
      proposalVersion: 2,
      proposalStatus: 'CONFIRMED',
      bracketSize: 4,
      currentRoundNumber: 1,
      rounds: [{
        stageId: userId,
        roundNumber: 1,
        stageCode: 'SEMI_FINAL',
        displayName: '半决赛',
        status: 'PUBLISHED',
        pairings: [{
          id: entryId,
          pairingNumber: 1,
          homeParticipant: { id: userId, displayName: '上海海港' },
          awayParticipant: { id: registrationId, displayName: '北京国安' },
          winnerParticipant: { id: userId, displayName: '上海海港' },
          isBye: false,
          match: {
            id: competitionId,
            status: 'CONFIRMED',
            homeScore: 2,
            awayScore: 1
          }
        }]
      }]
    });
    assert.equal(view.rounds[0]?.pairings[0]?.homeParticipant?.displayName, '上海海港');
    assert.equal(view.proposalStatus, 'CONFIRMED');
  });

  it('exposes a season cup card with format and group configuration', () => {
    const cup = SeasonCupSummarySchema.parse({
      id: competitionId,
      seasonId: entryId,
      name: 'S3 足总杯',
      description: '赛季杯赛',
      competitionType: 'GROUP_KNOCKOUT_CUP',
      format: 'GROUP_KNOCKOUT',
      status: 'REGISTRATION_OPEN',
      registrationOpensAt,
      registrationClosesAt,
      startsAt,
      endsAt,
      participantLimit: 32,
      participantCount: 12,
      targetGroupSize: 4,
      qualifiersPerGroup: 2,
      version: 1
    });
    assert.equal(cup.participantCount, 12);
  });
});
