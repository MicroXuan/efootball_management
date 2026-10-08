export type LegacyLeagueTeamShell = {
  id: string;
  name: string;
  shortName: string;
  logoUrl: string | null;
};

export type LegacyShellSeed = {
  id: string;
  sourceType: 'CUSTOM';
  sourceExternalId: null;
  nameZh: string;
  nameEn: null;
  nameJa: null;
  shortName: string;
  storedLogoUrl: string | null;
  status: 'ACTIVE';
};

export function buildLegacyShellSeed(team: LegacyLeagueTeamShell): LegacyShellSeed {
  return {
    id: team.id,
    sourceType: 'CUSTOM',
    sourceExternalId: null,
    nameZh: team.name,
    nameEn: null,
    nameJa: null,
    shortName: team.shortName,
    storedLogoUrl: team.logoUrl,
    status: 'ACTIVE'
  };
}
