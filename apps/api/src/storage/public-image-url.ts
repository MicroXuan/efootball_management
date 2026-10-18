import type { ObjectStorage } from './object-storage.js';

const PUBLIC_IMAGE_URL_MAX_AGE_SECONDS = 3600;
const PUBLIC_IMAGE_CACHE_MILLISECONDS = 50 * 60 * 1000;

type CacheEntry = {
  url?: string;
  refreshAt?: number;
  pending?: Promise<string>;
};

const caches = new WeakMap<ObjectStorage, Map<string, CacheEntry>>();

export async function publicImageUrl(
  storage: ObjectStorage | undefined,
  value: string | null
): Promise<string | null> {
  if (!value?.startsWith('cloud://')) return value;
  if (!storage?.temporaryReadUrl) throw new Error('CloudBase image reads are unavailable');

  let cache = caches.get(storage);
  if (!cache) {
    cache = new Map();
    caches.set(storage, cache);
  }
  const cached = cache.get(value);
  if (cached?.url && cached.refreshAt && cached.refreshAt > Date.now()) return cached.url;
  if (cached?.pending) return cached.pending;

  const pending = storage.temporaryReadUrl(value, PUBLIC_IMAGE_URL_MAX_AGE_SECONDS)
    .then((url) => {
      if (!url) throw new Error('CloudBase image is unavailable');
      cache.set(value, { url, refreshAt: Date.now() + PUBLIC_IMAGE_CACHE_MILLISECONDS });
      return url;
    });
  cache.set(value, { pending });
  try {
    return await pending;
  } catch (error) {
    if (cache.get(value)?.pending === pending) cache.delete(value);
    throw error;
  }
}
