import { normalizeSearchText } from '../player-import/record-normalizer.js';

export function buildPlayerCardSearchFields(input: {
  cardName: string;
  packNameZh: string | null;
  packNameEn: string | null;
}): {
  normalizedCardName: string;
  normalizedPackNameZh: string | null;
  normalizedPackNameEn: string | null;
} {
  return {
    normalizedCardName: normalizeSearchText(input.cardName),
    normalizedPackNameZh: input.packNameZh === null ? null : normalizeSearchText(input.packNameZh),
    normalizedPackNameEn: input.packNameEn === null ? null : normalizeSearchText(input.packNameEn)
  };
}
