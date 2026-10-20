import { jest } from '@jest/globals';
import { of, lastValueFrom } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { ObjectStorage } from './object-storage.js';
import {
  PublicImageResponseInterceptor,
  resolvePublicImageFields
} from './public-image-response.interceptor.js';
import { StorageModule } from './storage.module.js';

describe('resolvePublicImageFields', () => {
  it('recursively converts allowlisted public image fields in objects and arrays', async () => {
    const temporaryReadUrl = jest.fn(async (key: string) => `https://temporary.example/${encodeURIComponent(key)}`);
    const storage = { temporaryReadUrl } as unknown as ObjectStorage;

    const response = await resolvePublicImageFields(storage, {
      logoUrl: 'cloud://env/league.png',
      teams: [{ teamLogoUrlSnapshot: 'cloud://env/team.png' }],
      presentation: { leagueCenterBannerUrl: 'cloud://env/banner.png' },
      owner: { userAvatarUrl: 'cloud://env/avatar.png' }
    });

    expect(response).toEqual({
      logoUrl: 'https://temporary.example/cloud%3A%2F%2Fenv%2Fleague.png',
      teams: [{ teamLogoUrlSnapshot: 'https://temporary.example/cloud%3A%2F%2Fenv%2Fteam.png' }],
      presentation: { leagueCenterBannerUrl: 'https://temporary.example/cloud%3A%2F%2Fenv%2Fbanner.png' },
      owner: { userAvatarUrl: 'https://temporary.example/cloud%3A%2F%2Fenv%2Favatar.png' }
    });
    expect(temporaryReadUrl).toHaveBeenCalledTimes(4);
  });

  it('preserves internal cloud ids, private object keys, upload urls and ordinary values', async () => {
    const temporaryReadUrl = jest.fn(async () => 'https://temporary.example/image.png');
    const storage = { temporaryReadUrl } as unknown as ObjectStorage;
    const input = {
      leagueCenterBannerCloudFileId: 'cloud://env/banner.png',
      objectKey: 'cloud://env/private-evidence.png',
      uploadUrl: 'cloud://env/upload-target',
      logoUrl: 'https://media.example/logo.png',
      nested: null
    };

    await expect(resolvePublicImageFields(storage, input)).resolves.toEqual(input);
    expect(temporaryReadUrl).not.toHaveBeenCalled();
  });

  it('preserves Date and Buffer instances', async () => {
    const storage = {} as ObjectStorage;
    const createdAt = new Date('2026-10-18T00:00:00.000Z');
    const bytes = Buffer.from('image');

    await expect(resolvePublicImageFields(storage, { createdAt, bytes })).resolves.toEqual({ createdAt, bytes });
  });
});

describe('PublicImageResponseInterceptor', () => {
  it('maps controller responses through the public image transformer', async () => {
    const storage = {
      temporaryReadUrl: jest.fn(async () => 'https://temporary.example/logo.png')
    } as unknown as ObjectStorage;
    const interceptor = new PublicImageResponseInterceptor(storage);
    const next = { handle: () => of({ logoUrl: 'cloud://env/logo.png' }) } as CallHandler;

    await expect(lastValueFrom(interceptor.intercept({} as ExecutionContext, next))).resolves.toEqual({
      logoUrl: 'https://temporary.example/logo.png'
    });
  });

  it('is registered globally by the storage module', () => {
    const providers = Reflect.getMetadata('providers', StorageModule) as unknown[];

    expect(providers).toEqual(expect.arrayContaining([{
      provide: APP_INTERCEPTOR,
      useClass: PublicImageResponseInterceptor
    }]));
  });
});
