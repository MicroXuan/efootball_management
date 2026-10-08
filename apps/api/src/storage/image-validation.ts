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
  return validateImage(file, 'INVALID_LEAGUE_IMAGE', false);
}

export function validateTeamCrest(file: BufferedUpload | undefined): StoredUploadInput {
  return validateImage(file, 'INVALID_TEAM_CREST', true);
}

function validateImage(
  file: BufferedUpload | undefined,
  code: 'INVALID_LEAGUE_IMAGE' | 'INVALID_TEAM_CREST',
  requireDimensions: boolean
): StoredUploadInput {
  if (!file?.buffer?.length) throw invalidImage(code, 'An image file is required');
  if (file.size !== file.buffer.length || file.size > MAX_LEAGUE_IMAGE_BYTES) {
    throw invalidImage(code, 'Images must not exceed 2 MiB');
  }

  const detected = detectImage(file.buffer);
  if (!detected) throw invalidImage(code, 'Only valid JPEG, PNG, or WebP images are supported');
  if (requireDimensions) {
    const dimensions = detectDimensions(file.buffer, detected.extension);
    if (!dimensions
      || dimensions.width < 16
      || dimensions.height < 16
      || dimensions.width > 4096
      || dimensions.height > 4096) {
      throw invalidImage(code, 'Team crests must be between 16 and 4096 pixels per side');
    }
  }

  return {
    buffer: file.buffer,
    size: file.size,
    ...detected
  };
}

function detectDimensions(
  buffer: Buffer,
  extension: DetectedImage['extension']
): { width: number; height: number } | null {
  if (extension === 'png') {
    if (buffer.length < 24 || buffer.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (extension === 'jpg') {
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) return null;
      const marker = buffer[offset + 1];
      if (marker === undefined) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      if (offset + 4 > buffer.length) return null;
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) return null;
      offset += length + 2;
    }
    return null;
  }
  if (buffer.length < 30) return null;
  const chunk = buffer.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }
  if (chunk === 'VP8L' && buffer[20] === 0x2f) {
    const b1 = buffer[21] ?? 0;
    const b2 = buffer[22] ?? 0;
    const b3 = buffer[23] ?? 0;
    const b4 = buffer[24] ?? 0;
    return {
      width: 1 + b1 + ((b2 & 0x3f) << 8),
      height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10)
    };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30 && buffer.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }
  return null;
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

function invalidImage(code: 'INVALID_LEAGUE_IMAGE' | 'INVALID_TEAM_CREST', message: string): BadRequestException {
  return new BadRequestException({ code, message });
}
