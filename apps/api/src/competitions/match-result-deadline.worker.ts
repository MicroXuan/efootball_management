import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { MatchResultDisputesService } from './match-result-disputes.service.js';

@Injectable()
export class MatchResultDeadlineWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(MatchResultDeadlineWorker.name);

  constructor(@Inject(MatchResultDisputesService) private readonly disputes: MatchResultDisputesService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => this.logger.error('Failed to advance match result deadlines', error));
    }, 300_000);
    this.timer.unref();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  async tick(now: Date = new Date()): Promise<void> { await this.disputes.advanceDue(now); }
}
