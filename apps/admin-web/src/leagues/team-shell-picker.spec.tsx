import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminApi } from '../lib/api';
import { TeamShellPicker } from './team-shell-picker';

const leagueId = '22222222-2222-4222-8222-222222222222';
const catalogTeamId = '33333333-3333-4333-8333-333333333333';

const ajax = {
  id: catalogTeamId,
  sourceType: 'PESDATA' as const,
  sourceExternalId: 'ajax',
  sourceLeagueExternalId: 'eredivisie',
  sourceLeagueName: '荷兰足球甲级联赛',
  nameZh: '阿贾克斯',
  nameEn: 'Ajax',
  nameJa: null,
  shortName: 'AJA',
  remoteLogoUrl: 'https://source.invalid/ajax.png',
  storedLogoUrl: 'https://assets.example/ajax.png',
  status: 'ACTIVE' as const,
  sourceUpdatedAt: null,
  lastSyncedAt: '2026-10-06T00:00:00.000Z',
  createdAt: '2026-10-06T00:00:00.000Z',
  updatedAt: '2026-10-06T00:00:00.000Z',
  isAssigned: false,
  assignedLeagueTeamId: null
};

function renderPicker(request: AdminApi['request'], onChange = vi.fn()) {
  const api: AdminApi = {
    restore: vi.fn(), login: vi.fn(), logout: vi.fn(), onSessionExpired: vi.fn().mockReturnValue(() => undefined), request
  };
  render(<TeamShellPicker api={api} leagueId={leagueId} value={null} onChange={onChange} />);
  return { onChange };
}

describe('team shell picker', () => {
  it('searches the local catalog and selects the stored crest', async () => {
    const request = vi.fn().mockResolvedValue({ items: [ajax], nextCursor: null });
    const { onChange } = renderPicker(request);

    expect(await screen.findByRole('img', { name: '阿贾克斯队徽' })).toHaveAttribute('src', ajax.storedLogoUrl);
    await userEvent.clear(screen.getByRole('textbox', { name: '搜索队壳' }));
    await userEvent.type(screen.getByRole('textbox', { name: '搜索队壳' }), '阿贾克斯');
    await userEvent.type(screen.getByLabelText('来源联赛'), '荷甲');
    await userEvent.click(screen.getByRole('button', { name: '搜索队壳' }));

    await waitFor(() => expect(request).toHaveBeenLastCalledWith(
      `/v1/admin/team-catalog?leagueId=${leagueId}&keyword=${encodeURIComponent('阿贾克斯')}&sourceLeagueName=${encodeURIComponent('荷甲')}`,
      expect.any(Object)
    ));
    expect(request.mock.calls.flatMap((call) => call[0])).not.toContain('pesdata');

    await userEvent.click(screen.getByRole('button', { name: '选择阿贾克斯' }));
    expect(onChange).toHaveBeenCalledWith(catalogTeamId);
  });

  it('marks occupied shells unavailable and offers retry after a load error', async () => {
    const occupied = { ...ajax, isAssigned: true, assignedLeagueTeamId: '44444444-4444-4444-8444-444444444444' };
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [occupied], nextCursor: null });
    renderPicker(request);

    expect(await screen.findByRole('alert')).toHaveTextContent('队壳目录加载失败');
    await userEvent.click(screen.getByRole('button', { name: '重新加载队壳' }));
    expect(await screen.findByText('本联赛已使用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择阿贾克斯' })).toBeDisabled();
  });
});
