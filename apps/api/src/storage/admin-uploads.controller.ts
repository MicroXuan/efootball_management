import {
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdminAuthGuard } from '../admin-auth/admin-auth.guard.js';
import { validateLeagueImage, validateTeamCrest, type BufferedUpload } from './image-validation.js';
import { OBJECT_STORAGE, type ObjectStorage, type StoredObject } from './object-storage.js';

@Controller('admin/uploads')
@UseGuards(AdminAuthGuard)
export class AdminUploadsController {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage) {}

  @Post('league-images')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 2 * 1024 * 1024 + 1, files: 1 }
  }))
  uploadLeagueImage(@UploadedFile() file: BufferedUpload | undefined): Promise<StoredObject> {
    return this.storage.put('league-images', validateLeagueImage(file));
  }

  @Post('league-center-banners')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 2 * 1024 * 1024 + 1, files: 1 }
  }))
  uploadLeagueCenterBanner(
    @UploadedFile() file: BufferedUpload | undefined
  ): Promise<StoredObject> {
    return this.storage.put('league-center-banners', validateLeagueImage(file));
  }

  @Post('team-crests')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 2 * 1024 * 1024 + 1, files: 1 }
  }))
  uploadTeamCrest(@UploadedFile() file: BufferedUpload | undefined): Promise<StoredObject> {
    return this.storage.put('team-crests', validateTeamCrest(file));
  }
}
