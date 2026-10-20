import { MODULE_METADATA } from '@nestjs/common/constants';
import { AdminMatchResultDisputesController } from './admin-match-result-disputes.controller.js';
import { CompetitionsModule } from './competitions.module.js';
import { MatchResultDeadlineWorker } from './match-result-deadline.worker.js';
import { MatchResultDisputesService } from './match-result-disputes.service.js';
import { ResultEvidenceController } from './result-evidence.controller.js';
import { ResultEvidenceRetentionWorker } from './result-evidence-retention.worker.js';
import { ResultEvidenceStorageService } from './result-evidence-storage.service.js';
import { SeasonFixturesController } from './season-fixtures.controller.js';
import { SeasonFixturesService } from './season-fixtures.service.js';

describe('CompetitionsModule result surface', () => {
  it('unregisters participant evidence, dispute administration, and deadline automation', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, CompetitionsModule) as unknown[];
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CompetitionsModule) as unknown[];

    expect(controllers).not.toEqual(expect.arrayContaining([
      ResultEvidenceController,
      AdminMatchResultDisputesController,
    ]));
    expect(providers).not.toContain(MatchResultDeadlineWorker);
  });

  it('retains historical evidence cleanup and internal dispute support', () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CompetitionsModule) as unknown[];
    expect(providers).toEqual(expect.arrayContaining([
      MatchResultDisputesService,
      ResultEvidenceStorageService,
      ResultEvidenceRetentionWorker,
    ]));
  });

  it('registers the authenticated season fixture browser', () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, CompetitionsModule) as unknown[];
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CompetitionsModule) as unknown[];
    expect(controllers).toContain(SeasonFixturesController);
    expect(providers).toContain(SeasonFixturesService);
  });
});
