export type PesdataSyncMode = 'sample' | 'full' | 'incremental';

export type StartPesdataSyncInput = {
  mode: PesdataSyncMode;
  limit?: number;
  dryRun?: boolean;
};

export type PesdataSyncResult = {
  runId: string | null;
  status: 'READY' | 'FAILED';
  sourceTotal: number | null;
  scannedCount: number;
  fetchedCount: number;
  skippedCount: number;
  failedCount: number;
  batchIds: string[];
  dryRun: boolean;
};

export class PesdataSyncError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'PesdataSyncError';
  }
}

