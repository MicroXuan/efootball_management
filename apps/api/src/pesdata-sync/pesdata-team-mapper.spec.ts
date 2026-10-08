import { mapPesdataTeam } from './pesdata-team-mapper.js';
import { PesdataTeamSchema } from './pesdata-team.schemas.js';

describe('PESDATA team protocol and mapper', () => {
  it('accepts multilingual team metadata, tolerates unknown fields, and prefers Chinese for a derived short name', () => {
    const raw = PesdataTeamSchema.parse({
      team_id: 42,
      league_id: 'eredivisie',
      league_name: '荷兰足球甲级联赛',
      team_name: 'Ajax',
      team_name_zh: '阿贾克斯足球俱乐部',
      team_name_jp: 'アヤックス',
      team_logo: 'https://images.pesdata.example/ajax.png',
      updated_at: '2026-10-01T00:00:00.000Z',
      ignored: 'future field'
    });

    expect(mapPesdataTeam(raw)).toEqual(expect.objectContaining({
      sourceExternalId: '42',
      sourceLeagueExternalId: 'eredivisie',
      sourceLeagueName: '荷兰足球甲级联赛',
      nameZh: '阿贾克斯足球俱乐部',
      nameEn: 'Ajax',
      nameJa: 'アヤックス',
      shortName: '阿贾克斯足球俱乐部',
      remoteLogoUrl: 'https://images.pesdata.example/ajax.png'
    }));
  });

  it('falls back from English to Japanese and rejects rows without an identifier or name', () => {
    const japanese = PesdataTeamSchema.parse({ team_id: 'jp-1', team_name_jp: '横浜Ｆ・マリノス' });
    expect(mapPesdataTeam(japanese).shortName).toBe('横浜Ｆ・マリノス');
    expect(() => PesdataTeamSchema.parse({ team_name: 'Missing id' })).toThrow();
    expect(() => PesdataTeamSchema.parse({ team_id: 'missing-name' })).toThrow();
  });

  it('accepts the current PESDATA team and nested league field names', () => {
    const raw = PesdataTeamSchema.parse({
      team_id: 2067,
      team: 'Aarhus HB',
      team_cn: '奥胡斯 蓝白',
      team_ja: 'オーフス HB',
      team_logo: 'https://img.pesdata.net/images/team/e_002067_r.webp',
      league_id: 549,
      created_at: '2026-09-10',
      league: {
        League_id: 549,
        League: 'Danish League',
        League_cn: '丹麦联赛',
        League_ja: 'デンマークリーグ'
      }
    });

    expect(mapPesdataTeam(raw)).toEqual(expect.objectContaining({
      sourceExternalId: '2067',
      sourceLeagueExternalId: '549',
      sourceLeagueName: '丹麦联赛',
      nameZh: '奥胡斯 蓝白',
      nameEn: 'Aarhus HB',
      nameJa: 'オーフス HB'
    }));
  });
});
