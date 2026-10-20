import type { NormalizedPlayerCardRecord } from '@efm/contracts';
import {
  buildPlayerImportPublicationPlan,
  publicationSnapshotKey
} from './player-import-publication-plan.js';
import type {
  PlayerImportPublicationState,
  PreparedPublicationRecord
} from './player-import-publication.types.js';

describe('player import publication plan', () => {
  const publishedAt = new Date('2026-10-19T12:00:00.000Z');

  function value(externalId: string, overrides: Partial<NormalizedPlayerCardRecord> = {}): NormalizedPlayerCardRecord {
    return {
      externalId,
      playerExternalId: `player-${externalId}`,
      playerNameZh: `球员 ${externalId}`,
      playerNameEn: `Player ${externalId}`,
      playerShortName: `P ${externalId}`,
      nationality: 'Argentina',
      club: 'Test FC',
      clubZh: '测试足球俱乐部',
      clubEn: 'Test FC',
      cardName: `Card ${externalId}`,
      position: 'CMF',
      overallRating: 95,
      cardType: 'FEATURED',
      playStyle: 'Orchestrator',
      status: 'ACTIVE',
      imageUrl: `https://example.com/${externalId}.png`,
      packExternalId: `pack-${externalId}`,
      packName: `Pack ${externalId}`,
      season: '2026',
      releaseDate: '2026-10-01',
      sourceUpdatedAt: '2026-10-19T10:00:00.000Z',
      skills: [`Passing ${externalId}`],
      attributes: { passing: 96 },
      ...overrides
    };
  }

  function record(
    id: string,
    normalized: NormalizedPlayerCardRecord,
    options: Partial<PreparedPublicationRecord> = {}
  ): PreparedPublicationRecord {
    return {
      id,
      diffType: 'CREATE',
      changedFields: new Set(),
      targetPlayerId: null,
      value: normalized,
      ...options
    };
  }

  function emptyState(): PlayerImportPublicationState {
    return {
      playersById: new Map(),
      playerSourcesByExternalId: new Map(),
      packsByExternalId: new Map(),
      cardsByExternalId: new Map(),
      attributesByCardId: new Map(),
      skillCodesByCardId: new Map(),
      skillsByCode: new Map(),
      buildsByKey: new Map(),
      bestCardCandidatesByPlayerId: new Map()
    };
  }

  function existingState(): PlayerImportPublicationState {
    const state = emptyState();
    state.playersById.set('player-existing', {
      id: 'player-existing',
      nameZh: '旧球员',
      nameEn: 'Old Player',
      normalizedNameZh: '旧球员',
      normalizedNameEn: 'old player',
      shortName: 'Old',
      nationality: 'Spain',
      club: 'Old FC',
      clubZh: '旧俱乐部',
      clubEn: 'Old FC',
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastPublishedReleaseSequence: 1
    });
    state.playerSourcesByExternalId.set('player-update', {
      id: 'source-existing',
      sourceId: 'source-1',
      externalId: 'player-update',
      playerId: 'player-existing',
      sourceUpdatedAt: new Date('2026-01-01T00:00:00.000Z')
    });
    state.packsByExternalId.set('pack-update', {
      id: 'pack-existing',
      sourceId: 'source-1',
      externalId: 'pack-update',
      nameZh: '旧卡包',
      nameEn: null,
      season: '2025',
      releaseDate: new Date('2025-01-01T00:00:00.000Z'),
      coverUrl: null,
      status: 'ACTIVE',
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastPublishedReleaseSequence: 1
    });
    state.cardsByExternalId.set('update', {
      id: 'card-existing',
      sourceId: 'source-1',
      externalId: 'update',
      playerId: 'player-existing',
      cardPackId: 'pack-existing',
      cardName: 'Old Card',
      position: 'DMF',
      overallRating: 91,
      cardType: 'FEATURED',
      playStyle: 'Anchor Man',
      status: 'ACTIVE',
      imageUrl: null,
      sourceUpdatedAt: new Date('2026-01-01T00:00:00.000Z'),
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastPublishedReleaseSequence: 1
    });
    state.attributesByCardId.set('card-existing', { passing: 80 });
    state.skillCodesByCardId.set('card-existing', ['old skill']);
    state.skillsByCode.set('old skill', {
      id: 'skill-existing',
      code: 'old skill',
      nameZh: null,
      nameEn: 'Old Skill'
    });
    return state;
  }

  function build(
    records: readonly PreparedPublicationRecord[],
    state = emptyState()
  ) {
    let next = 0;
    return buildPlayerImportPublicationPlan({
      sourceId: 'source-1',
      records,
      state,
      releaseSequence: 7,
      publishedAt,
      newId: () => `generated-${++next}`
    });
  }

  it('creates one complete write graph and version snapshot', () => {
    const plan = build([record('record-create', value('create', {
      skills: ['One Touch Pass'],
      autoBuildAllocation: { passing: 8 },
      autoBuildMaxOverall: 98,
      dtRating: 97,
      algorithmVersion: 'pesdata-auto-v1'
    }))]);

    expect(plan.players).toHaveLength(1);
    expect(plan.playerSources).toHaveLength(1);
    expect(plan.packs).toHaveLength(1);
    expect(plan.cards).toHaveLength(1);
    expect(plan.attributes).toHaveLength(1);
    expect(plan.skills).toHaveLength(1);
    expect(plan.cardSkills).toHaveLength(1);
    expect(plan.builds).toHaveLength(1);
    expect(plan.bestCards).toHaveLength(1);
    expect(plan.versions).toHaveLength(1);

    const [player] = plan.players;
    const [pack] = plan.packs;
    const [card] = plan.cards;
    const [version] = plan.versions;
    expect(plan.playerSources[0]).toMatchObject({ playerId: player?.id, externalId: 'player-create' });
    expect(card).toMatchObject({ playerId: player?.id, cardPackId: pack?.id, externalId: 'create' });
    expect(plan.cardSkills[0]).toMatchObject({ playerCardId: card?.id, skillId: plan.skills[0]?.id });
    expect(plan.builds[0]).toMatchObject({ playerCardId: card?.id, maxOverall: 98, dtRating: 97 });
    expect(plan.bestCards[0]).toMatchObject({ footballPlayerId: player?.id, playerCardId: card?.id });
    expect(version).toMatchObject({
      playerCardId: card?.id,
      playerId: player?.id,
      cardPackId: pack?.id,
      playerNameEn: 'Player create',
      packNameZh: 'Pack create',
      cardName: 'Card create',
      attributesJson: { passing: 96 },
      skillsJson: ['one touch pass'],
      releaseSequence: 7,
      publishedAt
    });
  });

  it('overlays only reviewed update fields on existing rows', () => {
    const plan = build([record('record-update', value('update', {
      playerExternalId: 'player-update',
      playerNameEn: 'Unreviewed Player Name',
      cardName: 'Unreviewed Card Name',
      overallRating: 99,
      packExternalId: 'pack-update'
    }), {
      diffType: 'UPDATE',
      changedFields: new Set(['overallRating']),
      targetPlayerId: 'player-existing'
    })], existingState());

    expect(plan.players[0]).toMatchObject({ id: 'player-existing', nameEn: 'Old Player', club: 'Old FC' });
    expect(plan.cards[0]).toMatchObject({
      id: 'card-existing',
      cardName: 'Old Card',
      position: 'DMF',
      overallRating: 99,
      cardPackId: 'pack-existing'
    });
    expect(plan.attributes).toHaveLength(0);
    expect(plan.replaceSkillCardIds).toEqual([]);
    expect(plan.versions[0]).toMatchObject({ cardName: 'Old Card', overallRating: 99, playerNameEn: 'Old Player' });
  });

  it('reuses one player and pack id for repeated source identities', () => {
    const shared = {
      playerExternalId: 'shared-player',
      packExternalId: 'shared-pack',
      packName: 'Shared Pack'
    };
    const plan = build([
      record('record-a', value('a', shared)),
      record('record-b', value('b', shared))
    ]);

    expect(plan.players).toHaveLength(1);
    expect(plan.playerSources).toHaveLength(1);
    expect(plan.packs).toHaveLength(1);
    expect(plan.cards).toHaveLength(2);
    expect(new Set(plan.cards.map(({ playerId }) => playerId))).toEqual(new Set([plan.players[0]?.id]));
    expect(new Set(plan.cards.map(({ cardPackId }) => cardPackId))).toEqual(new Set([plan.packs[0]?.id]));
  });

  it('applies repeated identity changes in source row order with the last reviewed value winning', () => {
    const plan = build([
      record('record-a', value('a', {
        playerExternalId: 'shared-player', packExternalId: 'shared-pack', club: 'First FC', packName: 'First Pack'
      })),
      record('record-b', value('b', {
        playerExternalId: 'shared-player', packExternalId: 'shared-pack', club: 'Last FC', packName: 'Last Pack'
      }))
    ]);

    expect(plan.players).toHaveLength(1);
    expect(plan.players[0]?.club).toBe('Last FC');
    expect(plan.packs).toHaveLength(1);
    expect(plan.packs[0]?.nameZh).toBe('Last Pack');
    expect(plan.versions.map(({ club }) => club)).toEqual(['Last FC', 'Last FC']);
  });

  it('deduplicates skills and emits an empty replacement for cleared skills', () => {
    const created = build([record('record-skills', value('skills', {
      skills: ['One Touch Pass', ' one   touch pass ', 'Through Passing']
    }))]);
    expect(created.skills.map(({ code }) => code)).toEqual(['one touch pass', 'through passing']);
    expect(created.cardSkills).toHaveLength(2);

    const cleared = build([record('record-update', value('update', {
      playerExternalId: 'player-update', packExternalId: 'pack-update', skills: []
    }), {
      diffType: 'UPDATE',
      changedFields: new Set(['skills']),
      targetPlayerId: 'player-existing'
    })], existingState());
    expect(cleared.replaceSkillCardIds).toEqual(['card-existing']);
    expect(cleared.cardSkills).toEqual([]);
    expect(cleared.versions[0]?.skillsJson).toEqual([]);
  });

  it('sets cardPackId to null when packExternalId is reviewed away', () => {
    const plan = build([record('record-update', value('update', {
      playerExternalId: 'player-update',
      packExternalId: undefined,
      packName: undefined,
      season: undefined,
      releaseDate: undefined
    }), {
      diffType: 'UPDATE',
      changedFields: new Set(['packExternalId']),
      targetPlayerId: 'player-existing'
    })], existingState());

    expect(plan.cards[0]?.cardPackId).toBeNull();
    expect(plan.versions[0]).toMatchObject({
      cardPackId: null,
      packNameZh: null,
      packSeason: null,
      packReleaseDate: null
    });
  });

  it('selects one best card from existing and planned builds per affected player', () => {
    const state = existingState();
    state.bestCardCandidatesByPlayerId.set('player-existing', [{
      autoBuildId: 'build-old',
      playerCardId: 'card-old',
      externalId: 'old-card',
      algorithmVersion: 'pesdata-auto-v1',
      maxOverall: 97,
      releaseDate: new Date('2026-01-01T00:00:00.000Z')
    }]);
    const plan = build([record('record-update', value('update', {
      playerExternalId: 'player-update',
      packExternalId: 'pack-update',
      autoBuildAllocation: { passing: 10 },
      autoBuildMaxOverall: 99,
      algorithmVersion: 'pesdata-auto-v1'
    }), {
      diffType: 'UPDATE',
      changedFields: new Set(['autoBuildAllocation', 'autoBuildMaxOverall', 'algorithmVersion']),
      targetPlayerId: 'player-existing'
    })], state);

    expect(plan.bestCards).toHaveLength(1);
    expect(plan.bestCards[0]).toMatchObject({
      footballPlayerId: 'player-existing',
      playerCardId: 'card-existing',
      autoBuildId: plan.builds[0]?.id
    });
    expect(plan.bestCards[0]?.selectionReason).toMatchObject({
      candidateCount: 2,
      winner: { externalId: 'update', maxOverall: 99 }
    });
  });

  it('changes the snapshot key when record identity or reviewed content changes', () => {
    const original = record('record-1', value('snapshot'), {
      changedFields: new Set(['overallRating'])
    });
    const sameWithDifferentSetOrder = {
      ...original,
      changedFields: new Set(['overallRating'])
    };
    const changed = {
      ...original,
      value: value('snapshot', { overallRating: 96 })
    };

    expect(publicationSnapshotKey([original])).toBe(publicationSnapshotKey([sameWithDifferentSetOrder]));
    expect(publicationSnapshotKey([original])).not.toBe(publicationSnapshotKey([{ ...original, id: 'record-2' }]));
    expect(publicationSnapshotKey([original])).not.toBe(publicationSnapshotKey([changed]));
  });
});
