export function assertIsolatedTestDatabaseUrl(databaseUrl: string | undefined): void {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL must be set explicitly for API tests');
  }

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid MySQL URL for API tests');
  }

  if (url.protocol !== 'mysql:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())) {
    throw new Error('API tests require a loopback MySQL host');
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!/(^|[_-])(test|verify)$/i.test(databaseName)) {
    throw new Error('API tests require an isolated test database name');
  }
}
