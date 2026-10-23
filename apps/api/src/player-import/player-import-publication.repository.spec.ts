import type { NormalizedPlayerCardRecord } from '@efm/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import {
  loadPlayerImportPublicationState,
  writePlayerImportPublicationPlan
} from './player-import-publication.repository.js';
import type {
  PlayerImportPublicationPlan,
  PreparedPublicationRecord,
  PublicationSkillRow
} from './player-import-publication.types.js';

describe('player import publication repository', () => {
  const now = new Date('2026-10-19T12:00:00.000Z');

  function normalized(index: number): NormalizedPlayerCardRecord {
    return {
      externalId: `card-${index}`,
      playerExternalId: `player-${index}`,
      playerNameEn: `Player ${index}`,
      cardName: `Card ${index}`,
      position: 'CMF',
      overallRating: 95,
      cardType: 'FEATURED',
      status: 'ACTIVE',
      packExternalId: `pack-${index}`,
      packName: `Pack ${index}`,
      skills: [`Skill ${index}`],
      attributes: { passing: 90 }
    };
  }

  function records(count: number): PreparedPublicationRecord[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `record-${index}`,
      diffType: 'CREATE' as const,
      changedFields: new Set<string>(),
      targetPlayerId: null,
      value: normalized(index)
    }));
  }

  function readClient(log: string[]) {
    const findMany = (name: string, result: unknown[] = []) => async () => {
      log.push(name);
      return result;
    };
    return {
      footballPlayerSource: { findMany: findMany('footballPlayerSource.findMany') },
      footballPlayer: { findMany: findMany('footballPlayer.findMany') },
      cardPack: { findMany: findMany('cardPack.findMany') },
      playerCard: { findMany: findMany('playerCard.findMany') },
      skill: { findMany: findMany('skill.findMany') },
      playerCardAutoBuild: { findMany: findMany('playerCardAutoBuild.findMany') }
    } as never;
  }

  function plan(count: number): PlayerImportPublicationPlan {
    const players = Array.from({ length: count }, (_, index) => ({
      id: `player-${index}`,
      nameZh: null,
      nameEn: `Player ${index}`,
      normalizedNameZh: null,
      normalizedNameEn: `player ${index}`,
      shortName: null,
      nationality: null,
      club: null,
      clubZh: null,
      clubEn: null,
      publishedAt: now,
      lastPublishedReleaseSequence: 3
    }));
    const playerSources = players.map((player, index) => ({
      id: `source-link-${index}`,
      playerId: player.id,
      sourceId: 'source-1',
      externalId: `player-${index}`,
      sourceUpdatedAt: null
    }));
    const packs = players.map((_, index) => ({
      id: `pack-${index}`,
      sourceId: 'source-1',
      externalId: `pack-${index}`,
      nameZh: `Pack ${index}`,
      nameEn: null,
      season: null,
      releaseDate: null,
      coverUrl: null,
      status: 'ACTIVE' as const,
      publishedAt: now,
      lastPublishedReleaseSequence: 3
    }));
    const cards = players.map((player, index) => ({
      id: `card-${index}`,
      sourceId: 'source-1',
      externalId: `card-${index}`,
      playerId: player.id,
      cardPackId: packs[index]!.id,
      cardName: `Card ${index}`,
      position: 'CMF' as const,
      overallRating: 95,
      cardType: 'FEATURED' as const,
      playStyle: null,
      status: 'ACTIVE' as const,
      imageUrl: null,
      sourceUpdatedAt: null,
      publishedAt: now,
      lastPublishedReleaseSequence: 3
    }));
    const skills = players.map((_, index) => ({
      id: `skill-${index}`,
      code: `skill-${index}`,
      nameZh: null,
      nameEn: `Skill ${index}`
    }));
    const builds = cards.map((card, index) => ({
      id: `build-${index}`,
      playerCardId: card.id,
      algorithmVersion: 'v1',
      allocationJson: { passing: 8 },
      maxOverall: 98,
      dtRating: null,
      calculatedAt: now
    }));
    return {
      players,
      playerSources,
      packs,
      cards,
      attributes: cards.map((card, index) => ({
        id: `attribute-${index}`, playerCardId: card.id, attributesJson: { passing: 90 }
      })),
      skills,
      replaceSkillCardIds: cards.map(({ id }) => id),
      cardSkills: cards.map((card, index) => ({ playerCardId: card.id, skillId: skills[index]!.id })),
      builds,
      bestCards: players.map((player, index) => ({
        id: `best-${index}`,
        footballPlayerId: player.id,
        playerCardId: cards[index]!.id,
        autoBuildId: builds[index]!.id,
        selectionReason: {
          algorithmVersion: 'v1',
          ordering: ['maxOverall:desc', 'releaseDate:desc:nulls-last', 'externalId:asc'],
          candidateCount: 1,
          winner: { externalId: cards[index]!.externalId, maxOverall: 98, releaseDate: null }
        },
        selectedAt: now
      })),
      versions: cards.map((card, index) => ({
        id: `version-${index}`,
        playerCardId: card.id,
        releaseSequence: 3,
        playerId: players[index]!.id,
        playerNameZh: null,
        playerNameEn: players[index]!.nameEn,
        normalizedNameZh: null,
        normalizedNameEn: players[index]!.normalizedNameEn,
        playerShortName: null,
        nationality: null,
        club: null,
        cardPackId: packs[index]!.id,
        packNameZh: packs[index]!.nameZh,
        packNameEn: null,
        normalizedPackNameZh: packs[index]!.nameZh?.toLowerCase() ?? null,
        normalizedPackNameEn: null,
        packSeason: null,
        packReleaseDate: null,
        packCoverUrl: null,
        cardName: card.cardName,
        normalizedCardName: card.cardName.toLowerCase(),
        position: card.position,
        overallRating: card.overallRating,
        cardType: card.cardType,
        playStyle: null,
        status: card.status,
        imageUrl: null,
        sourceUpdatedAt: null,
        skillsJson: [skills[index]!.code],
        attributesJson: { passing: 90 },
        publishedAt: now
      })),
      affectedPlayerIds: players.map(({ id }) => id)
    };
  }

  function writeClient(log: string[], failOn?: string) {
    return {
      $executeRaw: async (query: Prisma.Sql) => {
        const sql = query.strings.join('?');
        const table = /INSERT INTO\s+([a-z_]+)/i.exec(sql)?.[1] ?? 'executeRaw';
        const operation = `upsert:${table}`;
        log.push(operation);
        if (failOn === operation) throw new Error(`failed ${operation}`);
        return 1;
      },
      playerCardSkill: {
        deleteMany: async () => { log.push('playerCardSkill.deleteMany'); return { count: 1 }; },
        createMany: async () => { log.push('playerCardSkill.createMany'); return { count: 1 }; }
      },
      playerCardVersion: {
        createMany: async () => { log.push('playerCardVersion.createMany'); return { count: 1 }; }
      }
    } as never;
  }

  it('prefetches ten and fifty cards with the same database operation categories', async () => {
    const ten: string[] = [];
    const fifty: string[] = [];

    await loadPlayerImportPublicationState(readClient(ten), { sourceId: 'source-1', records: records(10) });
    await loadPlayerImportPublicationState(readClient(fifty), { sourceId: 'source-1', records: records(50) });

    expect(ten).toEqual(fifty);
    expect(ten).toEqual([
      'footballPlayerSource.findMany',
      'cardPack.findMany',
      'playerCard.findMany',
      'skill.findMany'
    ]);
  });

  it('writes ten and fifty cards with the same operation categories below the chunk boundary', async () => {
    const ten: string[] = [];
    const fifty: string[] = [];

    await writePlayerImportPublicationPlan(writeClient(ten), plan(10));
    await writePlayerImportPublicationPlan(writeClient(fifty), plan(50));

    expect(ten).toEqual(fifty);
    expect(ten).toEqual([
      'upsert:football_players',
      'upsert:football_player_sources',
      'upsert:card_packs',
      'upsert:player_cards',
      'upsert:player_card_attributes',
      'upsert:skills',
      'playerCardSkill.deleteMany',
      'playerCardSkill.createMany',
      'upsert:player_card_auto_builds',
      'upsert:football_player_best_cards',
      'playerCardVersion.createMany'
    ]);
  });

  it('adds exactly one operation per additional five-hundred-row chunk', async () => {
    const fiveHundred: string[] = [];
    const fiveHundredOne: string[] = [];
    const base = plan(0);
    const skills = (count: number): PublicationSkillRow[] => Array.from({ length: count }, (_, index) => ({
      id: `skill-${index}`, code: `skill-${index}`, nameZh: null, nameEn: `Skill ${index}`
    }));

    await writePlayerImportPublicationPlan(writeClient(fiveHundred), { ...base, skills: skills(500) });
    await writePlayerImportPublicationPlan(writeClient(fiveHundredOne), { ...base, skills: skills(501) });

    expect(fiveHundred).toEqual(['upsert:skills']);
    expect(fiveHundredOne).toEqual(['upsert:skills', 'upsert:skills']);
  });

  it('deletes all reviewed skill links before inserting replacements', async () => {
    const operations: string[] = [];

    await writePlayerImportPublicationPlan(writeClient(operations), plan(10));

    expect(operations.indexOf('playerCardSkill.deleteMany'))
      .toBeLessThan(operations.indexOf('playerCardSkill.createMany'));
  });

  it('parameterizes quotes and unicode in bulk values', async () => {
    const queries: Prisma.Sql[] = [];
    const client = {
      $executeRaw: async (query: Prisma.Sql) => { queries.push(query); return 1; },
      playerCardSkill: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) },
      playerCardVersion: { createMany: async () => ({ count: 0 }) }
    } as never;
    const dangerous = `O'Reilly 球员`;
    const value = plan(0);
    value.players = [{
      id: 'player-special', nameZh: dangerous, nameEn: dangerous,
      normalizedNameZh: dangerous, normalizedNameEn: dangerous, shortName: null,
      nationality: null, club: null, clubZh: null, clubEn: null,
      publishedAt: now, lastPublishedReleaseSequence: 3
    }];

    await writePlayerImportPublicationPlan(client, value);

    expect(queries).toHaveLength(1);
    expect(queries[0]!.strings.join('')).not.toContain(dangerous);
    expect(queries[0]!.values).toContain(dangerous);
  });

  it('stops immediately when a bulk phase fails', async () => {
    const operations: string[] = [];

    await expect(writePlayerImportPublicationPlan(
      writeClient(operations, 'upsert:player_cards'),
      plan(10)
    )).rejects.toThrow('failed upsert:player_cards');

    expect(operations.at(-1)).toBe('upsert:player_cards');
    expect(operations).not.toContain('playerCardSkill.deleteMany');
  });
});
