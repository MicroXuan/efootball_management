import { describe, expect, it } from 'vitest';
import { leagueNavigationItems, resolveLeagueNavigation } from './league-navigation';

describe('resolveLeagueNavigation', () => {
  it.each([
    ['/leagues/l1/teams/t1/roster', 'teams', null],
    ['/leagues/l1/nomination-windows/w1/candidates', 'windows', 'nomination-windows'],
    ['/leagues/l1/auctions/b1/edit', 'auctions', null],
    ['/leagues/l1/transfer-proposals', 'reviews', 'transfer-proposals'],
    ['/leagues/l1/salary-rules', 'finance', 'salary-rules'],
    ['/leagues/l1/something-new', 'teams', null],
  ])('maps %s to %s / %s', (pathname, topKey, childKey) => {
    expect(resolveLeagueNavigation(pathname)).toEqual({ topKey, childKey });
  });

  it('does not mistake a route segment embedded in an ID for a navigation route', () => {
    expect(resolveLeagueNavigation('/leagues/l1/teams/transfer-proposals/roster')).toEqual({ topKey: 'teams', childKey: null });
  });
});

describe('leagueNavigationItems', () => {
  it('keeps competition pages separate and groups existing window, review and finance routes', () => {
    const items = leagueNavigationItems('l1', false);
    expect(items.map(({ key }) => key)).toEqual(['teams', 'seasons', 'allocation', 'cups', 'windows', 'reviews', 'finance', 'auctions']);
    expect(items.find(({ key }) => key === 'allocation')?.path).toBe('/leagues/l1/allocation');
    expect(items.find(({ key }) => key === 'cups')?.path).toBe('/leagues/l1/cups');
    expect(items.find(({ key }) => key === 'windows')?.children?.map(({ key }) => key)).toEqual([
      'transfer-windows', 'valuation-windows', 'nomination-windows',
    ]);
    expect(items.find(({ key }) => key === 'reviews')?.children?.map(({ key }) => key)).toEqual([
      'player-market', 'valuation-reviews', 'disappearance-requests', 'transfer-proposals',
    ]);
    expect(items.find(({ key }) => key === 'finance')?.children?.map(({ key }) => key)).toEqual(['salary-rules', 'ledger']);
  });

  it('includes the optional bot only when enabled', () => {
    expect(leagueNavigationItems('l1', true).at(-1)).toMatchObject({
      key: 'more', path: '/leagues/l1/wechat-bot',
      children: [{ key: 'wechat-bot', path: '/leagues/l1/wechat-bot' }],
    });
    expect(leagueNavigationItems('l1', false).some(({ key }) => key === 'more')).toBe(false);
  });
});
