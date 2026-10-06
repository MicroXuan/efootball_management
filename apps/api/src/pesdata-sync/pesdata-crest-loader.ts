import { createHash } from 'node:crypto';
import type { TeamCatalogCandidate } from '@efm/contracts';
import type { ObjectStorage } from '../storage/object-storage.js';
import { MAX_LEAGUE_IMAGE_BYTES, validateTeamCrest } from '../storage/image-validation.js';

export class PesdataCrestError extends Error {
  readonly code = 'PESDATA_CREST_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'PesdataCrestError';
  }
}

export type StoredCrest = { storedLogoUrl: string; logoChecksum: string };

export class PesdataCrestLoader {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly fetchImplementation: typeof fetch = fetch
  ) {}

  async load(candidate: TeamCatalogCandidate): Promise<StoredCrest> {
    if (!candidate.remoteLogoUrl) throw new PesdataCrestError('PESDATA team crest URL is missing');
    if (!this.storage.putNamed) throw new PesdataCrestError('Content-addressed object storage is unavailable');
    let current = this.httpsUrl(candidate.remoteLogoUrl);
    let response: Response | undefined;
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      response = await this.fetchImplementation(current, { method: 'GET', redirect: 'manual' });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) throw new PesdataCrestError('PESDATA crest redirect is invalid');
      current = this.httpsUrl(new URL(location, current).toString());
      if (redirectCount === 5) throw new PesdataCrestError('PESDATA crest has too many redirects');
    }
    if (!response?.ok) throw new PesdataCrestError('PESDATA crest download failed');
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('image/')) {
      throw new PesdataCrestError('PESDATA crest response is not an image');
    }
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (contentLength > MAX_LEAGUE_IMAGE_BYTES) throw new PesdataCrestError('PESDATA crest exceeds 2 MiB');
    const buffer = await this.readLimited(response);
    let file;
    try {
      file = validateTeamCrest({ buffer, size: buffer.length, mimetype: response.headers.get('content-type') ?? '', originalname: 'crest' });
    } catch {
      throw new PesdataCrestError('PESDATA crest image is invalid');
    }
    const logoChecksum = createHash('sha256').update(buffer).digest('hex');
    const stored = await this.storage.putNamed('team-crests', logoChecksum, file);
    return { storedLogoUrl: stored.url, logoChecksum };
  }

  private httpsUrl(value: string) {
    let url: URL;
    try { url = new URL(value); } catch { throw new PesdataCrestError('PESDATA crest URL is invalid'); }
    if (url.protocol !== 'https:') throw new PesdataCrestError('PESDATA crest URL must use HTTPS');
    return url;
  }

  private async readLimited(response: Response) {
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_LEAGUE_IMAGE_BYTES) {
        await reader.cancel();
        throw new PesdataCrestError('PESDATA crest exceeds 2 MiB');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  }
}
