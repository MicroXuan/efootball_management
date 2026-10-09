import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminApi } from '../lib/api';
import { AllocationPage } from './allocation-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const seasonId = '22222222-2222-4222-8222-222222222222';
const proposalId = '33333333-3333-4333-8333-333333333333';
const entryId = '44444444-4444-4444-8444-444444444444';
const rowId = '55555555-5555-4555-8555-555555555555';
const timestamp = '2026-10-03T00:00:00.000Z';
const season = {
  id: seasonId, leagueId, seasonNumber: 1, displayName: 'S1', previousSeasonId: null, isFirstSeason: true,
  registrationOpensAt: timestamp, registrationClosesAt: '2026-10-04T00:00:00.000Z',
  startsAt: '2026-10-05T00:00:00.000Z', endsAt: '2026-11-05T00:00:00.000Z',
  superCapacity: 23, championCapacity: 18, promotionCount: 4, status: 'ALLOCATION_REVIEW' as const,
  entryCount: 1, approvedEntryCount: 1, version: 3, createdAt: timestamp, updatedAt: timestamp
};
const proposal = {
  id: proposalId, seasonId, version: 1, status: 'DRAFT' as const, algorithmVersion: 'tiered-v1',
  randomSeed: 7, createdAt: timestamp, rows: [{
    id: rowId, proposalId, seasonEntryId: entryId, teamName: '上海海港', ownerDisplayName: '海港玩家',
    suggestedStageCode: 'CHAMPION_A', source: 'FIRST_SEASON' as const,
    previousRank: null, pointsPerMatch: null, goalDifferencePerMatch: null, goalsForPerMatch: null,
    tiePending: false, reason: '首赛季均分'
  }]
};

function renderPage(request: ReturnType<typeof vi.fn>) {
  render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/allocation`]}><Routes>
    <Route path="/leagues/:leagueId/allocation" element={<AllocationPage api={{ request } as unknown as AdminApi} />} />
  </Routes></MemoryRouter>);
}

it('shows the first-season champion-only hint and requires a reason for manual adjustment', async () => {
  const request = vi.fn(async (path: string) => {
    if (path.endsWith('/seasons')) return { items: [season], nextCursor: null };
    if (path.endsWith('/allocation-proposals/latest')) return proposal;
    throw new Error(`unexpected ${path}`);
  });
  renderPage(request);

  expect(await screen.findByText('首赛季仅设置冠军组，不创建超级组')).toBeInTheDocument();
  expect(screen.getByText('玩家：海港玩家')).toBeInTheDocument();
  expect(screen.queryByText('超级组')).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('上海海港最终组别'));
  await userEvent.click(await screen.findByText('冠军 B 组'));
  expect(screen.getByText('人工调整')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认正式分组' }));
  expect(await screen.findByText('人工调整组别时必须填写原因')).toBeInTheDocument();
});

it('confirms an adjusted group with its reason and shows formal stage counts', async () => {
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path.endsWith('/seasons')) return { items: [season], nextCursor: null };
    if (path.endsWith('/allocation-proposals/latest')) return proposal;
    if (path.endsWith('/allocation-decisions') && options?.method === 'POST') return {
      seasonId, competitionId: '66666666-6666-4666-8666-666666666666', stageCount: 1,
      participantCount: 1, status: 'READY', version: 4,
      stages: [{ id: '77777777-7777-4777-8777-777777777777', stageCode: 'CHAMPION_B', displayName: '冠军 B 组', participantCount: 1 }]
    };
    throw new Error(`unexpected ${path}`);
  });
  renderPage(request);
  await screen.findByText('首赛季仅设置冠军组，不创建超级组');
  await userEvent.click(screen.getByLabelText('上海海港最终组别'));
  await userEvent.click(await screen.findByText('冠军 B 组'));
  await userEvent.type(screen.getByLabelText('上海海港调整原因'), '平衡组别人数');
  await userEvent.click(screen.getByRole('button', { name: '确认正式分组' }));

  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/leagues/${leagueId}/seasons/${seasonId}/allocation-decisions`,
    expect.objectContaining({ body: expect.objectContaining({ overrides: [{
      seasonEntryId: entryId, targetStageCode: 'CHAMPION_B', reason: '平衡组别人数'
    }] }) })
  ));
  expect(await screen.findByText('1 支球队')).toBeInTheDocument();
});

it('restores confirmed stages after reload and advances the season version only on first publish', async () => {
  const stageA = '77777777-7777-4777-8777-777777777777';
  const stageB = '88888888-8888-4888-8888-888888888888';
  const confirmedProposal = {
    ...proposal,
    status: 'CONFIRMED' as const,
    confirmedAllocation: {
      competitionId: '66666666-6666-4666-8666-666666666666', seasonVersion: 4, seasonStatus: 'READY' as const,
      decisions: [{ seasonEntryId: entryId, finalStageCode: 'CHAMPION_B' as const, reason: '平衡组别人数' }],
      stages: [
        { id: stageA, stageCode: 'CHAMPION_A' as const, displayName: '冠军 A 组', participantCount: 10, matchCount: 45, status: 'DRAFT' as const, version: 2 },
        { id: stageB, stageCode: 'CHAMPION_B' as const, displayName: '冠军 B 组', participantCount: 9, matchCount: 36, status: 'DRAFT' as const, version: 2 },
      ],
    },
  };
  const request = vi.fn(async (path: string, options?: { method?: string; body?: Record<string, number> }) => {
    if (path.endsWith('/seasons')) return { items: [season], nextCursor: null };
    if (path.endsWith('/allocation-proposals/latest')) return confirmedProposal;
    if (path.endsWith('/schedule/publish') && options?.method === 'POST') return {
      id: path.includes(stageA) ? stageA : stageB,
      competitionId: confirmedProposal.confirmedAllocation.competitionId,
      status: 'PUBLISHED', version: 3, roundCount: 9, matchCount: path.includes(stageA) ? 45 : 36, matches: [],
    };
    throw new Error(`unexpected ${path}`);
  });
  renderPage(request);

  expect(await screen.findByText('10 支球队')).toBeInTheDocument();
  expect(screen.getByLabelText('上海海港调整原因')).toHaveValue('平衡组别人数');
  const publishButtons = screen.getAllByRole('button', { name: '发布赛程' });
  await userEvent.click(publishButtons[0]!);
  await waitFor(() => expect(request).toHaveBeenCalledWith(
    expect.stringContaining(stageA), expect.objectContaining({ body: { expectedStageVersion: 2, expectedSeasonVersion: 4 } })
  ));
  await userEvent.click(screen.getAllByRole('button', { name: '发布赛程' })[1]!);
  await waitFor(() => expect(request).toHaveBeenCalledWith(
    expect.stringContaining(stageB), expect.objectContaining({ body: { expectedStageVersion: 2, expectedSeasonVersion: 5 } })
  ));
});

it('shows the generated match preview instead of only updating the match count', async () => {
  const stageId = '77777777-7777-4777-8777-777777777777';
  const competitionId = '66666666-6666-4666-8666-666666666666';
  const confirmedProposal = {
    ...proposal,
    status: 'CONFIRMED' as const,
    confirmedAllocation: {
      competitionId, seasonVersion: 4, seasonStatus: 'READY' as const,
      decisions: [{ seasonEntryId: entryId, finalStageCode: 'CHAMPION_A' as const, reason: null }],
      stages: [{
        id: stageId, stageCode: 'CHAMPION_A' as const, displayName: '冠军 A 组',
        participantCount: 4, matchCount: 0, status: 'DRAFT' as const, version: 1
      }]
    }
  };
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path.endsWith('/seasons')) return { items: [season], nextCursor: null };
    if (path.endsWith('/allocation-proposals/latest')) return confirmedProposal;
    if (path.endsWith('/schedule/generate') && options?.method === 'POST') return {
      id: stageId, competitionId, status: 'DRAFT', version: 2, roundCount: 3, matchCount: 6,
      matches: [{
        id: '99999999-9999-4999-8999-999999999999', competitionId, stageId,
        roundNumber: 1, matchNumber: 1,
        homeParticipant: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: '布莱顿 蓝白', participantType: 'TEAM', teamLifecycleStatus: 'ACTIVE', teamLogoUrl: 'https://static.example.com/brighton.png', ownerDisplayName: '布莱顿玩家' },
        awayParticipant: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', displayName: '阿森纳', participantType: 'TEAM', teamLifecycleStatus: 'ACTIVE', teamLogoUrl: 'https://static.example.com/arsenal.png', ownerDisplayName: '阿森纳玩家' },
        plannedAt: null, status: 'SCHEDULED', version: 1, officialResult: null, resultVersions: [],
        createdAt: timestamp, updatedAt: timestamp, pairingKey: 'round-1-match-1'
      }]
    };
    throw new Error(`unexpected ${path}`);
  });
  renderPage(request);

  await userEvent.click(await screen.findByRole('button', { name: '生成预览' }));

  expect(await screen.findByText('赛程预览已生成，共 6 场')).toBeInTheDocument();
  expect(screen.getByText('第 1 轮')).toBeInTheDocument();
  expect(screen.getByText('布莱顿 蓝白')).toBeInTheDocument();
  expect(screen.getByText('阿森纳')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: '布莱顿 蓝白队徽' })).toHaveAttribute('src', 'https://static.example.com/brighton.png');
  expect(screen.getByRole('img', { name: '阿森纳队徽' })).toHaveAttribute('src', 'https://static.example.com/arsenal.png');
  expect(screen.getByText('玩家：布莱顿玩家')).toBeInTheDocument();
  expect(screen.getByText('玩家：阿森纳玩家')).toBeInTheDocument();
});

it('shows an actionable error when schedule preview generation fails', async () => {
  const stageId = '77777777-7777-4777-8777-777777777777';
  const confirmedProposal = {
    ...proposal,
    status: 'CONFIRMED' as const,
    confirmedAllocation: {
      competitionId: '66666666-6666-4666-8666-666666666666', seasonVersion: 4, seasonStatus: 'READY' as const,
      decisions: [{ seasonEntryId: entryId, finalStageCode: 'CHAMPION_A' as const, reason: null }],
      stages: [{
        id: stageId, stageCode: 'CHAMPION_A' as const, displayName: '冠军 A 组',
        participantCount: 4, matchCount: 0, status: 'DRAFT' as const, version: 1
      }]
    }
  };
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path.endsWith('/seasons')) return { items: [season], nextCursor: null };
    if (path.endsWith('/allocation-proposals/latest')) return confirmedProposal;
    if (path.endsWith('/schedule/generate') && options?.method === 'POST') throw new Error('network failed');
    throw new Error(`unexpected ${path}`);
  });
  renderPage(request);

  await userEvent.click(await screen.findByRole('button', { name: '生成预览' }));

  expect(await screen.findByText('生成赛程预览失败，请刷新后重试')).toBeInTheDocument();
});
