import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminApi } from '../lib/api';
import { TeamShellActions } from './team-shell-actions';

const leagueId = '22222222-2222-4222-8222-222222222222';
const team = {
  id: '33333333-3333-4333-8333-333333333333', leagueId,
  ownerUserId: '44444444-4444-4444-8444-444444444444', ownerPublicUserNo: '000123', ownerDisplayName: '小宣',
  ownerAlias: 'tidus', catalogTeamId: '55555555-5555-4555-8555-555555555555', teamNumber: 3,
  name: '阿贾克斯', shortName: 'AJA', logoUrl: 'https://assets.example/ajax.png', status: 'ACTIVE' as const,
  rosterStatus: 'COMPLIANT' as const, activePlayerCount: 20, salaryTotalMinor: 100, salaryCapMinor: 200,
  shellValueMinor: 300, defaultGameAccountId: null, participatingSeasonCount: 1, version: 4,
  createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z'
};
const target = {
  ...team, id: '66666666-6666-4666-8666-666666666666', ownerUserId: '77777777-7777-4777-8777-777777777777',
  ownerPublicUserNo: '000456', ownerDisplayName: '老肥', ownerAlias: '老肥',
  catalogTeamId: '88888888-8888-4888-8888-888888888888', teamNumber: 8, name: '马德里竞技', shortName: 'ATM', version: 2
};
const replacement = {
  id: '99999999-9999-4999-8999-999999999999', sourceType: 'PESDATA' as const, sourceExternalId: 'rennes',
  sourceLeagueExternalId: 'ligue1', sourceLeagueName: '法甲', nameZh: '雷恩', nameEn: 'Rennes', nameJa: null,
  shortName: 'REN', remoteLogoUrl: null, storedLogoUrl: 'https://assets.example/rennes.png', status: 'ACTIVE' as const,
  sourceUpdatedAt: null, lastSyncedAt: null, createdAt: team.createdAt, updatedAt: team.updatedAt,
  isAssigned: false, assignedLeagueTeamId: null
};

function renderActions(request: ReturnType<typeof vi.fn>, onCompleted = vi.fn()) {
  const api: AdminApi = {
    restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined),
    request: request as AdminApi['request']
  };
  render(<TeamShellActions api={api} leagueId={leagueId} team={team} onCompleted={onCompleted} />);
  return { onCompleted };
}

describe('team shell actions', () => {
  it('explains transfer invariants and requires a source replacement shell', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/teams')) return { items: [team, target], nextCursor: null };
      if (path.startsWith('/v1/admin/team-catalog')) return { items: [replacement], nextCursor: null };
      throw new Error(`Unexpected request: ${path}`);
    });
    renderActions(request);

    await userEvent.click(screen.getByRole('button', { name: '转让队壳' }));
    expect(await screen.findByText(/阵容、财务、比赛成绩、球队编号、负责人和联赛称呼均保持不变/)).toBeInTheDocument();
    expect(screen.getByText('阿贾克斯（AJA）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认转让队壳' })).toBeDisabled();

    await userEvent.click(screen.getByRole('combobox', { name: '选择接收球队' }));
    await userEvent.click(await screen.findByText('8-马德里竞技（老肥）'));
    expect(screen.getByRole('button', { name: '确认转让队壳' })).toBeDisabled();
    await userEvent.click(await screen.findByRole('button', { name: '选择雷恩' }));
    expect(screen.getByRole('button', { name: '确认转让队壳' })).toBeEnabled();
  });

  it('submits a catalog-backed shell change with the current version', async () => {
    const request = vi.fn(async (path: string, options?: { method?: string }) => {
      if (path.startsWith('/v1/admin/team-catalog')) return { items: [replacement], nextCursor: null };
      if (options?.method === 'POST') return { updatedTeamIds: [team.id] };
      throw new Error(`Unexpected request: ${path}`);
    });
    const { onCompleted } = renderActions(request);
    await userEvent.click(screen.getByRole('button', { name: '更换队壳' }));
    await userEvent.click(await screen.findByRole('button', { name: '选择雷恩' }));
    expect(screen.getAllByText('雷恩')).not.toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: '确认更换队壳' }));

    await waitFor(() => expect(onCompleted).toHaveBeenCalled());
    expect(request).toHaveBeenLastCalledWith(
      `/v1/admin/leagues/${leagueId}/teams/${team.id}/shell/change`,
      expect.objectContaining({ method: 'POST', body: expect.objectContaining({ catalogTeamId: replacement.id, expectedVersion: 4 }) })
    );
  });
});
