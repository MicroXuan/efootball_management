import { createHash } from 'node:crypto';
import {
  derivePesdataPositionAutoBuild,
  type PlayerCardType,
  type PlayerPosition
} from '@efm/contracts';
import type { RawImportRow } from '../player-import/import-adapter.js';
import { normalizeImportRow } from '../player-import/record-normalizer.js';
import type { PesdataPlayerDetail } from './pesdata.schemas.js';

const positions = new Set<PlayerPosition>([
  'GK', 'CB', 'LB', 'RB', 'DMF', 'CMF', 'LMF', 'RMF', 'AMF', 'LWF', 'RWF', 'SS', 'CF'
]);

const cardTypes: Record<number, PlayerCardType> = {
  1: 'STANDARD',
  2: 'LEGENDARY',
  3: 'EPIC',
  4: 'BIG_TIME',
  5: 'TRENDING',
  6: 'FEATURED',
  7: 'HIGHLIGHT',
  8: 'SHOW_TIME'
};

export class PesdataMappingError extends Error {
  readonly code = 'PESDATA_MAPPING_ERROR';

  constructor(readonly field: string, message = 'PESDATA detail cannot be mapped') {
    super(message);
    this.name = 'PesdataMappingError';
  }
}

export function mapPesdataCardType(value: unknown): PlayerCardType {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return cardTypes[numeric] ?? 'OTHER';
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).normalize('NFKC').trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

function requiredText(value: unknown, field: string): string {
  const normalized = text(value);
  if (!normalized) throw new PesdataMappingError(field);
  return normalized;
}

function finiteNumber(value: unknown, field: string, required = false): number | undefined {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (Number.isFinite(numeric)) return numeric;
  if (required) throw new PesdataMappingError(field);
  return undefined;
}

function validDate(value: unknown): string | undefined {
  const normalized = text(value);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return undefined;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized
    ? undefined
    : normalized;
}

function sourceTimestamp(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? undefined : value.toISOString();
  const normalized = text(value);
  if (!normalized) return undefined;
  const candidate = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)
    ? `${normalized.replace(' ', 'T')}.000Z`
    : normalized;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const values: string[] = [];
  for (const entry of value) {
    const normalized = text(entry);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase('en-US');
    if (!seen.has(key)) {
      seen.add(key);
      values.push(normalized);
    }
  }
  return values;
}

function skillNames(detail: PesdataPlayerDetail): string[] {
  const direct = stringArray(detail.Skills_cn).length > 0
    ? stringArray(detail.Skills_cn)
    : stringArray(detail.Skills);
  if (direct.length > 0) return direct;
  if (!Array.isArray(detail.skillList)) return [];
  return stringArray(
    detail.skillList.map((skill) => {
      if (typeof skill !== 'object' || skill === null) return undefined;
      const item = skill as Record<string, unknown>;
      return item.name_cn ?? item.name_en ?? item.name_ja;
    })
  );
}

function jsonSafe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => jsonSafe(entry) ?? null);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, jsonSafe(entry)])
    );
  }
  return value;
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

export function pesdataValueChecksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function packExternalId(title: string, date?: string): string {
  const identity = `${title.normalize('NFKC').toLocaleLowerCase('en-US')}|${date ?? ''}`;
  return `pesdata-pack-${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

export function mapPesdataPlayer(detail: PesdataPlayerDetail): RawImportRow {
  const externalId = requiredText(detail.playerId, 'playerId');
  const playerNameZh = text(detail.playerName_cn) ?? text(detail.player_chinese_name);
  const playerNameEn = text(detail.playerName);
  if (!playerNameZh && !playerNameEn) throw new PesdataMappingError('playerName');

  const sourcePosition = requiredText(detail.position, 'position').toUpperCase();
  if (!positions.has(sourcePosition as PlayerPosition)) throw new PesdataMappingError('position');
  const overallRating = finiteNumber(detail.overall, 'overall', true);
  if (overallRating === undefined || !Number.isInteger(overallRating) || overallRating < 1 || overallRating > 110) {
    throw new PesdataMappingError('overall');
  }

  const packName = requiredText(detail.agentTitle, 'agentTitle');
  const releaseDate = validDate(detail.agentDate);
  const updatedAt = sourceTimestamp(detail.created_at);
  const imageUrl = text(detail.player_big) ?? text(detail.player_small) ?? text(detail.bigFace);
  const attributes = {
    speed: finiteNumber(detail.Speed, 'Speed'),
    acceleration: finiteNumber(detail.Acceleration, 'Acceleration'),
    finishing: finiteNumber(detail.Finishing, 'Finishing'),
    dribbling: finiteNumber(detail.Dribbling, 'Dribbling'),
    stamina: finiteNumber(detail.Stamina, 'Stamina'),
    goalkeeping: finiteNumber(detail.Goalkeeping, 'Goalkeeping'),
    foot: text(detail.Foot),
    height: finiteNumber(detail.height, 'height'),
    weight: finiteNumber(detail.weight, 'weight'),
    age: finiteNumber(detail.age, 'age'),
    positionHot: jsonSafe(detail.PositionHot),
    boost: jsonSafe(detail.boost),
    boost2: jsonSafe(detail.boost2),
    boost3: jsonSafe(detail.boost3),
    sourceMetadata: jsonSafe(detail)
  };
  const cleanAttributes = Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined)
  );
  const algorithmVersion = text(detail.algorithmVersion);
  const cardType = mapPesdataCardType(detail.cardType);
  const derivedBuild = detail.autoBuildAllocation == null
    && detail.autoBuildMaxOverall == null
    && detail.dtRating == null
    && !algorithmVersion
    ? derivePesdataPositionAutoBuild({
      position: sourcePosition as PlayerPosition,
      overallRating,
      maxLevel: detail.maxLevel,
      cardType
    })
    : null;

  const row: RawImportRow = {
    externalId,
    playerExternalId: text(detail.base_pes_id) ?? externalId,
    ...(playerNameZh ? { playerNameZh } : {}),
    ...(playerNameEn ? { playerNameEn } : {}),
    nationality: text(detail.nationality_en) ?? text(detail.nationality_cn),
    club: text(detail.team_en) ?? text(detail.team_cn),
    cardName: packName,
    position: sourcePosition,
    overallRating,
    cardType,
    playStyle: text(detail.CardStyle_cn) ?? text(detail.CardStyle_en) ?? text(detail.CardStyle),
    status: String(detail.is_del ?? '0') === '1' ? 'INACTIVE' : 'ACTIVE',
    ...(imageUrl ? { imageUrl } : {}),
    packExternalId: packExternalId(packName, releaseDate),
    packName,
    ...(releaseDate ? { season: releaseDate.slice(0, 4), releaseDate } : {}),
    ...(updatedAt ? { sourceUpdatedAt: updatedAt } : {}),
    skills: skillNames(detail),
    attributes: cleanAttributes,
    ...(detail.autoBuildAllocation != null || derivedBuild
      ? { autoBuildAllocation: detail.autoBuildAllocation ?? derivedBuild!.allocation }
      : {}),
    ...(detail.autoBuildMaxOverall != null || derivedBuild
      ? { autoBuildMaxOverall: detail.autoBuildMaxOverall ?? derivedBuild!.maxOverall }
      : {}),
    ...(detail.dtRating != null || derivedBuild
      ? { dtRating: detail.dtRating ?? derivedBuild!.dtRating }
      : {}),
    ...(algorithmVersion || derivedBuild
      ? { algorithmVersion: algorithmVersion ?? derivedBuild!.algorithmVersion }
      : {})
  };

  try {
    normalizeImportRow(row);
  } catch {
    throw new PesdataMappingError('normalizedRecord');
  }
  return row;
}
