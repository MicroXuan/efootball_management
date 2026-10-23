import type { NormalizedPlayerCardRecord } from '@efm/contracts';
import type { BestCardCandidate, BestCardSelectionReason } from '../player-builds/player-build-selector.js';
import type { PlayerCardStatus, PlayerCardType, PlayerPosition } from '../generated/prisma/enums.js';

export type PreparedPublicationRecord = {
  id: string;
  diffType: 'CREATE' | 'UPDATE';
  changedFields: ReadonlySet<string>;
  targetPlayerId: string | null;
  value: NormalizedPlayerCardRecord;
};

export type PublicationPlayerRow = {
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
  publishedAt: Date;
  lastPublishedReleaseSequence: number;
};

export type PublicationPlayerSourceRow = {
  id: string;
  playerId: string;
  sourceId: string;
  externalId: string;
  sourceUpdatedAt: Date | null;
};

export type PublicationPackRow = {
  id: string;
  sourceId: string;
  externalId: string;
  nameZh: string | null;
  nameEn: string | null;
  season: string | null;
  releaseDate: Date | null;
  coverUrl: string | null;
  status: PlayerCardStatus;
  publishedAt: Date;
  lastPublishedReleaseSequence: number;
};

export type PublicationCardRow = {
  id: string;
  sourceId: string;
  externalId: string;
  playerId: string;
  cardPackId: string | null;
  cardName: string;
  position: PlayerPosition;
  overallRating: number;
  cardType: PlayerCardType;
  playStyle: string | null;
  status: PlayerCardStatus;
  imageUrl: string | null;
  sourceUpdatedAt: Date | null;
  publishedAt: Date;
  lastPublishedReleaseSequence: number;
};

export type PublicationAttributeRow = {
  id: string;
  playerCardId: string;
  attributesJson: unknown;
};

export type PublicationSkillRow = {
  id: string;
  code: string;
  nameZh: string | null;
  nameEn: string | null;
};

export type PublicationCardSkillRow = {
  playerCardId: string;
  skillId: string;
};

export type PublicationBuildRow = {
  id: string;
  playerCardId: string;
  algorithmVersion: string;
  allocationJson: Record<string, number>;
  maxOverall: number;
  dtRating: number | null;
  calculatedAt: Date;
};

export type PublicationBestCardRow = {
  id: string;
  footballPlayerId: string;
  playerCardId: string;
  autoBuildId: string;
  selectionReason: BestCardSelectionReason;
  selectedAt: Date;
};

export type PublicationVersionRow = {
  id: string;
  playerCardId: string;
  releaseSequence: number;
  playerId: string;
  playerNameZh: string | null;
  playerNameEn: string | null;
  normalizedNameZh: string | null;
  normalizedNameEn: string | null;
  playerShortName: string | null;
  nationality: string | null;
  club: string | null;
  cardPackId: string | null;
  packNameZh: string | null;
  packNameEn: string | null;
  normalizedPackNameZh: string | null;
  normalizedPackNameEn: string | null;
  packSeason: string | null;
  packReleaseDate: Date | null;
  packCoverUrl: string | null;
  cardName: string;
  normalizedCardName: string;
  position: PlayerPosition;
  overallRating: number;
  cardType: PlayerCardType;
  playStyle: string | null;
  status: PlayerCardStatus;
  imageUrl: string | null;
  sourceUpdatedAt: Date | null;
  skillsJson: readonly string[];
  attributesJson: unknown;
  publishedAt: Date;
};

export type PlayerImportPublicationState = {
  playersById: Map<string, PublicationPlayerRow>;
  playerSourcesByExternalId: Map<string, PublicationPlayerSourceRow>;
  packsByExternalId: Map<string, PublicationPackRow>;
  cardsByExternalId: Map<string, PublicationCardRow>;
  attributesByCardId: Map<string, unknown>;
  skillCodesByCardId: Map<string, readonly string[]>;
  skillsByCode: Map<string, PublicationSkillRow>;
  buildsByKey: Map<string, PublicationBuildRow>;
  bestCardCandidatesByPlayerId: Map<string, readonly BestCardCandidate[]>;
};

export type PlayerImportPublicationPlan = {
  players: PublicationPlayerRow[];
  playerSources: PublicationPlayerSourceRow[];
  packs: PublicationPackRow[];
  cards: PublicationCardRow[];
  attributes: PublicationAttributeRow[];
  skills: PublicationSkillRow[];
  replaceSkillCardIds: string[];
  cardSkills: PublicationCardSkillRow[];
  builds: PublicationBuildRow[];
  bestCards: PublicationBestCardRow[];
  versions: PublicationVersionRow[];
  affectedPlayerIds: string[];
};

export type BuildPublicationPlanInput = {
  sourceId: string;
  records: readonly PreparedPublicationRecord[];
  state: PlayerImportPublicationState;
  releaseSequence: number;
  publishedAt: Date;
  newId?: () => string;
};

export function publicationBuildKey(playerCardId: string, algorithmVersion: string): string {
  return `${playerCardId}\u0000${algorithmVersion}`;
}
