import { BadRequestException } from '@nestjs/common';
import type { StoredUploadInput } from './object-storage.js';

export const MAX_LEAGUE_IMAGE_BYTES = 2 * 1024 * 1024;

export interface BufferedUpload {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

type DetectedImage = Pick<StoredUploadInput, 'mimeType' | 'extension'>;

export function validateLeagueImage(file: BufferedUpload | undefined): StoredUploadInput {
  if (!file?.buffer?.length) throw invalidImage('An image file is required');
  if (file.size !== file.buffer.length || file.size > MAX_LEAGUE_IMAGE_BYTES) {
    throw invalidImage('League images must not exceed 2 MiB');
  }

  const detected = detectImage(file.buffer);
  if (!detected) throw invalidImage('Only valid JPEG, PNG, or WebP images are supported');

  return {
    buffer: file.buffer,
    size: file.size,
    ...detected
  };
}

function detectImage(buffer: Buffer): DetectedImage | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: 'jpg' };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
  ]))) {
    return { mimeType: 'image/png', extension: 'png' };
  }
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp', extension: 'webp' };
  }
  return null;
}

function invalidImage(message: string): BadRequestException {
  return new BadRequestException({ code: 'INVALID_LEAGUE_IMAGE', message });
}
