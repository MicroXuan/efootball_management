import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

describe('WeChat group capability migration', () => {
  it('backfills each capability once using the earliest creator deterministically', async () => {
    const migrationUrl = new URL(
      '../../prisma/migrations/20261010120000_wechat_group_capabilities/migration.sql',
      import.meta.url
    );
    const sql = await readFile(fileURLToPath(migrationUrl), 'utf8');
    const normalized = sql.replace(/\s+/g, ' ').trim();

    expect(normalized.match(/INSERT IGNORE INTO `wechat_group_capabilities`/g)).toHaveLength(2);
    expect(normalized.match(/ROW_NUMBER\(\) OVER \( PARTITION BY `group_binding_id` ORDER BY `created_at` ASC, `id` ASC \)/g)).toHaveLength(2);
    expect(normalized.match(/WHERE `row_number` = 1/g)).toHaveLength(2);
    expect(normalized).toContain("'SCHEDULE_QUERY'");
    expect(normalized).toContain("'PLAYER_AUCTION'");
    expect(normalized).toContain('UNIQUE INDEX `wechat_group_capabilities_binding_capability_unique` (`group_binding_id`, `capability`)');
  });
});
