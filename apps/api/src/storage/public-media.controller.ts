import { Controller, Get, Inject, NotFoundException, Param, StreamableFile } from '@nestjs/common';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';

@Controller('v1/media')
export class PublicMediaController {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  @Get(':key')
  async read(@Param('key') key: string): Promise<StreamableFile> {
    const stored = await this.storage.read?.(key);
    if (!stored) throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'Media not found' });
    return new StreamableFile(stored.buffer, {
      type: stored.mimeType,
      length: stored.size,
      disposition: 'inline'
    });
  }
}
