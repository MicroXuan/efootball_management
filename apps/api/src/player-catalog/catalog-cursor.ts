import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const CatalogCursorSchema = z.object({
  releaseSequence: z.number().int().positive(),
  publishedAt: z.iso.datetime(),
  overallRating: z.number().int().min(0).max(110),
  id: z.uuid()
});

export type CatalogCursor = z.infer<typeof CatalogCursorSchema>;

function invalidCursor(): never {
  throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Catalog cursor is invalid' });
}

export function encodeCatalogCursor(cursor: CatalogCursor): string {
  return Buffer.from(JSON.stringify(CatalogCursorSchema.parse(cursor)), 'utf8').toString('base64url');
}

export function decodeCatalogCursor(value: string): CatalogCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const result = CatalogCursorSchema.safeParse(parsed);
    if (!result.success) return invalidCursor();
    return result.data;
  } catch {
    return invalidCursor();
  }
}
