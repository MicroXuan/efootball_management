import { assertIsolatedTestDatabaseUrl } from '../../test/assert-isolated-test-database.js';

describe('isolated test database guard', () => {
  it('requires an explicit database URL instead of inheriting the default environment', () => {
    expect(() => assertIsolatedTestDatabaseUrl(undefined)).toThrow('DATABASE_URL must be set explicitly');
  });

  it('rejects a remote database even when its name contains test', () => {
    expect(() => assertIsolatedTestDatabaseUrl('mysql://user:secret@remote.example:3306/efm_test'))
      .toThrow('loopback MySQL host');
  });

  it('rejects the ordinary local application database', () => {
    expect(() => assertIsolatedTestDatabaseUrl('mysql://user:secret@127.0.0.1:3307/efm'))
      .toThrow('isolated test database name');
    expect(() => assertIsolatedTestDatabaseUrl('mysql://user:secret@127.0.0.1:3307/efm_test_production'))
      .toThrow('isolated test database name');
  });

  it('accepts explicitly named local test and verification databases', () => {
    expect(() => assertIsolatedTestDatabaseUrl('mysql://user:secret@127.0.0.1:3307/efm_test'))
      .not.toThrow();
    expect(() => assertIsolatedTestDatabaseUrl('mysql://user:secret@localhost:3307/efm_salary_caps_verify'))
      .not.toThrow();
  });
});
