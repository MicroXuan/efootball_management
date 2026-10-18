import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor
} from '@nestjs/common';
import { from, mergeMap, type Observable } from 'rxjs';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';
import { publicImageUrl } from './public-image-url.js';

const PUBLIC_IMAGE_FIELDS = new Set([
  'avatarUrl',
  'badgeUrl',
  'bannerUrl',
  'cardImageUrl',
  'coverImgUrl',
  'coverUrl',
  'imageUrl',
  'leagueCenterBannerUrl',
  'leagueLogoUrl',
  'logoUrl',
  'ownerAvatarUrl',
  'packCoverUrl',
  'portraitUrl',
  'remoteLogoUrl',
  'storedLogoUrl',
  'teamBadgeUrl',
  'teamLogoUrl',
  'teamLogoUrlSnapshot',
  'userAvatarUrl'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export async function resolvePublicImageFields(
  storage: ObjectStorage,
  value: unknown,
  fieldName?: string
): Promise<unknown> {
  if (typeof value === 'string') {
    if (!fieldName || !PUBLIC_IMAGE_FIELDS.has(fieldName) || !value.startsWith('cloud://')) return value;
    return publicImageUrl(storage, value);
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolvePublicImageFields(storage, item)));
  }
  if (!isRecord(value)) return value;

  const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [
    key,
    await resolvePublicImageFields(storage, item, key)
  ] as const));
  return Object.fromEntries(entries);
}

@Injectable()
export class PublicImageResponseInterceptor implements NestInterceptor {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      mergeMap((value: unknown) => from(resolvePublicImageFields(this.storage, value)))
    );
  }
}
