import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cloudbase from '@cloudbase/node-sdk';
import { AdminAuthModule } from '../admin-auth/admin-auth.module.js';
import { AdminUploadsController } from './admin-uploads.controller.js';
import { CloudBaseObjectStorage, type CloudBaseStorageClient } from './cloudbase-object-storage.js';
import { LocalObjectStorage } from './local-object-storage.js';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';
import { PublicMediaController } from './public-media.controller.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminUploadsController, PublicMediaController],
  providers: [{
    provide: OBJECT_STORAGE,
    inject: [ConfigService],
    useFactory: (config: ConfigService): ObjectStorage => {
      const provider = config.getOrThrow<'local' | 'cloudbase'>('storage.provider');
      if (provider === 'local') {
        return new LocalObjectStorage(
          config.getOrThrow<string>('storage.localDirectory'),
          config.getOrThrow<string>('storage.publicApiBaseUrl')
        );
      }
      const client = cloudbase.init({
        env: config.getOrThrow<string>('storage.cloudbase.environmentId'),
        secretId: config.getOrThrow<string>('storage.cloudbase.secretId'),
        secretKey: config.getOrThrow<string>('storage.cloudbase.secretKey')
      }) as CloudBaseStorageClient;
      return new CloudBaseObjectStorage(client);
    }
  }],
  exports: [OBJECT_STORAGE]
})
export class StorageModule {}
