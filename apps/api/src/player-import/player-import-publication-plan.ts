import { createHash, randomUUID } from 'node:crypto';
import { selectBestCard } from '../player-builds/player-build-selector.js';
import { buildPlayerCardSearchFields } from '../player-catalog/player-card-search-fields.js';
import { normalizeSearchText } from './record-normalizer.js';
import {
  publicationBuildKey,
  type BuildPublicationPlanInput,
  type PlayerImportPublicationPlan,
  type PreparedPublicationRecord,
  type PublicationAttributeRow,
  type PublicationBuildRow,
  type PublicationCardRow,
  type PublicationPackRow,
  type PublicationPlayerRow,
  type PublicationPlayerSourceRow,
  type PublicationSkillRow,
  type PublicationVersionRow
} from './player-import-publication.types.js';

function asDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
        .map(([key, entry]) => [key, stableValue(entry)])
    );
  }
  return value;
}

export function publicationSnapshotKey(records: readonly PreparedPublicationRecord[]): string {
  const snapshot = records.map((record) => ({
    id: record.id,
    diffType: record.diffType,
    changedFields: [...record.changedFields].sort(),
    targetPlayerId: record.targetPlayerId,
    value: stableValue(record.value)
  }));
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

function finalPlayer(
  existing: PublicationPlayerRow | undefined,
  record: PreparedPublicationRecord,
  id: string,
  releaseSequence: number,
  publishedAt: Date
): PublicationPlayerRow {
  const { value, changedFields, diffType } = record;
  const all = diffType === 'CREATE' || !existing;
  const field = <T>(name: string, next: T, previous: T): T => all || changedFields.has(name) ? next : previous;
  return {
    id,
    nameZh: field('playerNameZh', value.playerNameZh ?? null, existing?.nameZh ?? null),
    nameEn: field('playerNameEn', value.playerNameEn ?? null, existing?.nameEn ?? null),
    normalizedNameZh: field(
      'playerNameZh',
      value.playerNameZh ? normalizeSearchText(value.playerNameZh) : null,
      existing?.normalizedNameZh ?? null
    ),
    normalizedNameEn: field(
      'playerNameEn',
      value.playerNameEn ? normalizeSearchText(value.playerNameEn) : null,
      existing?.normalizedNameEn ?? null
    ),
    shortName: field('playerShortName', value.playerShortName ?? null, existing?.shortName ?? null),
    nationality: field('nationality', value.nationality ?? null, existing?.nationality ?? null),
    club: field('club', value.club ?? null, existing?.club ?? null),
    clubZh: field('clubZh', value.clubZh ?? null, existing?.clubZh ?? null),
    clubEn: field('clubEn', value.clubEn ?? null, existing?.clubEn ?? null),
    publishedAt,
    lastPublishedReleaseSequence: releaseSequence
  };
}

function finalPack(
  existing: PublicationPackRow | undefined,
  record: PreparedPublicationRecord,
  id: string,
  sourceId: string,
  releaseSequence: number,
  publishedAt: Date
): PublicationPackRow {
  const { value, changedFields, diffType } = record;
  const all = diffType === 'CREATE' || !existing;
  const field = <T>(name: string, next: T, previous: T): T => all || changedFields.has(name) ? next : previous;
  return {
    id,
    sourceId,
    externalId: value.packExternalId!,
    nameZh: field('packName', value.packName ?? null, existing?.nameZh ?? null),
    nameEn: existing?.nameEn ?? null,
    season: field('season', value.season ?? null, existing?.season ?? null),
    releaseDate: field('releaseDate', asDate(value.releaseDate), existing?.releaseDate ?? null),
    coverUrl: existing?.coverUrl ?? null,
    status: existing?.status ?? 'ACTIVE',
    publishedAt,
    lastPublishedReleaseSequence: releaseSequence
  };
}

function finalCard(
  existing: PublicationCardRow | undefined,
  record: PreparedPublicationRecord,
  id: string,
  sourceId: string,
  playerId: string,
  cardPackId: string | null,
  releaseSequence: number,
  publishedAt: Date
): PublicationCardRow {
  const { value, changedFields, diffType } = record;
  const all = diffType === 'CREATE' || !existing;
  const field = <T>(name: string, next: T, previous: T): T => all || changedFields.has(name) ? next : previous;
  return {
    id,
    sourceId,
    externalId: value.externalId,
    playerId,
    cardPackId,
    cardName: field('cardName', value.cardName, existing?.cardName ?? value.cardName),
    position: field('position', value.position, existing?.position ?? value.position),
    overallRating: field('overallRating', value.overallRating, existing?.overallRating ?? value.overallRating),
    cardType: field('cardType', value.cardType, existing?.cardType ?? value.cardType),
    playStyle: field('playStyle', value.playStyle ?? null, existing?.playStyle ?? null),
    status: field('status', value.status, existing?.status ?? value.status),
    imageUrl: field('imageUrl', value.imageUrl ?? null, existing?.imageUrl ?? null),
    sourceUpdatedAt: field('sourceUpdatedAt', asDate(value.sourceUpdatedAt), existing?.sourceUpdatedAt ?? null),
    publishedAt,
    lastPublishedReleaseSequence: releaseSequence
  };
}

function versionRow(
  id: string,
  card: PublicationCardRow,
  player: PublicationPlayerRow,
  pack: PublicationPackRow | undefined,
  attributesJson: unknown,
  skillsJson: readonly string[],
  releaseSequence: number,
  publishedAt: Date
): PublicationVersionRow {
  return {
    id,
    playerCardId: card.id,
    releaseSequence,
    playerId: player.id,
    playerNameZh: player.nameZh,
    playerNameEn: player.nameEn,
    normalizedNameZh: player.normalizedNameZh,
    normalizedNameEn: player.normalizedNameEn,
    playerShortName: player.shortName,
    nationality: player.nationality,
    club: player.club,
    cardPackId: pack?.id ?? null,
    packNameZh: pack?.nameZh ?? null,
    packNameEn: pack?.nameEn ?? null,
    ...buildPlayerCardSearchFields({
      cardName: card.cardName,
      packNameZh: pack?.nameZh ?? null,
      packNameEn: pack?.nameEn ?? null
    }),
    packSeason: pack?.season ?? null,
    packReleaseDate: pack?.releaseDate ?? null,
    packCoverUrl: pack?.coverUrl ?? null,
    cardName: card.cardName,
    position: card.position,
    overallRating: card.overallRating,
    cardType: card.cardType,
    playStyle: card.playStyle,
    status: card.status,
    imageUrl: card.imageUrl,
    sourceUpdatedAt: card.sourceUpdatedAt,
    skillsJson,
    attributesJson,
    publishedAt
  };
}

export function buildPlayerImportPublicationPlan(input: BuildPublicationPlanInput): PlayerImportPublicationPlan {
  const newId = input.newId ?? randomUUID;
  const playersById = new Map(input.state.playersById);
  const playerSourcesByExternalId = new Map(input.state.playerSourcesByExternalId);
  const packsByExternalId = new Map(input.state.packsByExternalId);
  const cardsByExternalId = new Map(input.state.cardsByExternalId);
  const attributesByCardId = new Map(input.state.attributesByCardId);
  const skillCodesByCardId = new Map(input.state.skillCodesByCardId);
  const skillsByCode = new Map(input.state.skillsByCode);
  const buildsByKey = new Map(input.state.buildsByKey);

  const players = new Map<string, PublicationPlayerRow>();
  const playerSources = new Map<string, PublicationPlayerSourceRow>();
  const packs = new Map<string, PublicationPackRow>();
  const cards = new Map<string, PublicationCardRow>();
  const attributes = new Map<string, PublicationAttributeRow>();
  const skills = new Map<string, PublicationSkillRow>();
  const cardSkills = new Map<string, { playerCardId: string; skillId: string }>();
  const builds = new Map<string, PublicationBuildRow>();
  const replaceSkillCardIds = new Set<string>();
  const affectedPlayerIds = new Set<string>();
  const versionCardIds: string[] = [];

  for (const record of input.records) {
    const { value, changedFields, diffType } = record;
    const existingCard = cardsByExternalId.get(value.externalId);
    const existingSource = value.playerExternalId
      ? playerSourcesByExternalId.get(value.playerExternalId)
      : undefined;
    const playerId = record.targetPlayerId ?? existingSource?.playerId ?? newId();
    const player = finalPlayer(
      playersById.get(playerId), record, playerId, input.releaseSequence, input.publishedAt
    );
    playersById.set(playerId, player);
    players.set(playerId, player);

    if (value.playerExternalId) {
      const source: PublicationPlayerSourceRow = {
        id: existingSource?.id ?? newId(),
        sourceId: input.sourceId,
        externalId: value.playerExternalId,
        playerId,
        sourceUpdatedAt: asDate(value.sourceUpdatedAt)
      };
      playerSourcesByExternalId.set(value.playerExternalId, source);
      playerSources.set(value.playerExternalId, source);
    }

    let cardPackId = existingCard?.cardPackId ?? null;
    if (value.packExternalId) {
      const existingPack = packsByExternalId.get(value.packExternalId);
      const pack = finalPack(
        existingPack, record, existingPack?.id ?? newId(), input.sourceId,
        input.releaseSequence, input.publishedAt
      );
      packsByExternalId.set(value.packExternalId, pack);
      packs.set(value.packExternalId, pack);
      cardPackId = pack.id;
    } else if (diffType === 'CREATE' || changedFields.has('packExternalId')) {
      cardPackId = null;
    }

    const card = finalCard(
      existingCard,
      record,
      existingCard?.id ?? newId(),
      input.sourceId,
      playerId,
      cardPackId,
      input.releaseSequence,
      input.publishedAt
    );
    cardsByExternalId.set(value.externalId, card);
    cards.set(value.externalId, card);
    versionCardIds.push(card.id);

    if (diffType === 'CREATE' || changedFields.has('attributes')) {
      const attribute: PublicationAttributeRow = {
        id: newId(),
        playerCardId: card.id,
        attributesJson: value.attributes
      };
      attributesByCardId.set(card.id, value.attributes);
      attributes.set(card.id, attribute);
    }

    if (diffType === 'CREATE' || changedFields.has('skills')) {
      replaceSkillCardIds.add(card.id);
      const codes: string[] = [];
      const seen = new Set<string>();
      for (const rawName of value.skills) {
        const displayName = rawName.trim().replace(/\s+/g, ' ');
        const code = normalizeSearchText(displayName);
        if (seen.has(code)) continue;
        seen.add(code);
        codes.push(code);
        const existingSkill = skillsByCode.get(code);
        const skill: PublicationSkillRow = {
          id: existingSkill?.id ?? newId(),
          code,
          nameZh: existingSkill?.nameZh ?? null,
          nameEn: displayName
        };
        skillsByCode.set(code, skill);
        skills.set(code, skill);
        cardSkills.set(`${card.id}\u0000${skill.id}`, { playerCardId: card.id, skillId: skill.id });
      }
      skillCodesByCardId.set(card.id, codes);
    }

    if (
      value.autoBuildAllocation !== undefined
      && value.autoBuildMaxOverall !== undefined
      && value.algorithmVersion !== undefined
    ) {
      const key = publicationBuildKey(card.id, value.algorithmVersion);
      const existingBuild = buildsByKey.get(key);
      const build: PublicationBuildRow = {
        id: existingBuild?.id ?? newId(),
        playerCardId: card.id,
        algorithmVersion: value.algorithmVersion,
        allocationJson: value.autoBuildAllocation,
        maxOverall: value.autoBuildMaxOverall,
        dtRating: value.dtRating ?? null,
        calculatedAt: input.publishedAt
      };
      buildsByKey.set(key, build);
      builds.set(key, build);
      affectedPlayerIds.add(playerId);
    }
  }

  const cardsById = new Map([...cardsByExternalId.values()].map((card) => [card.id, card]));
  const packsById = new Map([...packsByExternalId.values()].map((pack) => [pack.id, pack]));
  const plannedBuilds = [...builds.values()];
  const bestCards = [...affectedPlayerIds].flatMap((playerId) => {
    const plannedCandidates = plannedBuilds
      .map((build) => ({ build, card: cardsById.get(build.playerCardId) }))
      .filter(({ card }) => card?.playerId === playerId)
      .map(({ build, card }) => ({
        autoBuildId: build.id,
        playerCardId: build.playerCardId,
        externalId: card!.externalId,
        algorithmVersion: build.algorithmVersion,
        maxOverall: build.maxOverall,
        releaseDate: card!.cardPackId ? packsById.get(card!.cardPackId)?.releaseDate ?? null : null
      }));
    const plannedIds = new Set(plannedCandidates.map(({ autoBuildId }) => autoBuildId));
    const candidates = [
      ...(input.state.bestCardCandidatesByPlayerId.get(playerId) ?? [])
        .filter(({ autoBuildId }) => !plannedIds.has(autoBuildId)),
      ...plannedCandidates
    ];
    const selection = selectBestCard(candidates);
    return selection ? [{
      id: newId(),
      footballPlayerId: playerId,
      playerCardId: selection.playerCardId,
      autoBuildId: selection.autoBuildId,
      selectionReason: selection.selectionReason,
      selectedAt: input.publishedAt
    }] : [];
  });

  const uniqueVersionCardIds = [...new Set(versionCardIds)];
  const versions = uniqueVersionCardIds.map((cardId) => {
    const card = cardsById.get(cardId)!;
    const player = playersById.get(card.playerId)!;
    const pack = card.cardPackId ? packsById.get(card.cardPackId) : undefined;
    return versionRow(
      newId(),
      card,
      player,
      pack,
      attributesByCardId.get(card.id) ?? {},
      skillCodesByCardId.get(card.id) ?? [],
      input.releaseSequence,
      input.publishedAt
    );
  });

  return {
    players: [...players.values()],
    playerSources: [...playerSources.values()],
    packs: [...packs.values()],
    cards: [...cards.values()],
    attributes: [...attributes.values()],
    skills: [...skills.values()],
    replaceSkillCardIds: [...replaceSkillCardIds],
    cardSkills: [...cardSkills.values()],
    builds: plannedBuilds,
    bestCards,
    versions,
    affectedPlayerIds: [...affectedPlayerIds]
  };
}
