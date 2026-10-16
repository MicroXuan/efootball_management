import { BadRequestException } from '@nestjs/common';
import { validateLeagueImage, validateResultEvidenceImage } from './image-validation.js';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function upload(buffer: Buffer, originalname: string, mimetype = 'application/octet-stream') {
  return { buffer, originalname, mimetype, size: buffer.length };
}

describe('validateLeagueImage', () => {
  it.each([
    ['jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg', 'jpg'],
    ['png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png', 'png'],
    ['webp', Buffer.from('RIFF0000WEBP'), 'image/webp', 'webp']
  ])('accepts a real %s signature at exactly 2 MiB', (_name, signature, mimeType, extension) => {
    const buffer = Buffer.alloc(MAX_IMAGE_BYTES);
    signature.copy(buffer);

    expect(validateLeagueImage(upload(buffer, `league.${extension}`))).toMatchObject({
      mimeType,
      extension,
      size: MAX_IMAGE_BYTES
    });
  });

  it('rejects a payload larger than 2 MiB', () => {
    const buffer = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);

    expect(() => validateLeagueImage(upload(buffer, 'league.png'))).toThrow(BadRequestException);
  });

  it('rejects executable bytes disguised as a png', () => {
    expect(() => validateLeagueImage(upload(Buffer.from('#!/bin/sh\necho unsafe'), 'league.png')))
      .toThrow(BadRequestException);
  });
});

describe('validateResultEvidenceImage', () => {
  it('accepts an image at exactly one MiB', () => {
    const buffer = Buffer.alloc(1_048_576);
    pngSignature.copy(buffer);
    expect(validateResultEvidenceImage(upload(buffer, 'proof.png', 'image/png'))).toMatchObject({ size: 1_048_576, mimeType: 'image/png' });
  });

  it('rejects a larger image and mismatched declared type', () => {
    const buffer = Buffer.alloc(1_048_577);
    pngSignature.copy(buffer);
    expect(() => validateResultEvidenceImage(upload(buffer, 'proof.png', 'image/png'))).toThrow(BadRequestException);
    expect(() => validateResultEvidenceImage(upload(pngSignature, 'proof.jpg', 'image/jpeg'))).toThrow(BadRequestException);
  });

  it('rejects script bytes disguised as PNG evidence', () => {
    expect(() => validateResultEvidenceImage(upload(Buffer.from('#!/bin/sh\n'), 'proof.png', 'image/png')))
      .toThrow(BadRequestException);
  });
});

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
