import { Prisma } from '../generated/prisma/client.js';
import type { BestCardCandidate } from '../player-builds/player-build-selector.js';
import { normalizeSearchText } from './record-normalizer.js';
import {
  publicationBuildKey,
  type PlayerImportPublicationPlan,
  type PlayerImportPublicationState,
  type PreparedPublicationRecord,
  type PublicationPackRow,
  type PublicationPlayerRow,
  type PublicationSkillRow
} from './player-import-publication.types.js';

type Transaction = Prisma.TransactionClient;

export const PUBLICATION_SQL_CHUNK_SIZE = 500;

function chunks<T>(rows: readonly T[]): T[][] {
  const values: T[][] = [];
  for (let index = 0; index < rows.length; index += PUBLICATION_SQL_CHUNK_SIZE) {
    values.push(rows.slice(index, index + PUBLICATION_SQL_CHUNK_SIZE));
  }
  return values;
}

function playerRow(player: {
  id: string;
  nameZh: string | null;
  nameEn: string | null;
  normalizedNameZh: string | null;
  normalizedNameEn: string | null;
  shortName: string | null;
  nationality: string | null;
  club: string | null;
  clubZh: string | null;
  clubEn: string | null;
  publishedAt: Date | null;
  lastPublishedReleaseSequence: number | null;
}): PublicationPlayerRow {
  return {
    ...player,
    publishedAt: player.publishedAt ?? new Date(0),
    lastPublishedReleaseSequence: player.lastPublishedReleaseSequence ?? 0
  };
}

function packRow(pack: {
  id: string;
  sourceId: string;
  externalId: string;
  nameZh: string | null;
  nameEn: string | null;
  season: string | null;
  releaseDate: Date | null;
  coverUrl: string | null;
  status: PublicationPackRow['status'];
  publishedAt: Date | null;
  lastPublishedReleaseSequence: number | null;
}): PublicationPackRow {
  return {
    ...pack,
    publishedAt: pack.publishedAt ?? new Date(0),
    lastPublishedReleaseSequence: pack.lastPublishedReleaseSequence ?? 0
  };
}

export async function loadPlayerImportPublicationState(
  tx: Transaction,
  input: { sourceId: string; records: readonly PreparedPublicationRecord[] }
): Promise<PlayerImportPublicationState> {
  const playerExternalIds = [...new Set(input.records.flatMap(({ value }) =>
    value.playerExternalId ? [value.playerExternalId] : []))];
  const packExternalIds = [...new Set(input.records.flatMap(({ value }) =>
    value.packExternalId ? [value.packExternalId] : []))];
  const cardExternalIds = [...new Set(input.records.map(({ value }) => value.externalId))];
  const targetPlayerIds = [...new Set(input.records.flatMap(({ targetPlayerId }) =>
    targetPlayerId ? [targetPlayerId] : []))];
  const skillCodes = [...new Set(input.records.flatMap(({ value }) =>
    value.skills.map(normalizeSearchText)))];

  const playerSources = playerExternalIds.length > 0
    ? await tx.footballPlayerSource.findMany({
      where: { sourceId: input.sourceId, externalId: { in: playerExternalIds } },
      include: { player: true }
    })
    : [];
  const packs = packExternalIds.length > 0
    ? await tx.cardPack.findMany({
      where: { sourceId: input.sourceId, externalId: { in: packExternalIds } }
    })
    : [];
  const cards = cardExternalIds.length > 0
    ? await tx.playerCard.findMany({
      where: { sourceId: input.sourceId, externalId: { in: cardExternalIds } },
      include: {
        player: true,
        cardPack: true,
        attributes: true,
        skills: { include: { skill: true } },
        autoBuilds: true
      }
    })
    : [];
  const loadedPlayerIds = new Set([
    ...playerSources.map(({ playerId }) => playerId),
    ...cards.map(({ playerId }) => playerId)
  ]);
  const missingTargetPlayerIds = targetPlayerIds.filter((id) => !loadedPlayerIds.has(id));
  const targetPlayers = missingTargetPlayerIds.length > 0
    ? await tx.footballPlayer.findMany({ where: { id: { in: missingTargetPlayerIds } } })
    : [];
  const loadedSkills = skillCodes.length > 0
    ? await tx.skill.findMany({ where: { code: { in: skillCodes } } })
    : [];

  const playersById = new Map<string, PublicationPlayerRow>();
  for (const source of playerSources) playersById.set(source.player.id, playerRow(source.player));
  for (const card of cards) playersById.set(card.player.id, playerRow(card.player));
  for (const player of targetPlayers) playersById.set(player.id, playerRow(player));

  const packsByExternalId = new Map<string, PublicationPackRow>();
  for (const pack of packs) packsByExternalId.set(pack.externalId, packRow(pack));
  for (const card of cards) {
    if (card.cardPack) packsByExternalId.set(card.cardPack.externalId, packRow(card.cardPack));
  }

  const skillsByCode = new Map<string, PublicationSkillRow>();
  for (const skill of loadedSkills) skillsByCode.set(skill.code, skill);
  for (const card of cards) {
    for (const { skill } of card.skills) skillsByCode.set(skill.code, skill);
  }

  const buildsByKey = new Map();
  for (const card of cards) {
    for (const build of card.autoBuilds) {
      buildsByKey.set(publicationBuildKey(card.id, build.algorithmVersion), {
        id: build.id,
        playerCardId: build.playerCardId,
        algorithmVersion: build.algorithmVersion,
        allocationJson: build.allocationJson as Record<string, number>,
        maxOverall: build.maxOverall,
        dtRating: build.dtRating,
        calculatedAt: build.calculatedAt
      });
    }
  }

  const playerSourcesByExternalId = new Map(playerSources.map((source) => [source.externalId, {
    id: source.id,
    playerId: source.playerId,
    sourceId: source.sourceId,
    externalId: source.externalId,
    sourceUpdatedAt: source.sourceUpdatedAt
  }]));
  const cardsByExternalId = new Map(cards.map((card) => [card.externalId, {
    id: card.id,
    sourceId: card.sourceId,
    externalId: card.externalId,
    playerId: card.playerId,
    cardPackId: card.cardPackId,
    cardName: card.cardName,
    position: card.position,
    overallRating: card.overallRating,
    cardType: card.cardType,
    playStyle: card.playStyle,
    status: card.status,
    imageUrl: card.imageUrl,
    sourceUpdatedAt: card.sourceUpdatedAt,
    publishedAt: card.publishedAt ?? new Date(0),
    lastPublishedReleaseSequence: card.lastPublishedReleaseSequence ?? 0
  }]));
  const attributesByCardId = new Map(cards.flatMap((card) =>
    card.attributes ? [[card.id, card.attributes.attributesJson] as const] : []));
  const skillCodesByCardId = new Map(cards.map((card) => [
    card.id,
    card.skills.map(({ skill }) => skill.code)
  ]));

  const buildPlayerIds = new Set<string>();
  for (const record of input.records) {
    if (
      record.value.autoBuildAllocation === undefined
      || record.value.autoBuildMaxOverall === undefined
      || record.value.algorithmVersion === undefined
    ) continue;
    const playerId = record.targetPlayerId
      ?? (record.value.playerExternalId
        ? playerSourcesByExternalId.get(record.value.playerExternalId)?.playerId
        : undefined)
      ?? cardsByExternalId.get(record.value.externalId)?.playerId;
    if (playerId) buildPlayerIds.add(playerId);
  }

  const candidates = buildPlayerIds.size > 0
    ? await tx.playerCardAutoBuild.findMany({
      where: { playerCard: { playerId: { in: [...buildPlayerIds] } } },
      include: {
        playerCard: {
          select: {
            playerId: true,
            externalId: true,
            cardPack: { select: { releaseDate: true } }
          }
        }
      }
    })
    : [];
  const bestCardCandidatesByPlayerId = new Map<string, BestCardCandidate[]>();
  for (const candidate of candidates) {
    const values = bestCardCandidatesByPlayerId.get(candidate.playerCard.playerId) ?? [];
    values.push({
      autoBuildId: candidate.id,
      playerCardId: candidate.playerCardId,
      externalId: candidate.playerCard.externalId,
      algorithmVersion: candidate.algorithmVersion,
      maxOverall: candidate.maxOverall,
      releaseDate: candidate.playerCard.cardPack?.releaseDate ?? null
    });
    bestCardCandidatesByPlayerId.set(candidate.playerCard.playerId, values);
  }

  return {
    playersById,
    playerSourcesByExternalId,
    packsByExternalId,
    cardsByExternalId,
    attributesByCardId,
    skillCodesByCardId,
    skillsByCode,
    buildsByKey,
    bestCardCandidatesByPlayerId
  };
}

async function executeChunks<T>(
  tx: Transaction,
  rows: readonly T[],
  statement: (chunk: readonly T[]) => Prisma.Sql
): Promise<void> {
  for (const chunk of chunks(rows)) await tx.$executeRaw(statement(chunk));
}

export async function writePlayerImportPublicationPlan(
  tx: Transaction,
  plan: PlayerImportPublicationPlan
): Promise<void> {
  await executeChunks(tx, plan.players, (rows) => Prisma.sql`
    INSERT INTO football_players (
      id, name_zh, name_en, normalized_name_zh, normalized_name_en, short_name,
      nationality, club, club_zh, club_en, published_at,
      last_published_release_sequence, created_at, updated_at
    ) VALUES ${Prisma.join(rows.map((row) => Prisma.sql`(
      ${row.id}, ${row.nameZh}, ${row.nameEn}, ${row.normalizedNameZh}, ${row.normalizedNameEn},
      ${row.shortName}, ${row.nationality}, ${row.club}, ${row.clubZh}, ${row.clubEn},
      ${row.publishedAt}, ${row.lastPublishedReleaseSequence}, ${row.publishedAt}, ${row.publishedAt}
    )`))}
    ON DUPLICATE KEY UPDATE
      name_zh = VALUES(name_zh), name_en = VALUES(name_en),
      normalized_name_zh = VALUES(normalized_name_zh), normalized_name_en = VALUES(normalized_name_en),
      short_name = VALUES(short_name), nationality = VALUES(nationality), club = VALUES(club),
      club_zh = VALUES(club_zh), club_en = VALUES(club_en), published_at = VALUES(published_at),
      last_published_release_sequence = VALUES(last_published_release_sequence), updated_at = VALUES(updated_at)
  `);

  const writeAt = plan.versions[0]?.publishedAt ?? plan.cards[0]?.publishedAt ?? new Date();
  await executeChunks(tx, plan.playerSources, (rows) => Prisma.sql`
    INSERT INTO football_player_sources (
      id, player_id, source_id, external_id, source_updated_at, created_at, updated_at
    ) VALUES ${Prisma.join(rows.map((row) => Prisma.sql`(
      ${row.id}, ${row.playerId}, ${row.sourceId}, ${row.externalId}, ${row.sourceUpdatedAt}, ${writeAt}, ${writeAt}
    )`))}
    ON DUPLICATE KEY UPDATE
      player_id = VALUES(player_id), source_updated_at = VALUES(source_updated_at), updated_at = VALUES(updated_at)
  `);

  await executeChunks(tx, plan.packs, (rows) => Prisma.sql`
    INSERT INTO card_packs (
      id, source_id, external_id, name_zh, name_en, season, release_date, cover_url,
      status, published_at, last_published_release_sequence, created_at, updated_at
    ) VALUES ${Prisma.join(rows.map((row) => Prisma.sql`(
      ${row.id}, ${row.sourceId}, ${row.externalId}, ${row.nameZh}, ${row.nameEn}, ${row.season},
      ${row.releaseDate}, ${row.coverUrl}, ${row.status}, ${row.publishedAt},
      ${row.lastPublishedReleaseSequence}, ${row.publishedAt}, ${row.publishedAt}
    )`))}
    ON DUPLICATE KEY UPDATE
      name_zh = VALUES(name_zh), name_en = VALUES(name_en), season = VALUES(season),
      release_date = VALUES(release_date), cover_url = VALUES(cover_url), status = VALUES(status),
      published_at = VALUES(published_at), last_published_release_sequence = VALUES(last_published_release_sequence),
      updated_at = VALUES(updated_at)
  `);

  await executeChunks(tx, plan.cards, (rows) => Prisma.sql`
    INSERT INTO player_cards (
      id, source_id, external_id, player_id, card_pack_id, card_name, position,
      overall_rating, card_type, play_style, status, image_url, source_updated_at,
      published_at, last_published_release_sequence, created_at, updated_at
    ) VALUES ${Prisma.join(rows.map((row) => Prisma.sql`(
      ${row.id}, ${row.sourceId}, ${row.externalId}, ${row.playerId}, ${row.cardPackId},
      ${row.cardName}, ${row.position}, ${row.overallRating}, ${row.cardType}, ${row.playStyle},
      ${row.status}, ${row.imageUrl}, ${row.sourceUpdatedAt}, ${row.publishedAt},
      ${row.lastPublishedReleaseSequence}, ${row.publishedAt}, ${row.publishedAt}
    )`))}
    ON DUPLICATE KEY UPDATE
      player_id = VALUES(player_id), card_pack_id = VALUES(card_pack_id), card_name = VALUES(card_name),
      position = VALUES(position), overall_rating = VALUES(overall_rating), card_type = VALUES(card_type),
      play_style = VALUES(play_style), status = VALUES(status), image_url = VALUES(image_url),
      source_updated_at = VALUES(source_updated_at), published_at = VALUES(published_at),
      last_published_release_sequence = VALUES(last_published_release_sequence), updated_at = VALUES(updated_at)
  `);

  await executeChunks(tx, plan.attributes, (rows) => Prisma.sql`
    INSERT INTO player_card_attributes (
      id, player_card_id, attributes_json, created_at, updated_at
    ) VALUES ${Prisma.join(rows.map((row) => Prisma.sql`(
      ${row.id}, ${row.playerCardId}, ${JSON.stringify(row.attributesJson)}, ${writeAt}, ${writeAt}
    )`))}
    ON DUPLICATE KEY UPDATE attributes_json = VALUES(attributes_json), updated_at = VALUES(updated_at)
  `);

  await executeChunks(tx, plan.skills, (rows) => Prisma.sql`
    INSERT INTO skills (id, code, name_zh, name_en, created_at, updated_at)
    VALUES ${Prisma.join(rows.map((row) => Prisma.sql`(
      ${row.id}, ${row.code}, ${row.nameZh}, ${row.nameEn}, ${writeAt}, ${writeAt}
    )`))}
    ON DUPLICATE KEY UPDATE
      name_zh = VALUES(name_zh), name_en = VALUES(name_en), updated_at = VALUES(updated_at)
  `);

  if (plan.replaceSkillCardIds.length > 0) {
    await tx.playerCardSkill.deleteMany({
      where: { playerCardId: { in: plan.replaceSkillCardIds } }
    });
  }
  for (const rows of chunks(plan.cardSkills)) {
    await tx.playerCardSkill.createMany({ data: [...rows], skipDuplicates: true });
  }

  await executeChunks(tx, plan.builds, (rows) => Prisma.sql`
    INSERT INTO player_card_auto_builds (
      id, player_card_id, algorithm_version, allocation_json, max_overall, dt_rating,
      calculated_at, created_at, updated_at
    ) VALUES ${Prisma.join(rows.map((row) => Prisma.sql`(
      ${row.id}, ${row.playerCardId}, ${row.algorithmVersion}, ${JSON.stringify(row.allocationJson)},
      ${row.maxOverall}, ${row.dtRating}, ${row.calculatedAt}, ${row.calculatedAt}, ${row.calculatedAt}
    )`))}
    ON DUPLICATE KEY UPDATE
      allocation_json = VALUES(allocation_json), max_overall = VALUES(max_overall),
      dt_rating = VALUES(dt_rating), calculated_at = VALUES(calculated_at), updated_at = VALUES(updated_at)
  `);

  await executeChunks(tx, plan.bestCards, (rows) => Prisma.sql`
    INSERT INTO football_player_best_cards (
      id, football_player_id, player_card_id, auto_build_id, selection_reason, selected_at, updated_at
    ) VALUES ${Prisma.join(rows.map((row) => Prisma.sql`(
      ${row.id}, ${row.footballPlayerId}, ${row.playerCardId}, ${row.autoBuildId},
      ${JSON.stringify(row.selectionReason)}, ${row.selectedAt}, ${row.selectedAt}
    )`))}
    ON DUPLICATE KEY UPDATE
      player_card_id = VALUES(player_card_id), auto_build_id = VALUES(auto_build_id),
      selection_reason = VALUES(selection_reason), selected_at = VALUES(selected_at), updated_at = VALUES(updated_at)
  `);

  for (const rows of chunks(plan.versions)) {
    await tx.playerCardVersion.createMany({
      data: rows.map((row) => ({
        ...row,
        skillsJson: JSON.parse(JSON.stringify(row.skillsJson)) as Prisma.InputJsonValue,
        attributesJson: JSON.parse(JSON.stringify(row.attributesJson)) as Prisma.InputJsonValue
      })),
      skipDuplicates: false
    });
  }
}
