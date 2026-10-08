import type { TeamCatalogCandidate } from '@efm/contracts';
import type { PesdataTeam } from './pesdata-team.schemas.js';

function timestamp(value: PesdataTeam['updatedAt']) {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function mapPesdataTeam(raw: PesdataTeam): TeamCatalogCandidate {
  const preferredName = raw.nameZh ?? raw.nameEn ?? raw.nameJa;
  if (!preferredName) throw new Error('PESDATA team name is required');
  return {
    sourceExternalId: raw.teamId,
    sourceLeagueExternalId: raw.leagueId,
    sourceLeagueName: raw.leagueName,
    nameZh: raw.nameZh,
    nameEn: raw.nameEn,
    nameJa: raw.nameJa,
    shortName: raw.shortName ?? [...preferredName].slice(0, 24).join(''),
    remoteLogoUrl: raw.teamLogo,
    storedLogoUrl: null,
    sourceUpdatedAt: timestamp(raw.updatedAt)
  };
}
