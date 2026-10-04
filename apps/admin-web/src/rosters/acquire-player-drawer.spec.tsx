import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminApi } from '../lib/api';
import { ApiError } from '../lib/api';
import { AcquirePlayerDrawer } from './acquire-player-drawer';

const leagueId = '11111111-1111-4111-8111-111111111111';
const teamId = '22222222-2222-4222-8222-222222222222';
const seasonId = '33333333-3333-4333-8333-333333333333';
const playerId = '44444444-4444-4444-8444-444444444444';
const bestCardId = '55555555-5555-4555-8555-555555555555';
const otherCardId = '66666666-6666-4666-8666-666666666666';

function api(request: AdminApi['request']): AdminApi {
  return { restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request };
}

const candidate = {
  playerId, playerName: '博努奇', ownedByTeamId: null, recommendedPlayerCardId: bestCardId,
  cards: [
    { id: bestCardId, cardName: 'Epic', imageUrl: null, position: 'CB' as const, overallRating: 87, maxOverall: 99, dtRating: 98, salaryMinor: 700, recommended: true },
    { id: otherCardId, cardName: 'Highlight', imageUrl: null, position: 'CB' as const, overallRating: 86, maxOverall: 97, dtRating: 96, salaryMinor: 500, recommended: false }
  ]
};

describe('acquire player drawer', () => {
  it('sends position, card type, and pack filters and shows an explicit empty result', async () => {
    const request = vi.fn(async (path: string) => path === '/v1/card-packs?limit=100'
      ? { items: [{ id: '77777777-7777-4777-8777-777777777777', nameZh: '每周精选', nameEn: null, season: null, releaseDate: null, coverUrl: null, cardCount: 11 }], nextCursor: null, releaseSequence: 1 }
      : { items: [] });
    render(<AcquirePlayerDrawer open leagueId={leagueId} teamId={teamId} seasonId={seasonId} api={api(request as unknown as AdminApi['request'])} summary={{ rosterCount: 2, salaryMinor: 400, salaryCapMinor: 2000 }} onClose={vi.fn()} onCompleted={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('搜索球员'), '梅西');
    await userEvent.click(screen.getByRole('combobox', { name: '位置' }));
    await userEvent.click(await screen.findByText('前腰'));
    await userEvent.click(screen.getByRole('combobox', { name: '卡种' }));
    await userEvent.click(await screen.findByText('史诗'));
    await userEvent.click(screen.getByRole('combobox', { name: '球员包' }));
    await userEvent.click(await screen.findByText('每周精选'));
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));

    await waitFor(() => expect(request).toHaveBeenCalledWith(
      `/v1/admin/roster/leagues/${leagueId}/player-candidates?keyword=%E6%A2%85%E8%A5%BF&position=AMF&cardType=EPIC&cardPackId=77777777-7777-4777-8777-777777777777`,
      expect.anything(),
    ));
    expect(await screen.findByText('没有符合筛选条件的球员')).toBeInTheDocument();
  });

  it('selects the recommended best card but lets the manager inspect all cards', async () => {
    const request = vi.fn().mockResolvedValue({ items: [candidate] });
    render(<AcquirePlayerDrawer open leagueId={leagueId} teamId={teamId} seasonId={seasonId} api={api(request)} summary={{ rosterCount: 2, salaryMinor: 400, salaryCapMinor: 2000 }} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('搜索球员'), '博努奇');
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('系统推荐')).toBeInTheDocument();
    expect(screen.getByLabelText('Epic')).toBeChecked();
    expect(screen.getByText('Highlight')).toBeInTheDocument();
  });

  it('blocks a card without a DT rating', async () => {
    const request = vi.fn().mockResolvedValue({ items: [{ ...candidate, recommendedPlayerCardId: otherCardId, cards: [{ ...candidate.cards[1], id: otherCardId, dtRating: null, recommended: true }] }] });
    render(<AcquirePlayerDrawer open leagueId={leagueId} teamId={teamId} seasonId={seasonId} api={api(request)} summary={{ rosterCount: 2, salaryMinor: 400, salaryCapMinor: 2000 }} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('搜索球员'), '博努奇');
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByText('缺少 DT 能力值，不能加入阵容')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认购买' })).toBeDisabled();
  });

  it('shows current roster and salary limits for business failures', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: null, releaseSequence: 1 })
      .mockResolvedValueOnce({ items: [candidate] })
      .mockRejectedValueOnce(new ApiError({ status: 409, code: 'TEAM_ROSTER_FULL' }));
    render(<AcquirePlayerDrawer open leagueId={leagueId} teamId={teamId} seasonId={seasonId} api={api(request)} summary={{ rosterCount: 25, salaryMinor: 1900, salaryCapMinor: 2000 }} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('搜索球员'), '博努奇');
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));
    await userEvent.type(screen.getByLabelText('成交金额'), '100');
    await userEvent.type(screen.getByLabelText('操作原因'), '首发补强');
    await userEvent.click(screen.getByRole('button', { name: '确认购买' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('阵容人数 25/25');
    expect(screen.getByRole('alert')).toHaveTextContent('工资 1900/2000');
  });

  it('reuses the idempotency key when an unchanged submission is retried', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: null, releaseSequence: 1 })
      .mockResolvedValueOnce({ items: [candidate] })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'));
    render(<AcquirePlayerDrawer open leagueId={leagueId} teamId={teamId} seasonId={seasonId} api={api(request)} summary={{ rosterCount: 2, salaryMinor: 400, salaryCapMinor: 2000 }} onClose={vi.fn()} onCompleted={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('搜索球员'), '博努奇');
    await userEvent.click(screen.getByRole('button', { name: '搜索' }));
    await userEvent.type(screen.getByLabelText('成交金额'), '100');
    await userEvent.type(screen.getByLabelText('操作原因'), '首发补强');
    await userEvent.click(screen.getByRole('button', { name: '确认购买' }));
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: '确认购买' }));
    await waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    expect(request.mock.calls[2]?.[1]?.body.idempotencyKey).toBe(request.mock.calls[3]?.[1]?.body.idempotencyKey);
  });
});
