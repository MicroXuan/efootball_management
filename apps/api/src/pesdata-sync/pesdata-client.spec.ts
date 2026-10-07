import {
  PesdataClient,
  PesdataClientError,
  type PesdataClientConfig
} from './pesdata-client.js';

const success = (data: unknown) =>
  new Response(JSON.stringify({ code: 1, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });

const baseConfig = {
  baseUrl: 'https://authorized.example',
  siteVersion: '1.9.0',
  signatureSeed: 'authorized-test-seed',
  requestsPerSecond: 1,
  timeoutMs: 5_000,
  maxRetries: 2,
  deviceId: '0123456789abcdef0123456789abcdef'
};

type FetchCall = Parameters<typeof fetch>;
type FetchImplementation = (...arguments_: FetchCall) => Promise<Response>;
type FetchMock = typeof fetch & { calls: FetchCall[] };
type ConfigOverrides = Omit<Partial<typeof baseConfig>, 'signatureSeed'> & {
  signatureSeed?: string | undefined;
};

const mockFetch = (
  implementation: FetchImplementation | FetchImplementation[] = async () => {
    throw new Error('unexpected fetch');
  }
): FetchMock => {
  const implementations = Array.isArray(implementation) ? implementation : [implementation];
  const calls: FetchCall[] = [];
  const fetchMock = async (...arguments_: FetchCall) => {
    calls.push(arguments_);
    const selected = implementations[Math.min(calls.length - 1, implementations.length - 1)];
    if (!selected) throw new Error('unexpected fetch');
    return selected(...arguments_);
  };
  return Object.assign(fetchMock, { calls }) as FetchMock;
};

function createClient(
  fetchImplementation: typeof fetch,
  overrides: ConfigOverrides = {},
  sleep: (milliseconds: number) => Promise<void> = async () => undefined
) {
  const config = { ...baseConfig, ...overrides } as PesdataClientConfig;
  if ('signatureSeed' in overrides && overrides.signatureSeed === undefined) {
    delete config.signatureSeed;
  }
  return new PesdataClient(
    config,
    {
      fetchImplementation,
      sleep,
      now: () => 1_798_000_000_000,
      nonce: () => 'fixednonce'
    }
  );
}

describe('PesdataClient', () => {
  it('signs and validates player list requests', async () => {
    const fetchImplementation = mockFetch(async () =>
      success({ list: [{ playerId: '42', playerName: 'Test player' }], count: 1 })
    );
    const client = createClient(fetchImplementation);

    await expect(client.listPlayers({ start: 0, limit: 2, order: 'DESC' })).resolves.toMatchObject({
      count: 1,
      list: [{ playerId: '42' }]
    });

    const [request, init] = fetchImplementation.calls[0] ?? [];
    expect(String(request)).toBe('https://authorized.example/api/player/list?limit=2&order=DESC&start=0');
    const headers = new Headers(init?.headers);
    expect(headers.get('version')).toBe('1.9.0');
    expect(headers.get('x-device-id')).toBe(baseConfig.deviceId);
    expect(headers.get('x-timestamp')).toBe('1798000000');
    expect(headers.get('x-nonce')).toBe('fixednonce');
    expect(headers.get('x-signature')).toMatch(/^[a-f0-9]{32}$/);
  });

  it('returns the only detail row and rejects ambiguous details', async () => {
    const client = createClient(mockFetch(async () => success([{ playerId: '42' }])));
    await expect(client.getPlayerDetail('42')).resolves.toMatchObject({ playerId: '42' });

    const ambiguous = createClient(
      mockFetch(async () => success([{ playerId: '42' }, { playerId: '43' }]))
    );
    await expect(ambiguous.getPlayerDetail('42')).rejects.toMatchObject({
      code: 'PESDATA_PROTOCOL_ERROR',
      endpoint: 'detail',
      attempts: 1
    });
  });

  it('retries 429 and transient server errors with bounded attempts', async () => {
    const sleepCalls: number[] = [];
    const sleep = async (milliseconds: number) => { sleepCalls.push(milliseconds); };
    const rateLimitedFetch = mockFetch([
      async () => new Response('', { status: 429 }),
      async () => success({ list: [], count: 0 })
    ]);

    await expect(createClient(rateLimitedFetch, {}, sleep).listPlayers({ start: 0, limit: 1, order: 'DESC' }))
      .resolves.toEqual({ list: [], count: 0 });
    expect(rateLimitedFetch.calls).toHaveLength(2);
    expect(sleepCalls.length).toBeGreaterThan(0);

    const unavailableFetch = mockFetch(async () => new Response('', { status: 500 }));
    await expect(
      createClient(unavailableFetch, { maxRetries: 2 }).listPlayers({ start: 0, limit: 1, order: 'DESC' })
    ).rejects.toMatchObject({ code: 'PESDATA_REQUEST_FAILED', status: 500, attempts: 3 });
    expect(unavailableFetch.calls).toHaveLength(3);
  });

  it.each([
    ['forbidden response', async () => new Response('', { status: 403 })],
    ['invalid payload', async () => success({ list: 'invalid', count: 1 })]
  ])('fails immediately for %s without exposing request secrets', async (_label, implementation) => {
    const fetchImplementation = mockFetch(implementation);

    try {
      await createClient(fetchImplementation).listPlayers({ start: 0, limit: 1, order: 'DESC' });
      throw new Error('expected protocol error');
    } catch (error) {
      expect(error).toBeInstanceOf(PesdataClientError);
      expect(error).toMatchObject({ code: 'PESDATA_PROTOCOL_ERROR', attempts: 1 });
      expect(JSON.stringify(error)).not.toContain('authorized-test-seed');
      expect(JSON.stringify(error)).not.toContain('X-Signature');
    }
  });

  it('requires locally configured signing material only when synchronization is invoked', async () => {
    const client = createClient(mockFetch(), { signatureSeed: undefined });
    await expect(client.listPlayers({ start: 0, limit: 1, order: 'DESC' })).rejects.toMatchObject({
      code: 'PESDATA_CONFIG_MISSING'
    });
  });

  it('uses the signed team league, list, and detail protocols', async () => {
    const fetchImplementation = mockFetch([
      async () => success({ list: [{ league_id: 'eredivisie', league_name: '荷甲' }], count: 1 }),
      async () => success({ list: [{ team_id: '42', team_name: 'Ajax' }], count: 1 }),
      async () => success({ team_id: '42', team: 'Ajax', team_cn: '阿贾克斯', team_logo: 'https://images.example/ajax.png' })
    ]);
    const client = createClient(fetchImplementation);

    await expect(client.listLeagues()).resolves.toEqual([{ leagueId: 'eredivisie', leagueName: '荷甲' }]);
    await expect(client.listTeams({ start: 0, limit: 10, order: 'ASC', leagueId: 'eredivisie' }))
      .resolves.toMatchObject({ count: 1, list: [{ teamId: '42' }] });
    await expect(client.getTeamDetail('42')).resolves.toMatchObject({ teamId: '42', teamLogo: 'https://images.example/ajax.png' });
    expect(fetchImplementation.calls.map(([request]) => new URL(String(request)).pathname)).toEqual([
      '/api/league/list', '/api/team/list', '/api/team/detail'
    ]);
    expect(new URL(String(fetchImplementation.calls[2]?.[0])).searchParams.get('team_id')).toBe('42');
  });
});
