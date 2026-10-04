import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { ApiError } from '../lib/api';
import { CupsPage } from './cups-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const seasonId = '22222222-2222-4222-8222-222222222222';
const cupId = '33333333-3333-4333-8333-333333333333';
const proposalId = '44444444-4444-4444-8444-444444444444';
const timestamp = '2026-10-03T00:00:00.000Z';
const season = {
  id: seasonId, leagueId, seasonNumber: 3, displayName: 'S3', previousSeasonId: null, isFirstSeason: false,
  registrationOpensAt: timestamp, registrationClosesAt: '2026-10-04T00:00:00.000Z',
  startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-11-05T00:00:00.000Z',
  superCapacity: 23, championCapacity: 18, promotionCount: 4, status: 'IN_PROGRESS' as const,
  entryCount: 12, approvedEntryCount: 12, version: 3, createdAt: timestamp, updatedAt: timestamp
};
const cup = {
  id: cupId, seasonId, name: 'S3 足总杯', description: '赛季杯赛',
  competitionType: 'KNOCKOUT_CUP' as const, format: 'SINGLE_ELIMINATION' as const,
  status: 'IN_PROGRESS' as const, registrationOpensAt: timestamp,
  registrationClosesAt: '2026-10-04T00:00:00.000Z', startsAt: '2026-10-05T00:00:00.000Z',
  endsAt: '2026-11-05T00:00:00.000Z', participantLimit: 16, participantCount: 12,
  targetGroupSize: null, qualifiersPerGroup: null, version: 4
};
const bracket = {
  competitionId: cupId, proposalId, proposalVersion: 1, proposalStatus: 'CONFIRMED' as const,
  bracketSize: 16, currentRoundNumber: 1,
  rounds: [{
    stageId: '55555555-5555-4555-8555-555555555555', roundNumber: 1,
    stageCode: 'ROUND_OF_16', displayName: '16 强', status: 'PUBLISHED' as const,
    pairings: [{
      id: '66666666-6666-4666-8666-666666666666', pairingNumber: 1,
      homeParticipant: { id: '77777777-7777-4777-8777-777777777777', displayName: '上海海港' },
      awayParticipant: { id: '88888888-8888-4888-8888-888888888888', displayName: '北京国安' },
      winnerParticipant: null, isBye: false,
      match: { id: '99999999-9999-4999-8999-999999999999', status: 'AWAITING_RESULT' as const, homeScore: null, awayScore: null }
    }]
  }]
};

it('shows season cups and opens a readable knockout rail', async () => {
  const request = vi.fn(async (path: string) => {
    if (path.endsWith('/seasons')) return { items: [season], nextCursor: null };
    if (path.endsWith(`/seasons/${seasonId}/cups`)) return { items: [cup] };
    if (path.endsWith(`/cups/${cupId}/bracket`)) return bracket;
    throw new Error(`unexpected ${path}`);
  });
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/cups`]}><Routes>
    <Route path="/leagues/:leagueId/cups" element={<CupsPage api={{ request } as unknown as AdminApi} />} />
  </Routes></MemoryRouter>);

  expect(await screen.findByText('S3 足总杯')).toBeInTheDocument();
  expect(screen.getByText('12 / 16')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '查看签表' }));
  expect(await screen.findByText('16 强')).toBeInTheDocument();
  expect(screen.getByText('上海海港')).toBeInTheDocument();
  expect(screen.getByText('北京国安')).toBeInTheDocument();
  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/leagues/${leagueId}/seasons/${seasonId}/cups/${cupId}/bracket`,
    expect.any(Object)
  ));
});

it('creates a pure knockout cup with a complete timeline', async () => {
  const request = vi.fn(async (path: string, options?: { method?: string; body?: unknown; headers?: HeadersInit }) => {
    if (path.endsWith('/seasons')) return { items: [season], nextCursor: null };
    if (path.endsWith(`/seasons/${seasonId}/cups`) && options?.method === 'POST') return cup;
    if (path.endsWith(`/seasons/${seasonId}/cups`)) return { items: [] };
    throw new Error(`unexpected ${path}`);
  });
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/cups`]}><Routes>
    <Route path="/leagues/:leagueId/cups" element={<CupsPage api={{ request } as unknown as AdminApi} />} />
  </Routes></MemoryRouter>);

  await screen.findByText('当前赛季还没有杯赛');
  await userEvent.click(screen.getByRole('button', { name: '新建杯赛' }));
  await userEvent.type(screen.getByLabelText('杯赛名称'), 'S3 足总杯');
  fireEvent.change(screen.getByLabelText('报名开始'), { target: { value: '2026-10-03T09:00' } });
  fireEvent.change(screen.getByLabelText('报名截止'), { target: { value: '2026-10-04T09:00' } });
  fireEvent.change(screen.getByLabelText('开赛时间'), { target: { value: '2026-10-05T09:00' } });
  fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-11-05T09:00' } });
  await userEvent.click(screen.getByRole('button', { name: '创建杯赛' }));

  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/leagues/${leagueId}/seasons/${seasonId}/cups`,
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }),
      body: expect.objectContaining({
        seasonId,
        name: 'S3 足总杯',
        competitionType: 'KNOCKOUT_CUP',
        format: 'SINGLE_ELIMINATION',
        participantLimit: 16,
        targetGroupSize: null,
        qualifiersPerGroup: null
      })
    })
  ));
});

it('generates a draft bracket and requires explicit confirmation before publishing it', async () => {
  const closedCup = { ...cup, status: 'REGISTRATION_CLOSED' as const };
  const draftBracket = { ...bracket, proposalStatus: 'DRAFT' as const, rounds: bracket.rounds.map((round) => ({ ...round, status: 'DRAFT' as const })) };
  let bracketReads = 0;
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path.endsWith('/seasons')) return { items: [season], nextCursor: null };
    if (path.endsWith(`/seasons/${seasonId}/cups`) && !options?.method) return { items: [closedCup] };
    if (path.endsWith(`/cups/${cupId}/bracket-proposals`)) return { id: proposalId };
    if (path.endsWith(`/cups/${cupId}/bracket-decisions`)) return { id: proposalId };
    if (path.endsWith(`/cups/${cupId}/bracket`)) {
      bracketReads += 1;
      if (bracketReads === 1) throw new ApiError({ status: 404, code: 'CUP_BRACKET_NOT_FOUND' });
      return draftBracket;
    }
    throw new Error(`unexpected ${path}`);
  });
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/cups`]}><Routes>
    <Route path="/leagues/:leagueId/cups" element={<CupsPage api={{ request } as unknown as AdminApi} />} />
  </Routes></MemoryRouter>);

  await screen.findByText('S3 足总杯');
  await userEvent.click(screen.getByRole('button', { name: '查看签表' }));
  expect(await screen.findByText('该杯赛尚未生成淘汰签表')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '生成签表建议' }));
  expect(await screen.findByText('签表建议 · 尚未发布')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认并发布签表' }));

  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/leagues/${leagueId}/seasons/${seasonId}/cups/${cupId}/bracket-decisions`,
    expect.objectContaining({
      method: 'POST',
      body: { proposalId, expectedCompetitionVersion: closedCup.version }
    })
  ));
});
