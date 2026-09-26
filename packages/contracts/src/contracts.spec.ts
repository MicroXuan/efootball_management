import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CompetitionDetailSchema,
  CompetitionFormatSchema,
  CompetitionParticipantTypeSchema,
  CreateCompetitionRequestSchema,
  CreateLeagueRequestSchema,
  CreateLeagueSeasonRequestSchema,
  CreateTeamProfileRequestSchema,
  GameAccountInputSchema,
  IdempotencyKeySchema,
  MatchResultVersionResponseSchema,
  NormalizedPlayerCardRecordSchema,
  PlayerSearchQuerySchema,
  ResourceIdSchema,
  StandingsSnapshotResponseSchema,
  SubmitMatchResultRequestSchema,
  UpdateLeagueRequestSchema,
  UpdateLeagueSeasonRequestSchema,
  UpdateTeamProfileRequestSchema,
  WechatLoginRequestSchema
} from './index.js';

describe('shared API contracts', () => {
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
      defaultPlatform: 'MOBILE',
      defaultServerRegion: 'GLOBAL'
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
      defaultPlatform: 'MOBILE' as const,
      defaultServerRegion: 'GLOBAL'
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
      defaultPlatform: 'MOBILE',
      defaultServerRegion: 'GLOBAL'
    }).logoUrl, null);
    assert.equal(CreateTeamProfileRequestSchema.parse({
      name: '上海申花',
      shortName: '申花',
      logoUrl: null,
      defaultGameAccountId: gameAccountId
    }).logoUrl, null);
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
