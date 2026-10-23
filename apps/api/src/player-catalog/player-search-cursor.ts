import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { decodeCatalogCursor, type CatalogCursor } from './catalog-cursor.js';

const CursorV2 = z.object({
  version: z.literal(2),
  releaseSequence: z.number().int().positive(),
  packReleaseDate: z.iso.date().nullable(),
  overallRating: z.number().int().min(0).max(110),
  publishedAt: z.iso.datetime(),
  id: z.uuid()
});

export type PlayerSearchCursor = z.infer<typeof CursorV2>;
export type AnyPlayerSearchCursor = PlayerSearchCursor | CatalogCursor;

export function encodePlayerSearchCursor(value: PlayerSearchCursor): string {
  return Buffer.from(JSON.stringify(CursorV2.parse(value)), 'utf8').toString('base64url');
}

export function decodePlayerSearchCursor(value: string): AnyPlayerSearchCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Catalog cursor is invalid' });
  }
  if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
    const result = CursorV2.safeParse(parsed);
    if (!result.success) throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Catalog cursor is invalid' });
    return result.data;
  }
  return decodeCatalogCursor(value);
}

export function isPlayerSearchCursor(value: AnyPlayerSearchCursor): value is PlayerSearchCursor {
  return 'version' in value && value.version === 2;
}
