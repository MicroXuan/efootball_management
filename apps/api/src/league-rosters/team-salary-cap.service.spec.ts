import { jest } from '@jest/globals';
import { TeamSalaryCapService } from './team-salary-cap.service.js';

describe('TeamSalaryCapService', () => {
  const service = new TeamSalaryCapService();

  it('returns a configured team cap, including a legacy unconfirmed cap', async () => {
    const client = {
      leagueTeam: { findUnique: jest.fn<() => Promise<{ salaryCapMinor: number }>>().mockResolvedValue({ salaryCapMinor: 14_000 }) }
    };

    await expect(service.requireWithClient(client as never, 'team-1')).resolves.toBe(14_000);
    expect(client.leagueTeam.findUnique).toHaveBeenCalledWith({
      where: { id: 'team-1' },
      select: { salaryCapMinor: true }
    });
  });

  it('blocks a team with no configured salary cap', async () => {
    const client = {
      leagueTeam: { findUnique: jest.fn<() => Promise<{ salaryCapMinor: null }>>().mockResolvedValue({ salaryCapMinor: null }) }
    };

    await expect(service.requireWithClient(client as never, 'team-2')).rejects.toMatchObject({
      code: 'TEAM_SALARY_CAP_UNSET'
    });
  });

  it('permits a nullable cap read for salary-reducing operations', async () => {
    const client = {
      leagueTeam: { findUnique: jest.fn<() => Promise<{ salaryCapMinor: null }>>().mockResolvedValue({ salaryCapMinor: null }) }
    };

    await expect(service.readWithClient(client as never, 'team-2')).resolves.toBeNull();
  });
});
