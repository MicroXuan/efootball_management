/** Browser-only fixtures: every /v1 request is intercepted; no database writes. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.EFM_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.EFM_MOBILE_BASE_URL || 'http://127.0.0.1:4187';
const output = process.env.EFM_MOBILE_OUTPUT || '/tmp/efm-mobile-verification';
await mkdir(output, { recursive: true });
const id = (n) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const leagueId = id(1), seasonId = id(2), competitionId = id(3), matchId = id(4);
const timestamp = '2026-10-27T12:00:00.000Z';
const admin = { id: id(9), username: 'mobile-admin', displayName: '联赛管理员', status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null, lastLoginAt: null, version: 1, createdAt: timestamp, updatedAt: timestamp };
const season = { id: seasonId, leagueId, seasonNumber: 1, displayName: 'S1 · 秋季联赛', previousSeasonId: null, isFirstSeason: true, registrationOpensAt: timestamp, registrationClosesAt: timestamp, startsAt: timestamp, endsAt: timestamp, superCapacity: 23, championCapacity: 18, promotionCount: 4, status: 'IN_PROGRESS', entryCount: 2, approvedEntryCount: 2, version: 1, createdAt: timestamp, updatedAt: timestamp };
const competition = { id: competitionId, seasonId, competitionType: 'DIVISION_LEAGUE', name: '秋季联赛', description: '', platform: 'MOBILE', serverRegion: 'CN', participantType: 'TEAM', format: 'ROUND_ROBIN', status: 'IN_PROGRESS', registrationOpensAt: timestamp, registrationClosesAt: timestamp, startsAt: timestamp, endsAt: timestamp, participantLimit: 24, participantCount: 2, version: 1, activeRuleVersion: 1, createdAt: timestamp, updatedAt: timestamp };
const participant = (n, name) => ({ id: id(n), displayName: name, participantType: 'TEAM', teamLifecycleStatus: 'ACTIVE', teamNumber: n, teamName: name, teamLogoUrl: null, ownerDisplayName: null });
const initialMatch = { id: matchId, competitionId, stageId: id(5), stageCode: 'SUPER', stageDisplayName: '超级组', roundNumber: 3, matchNumber: 1, homeParticipant: participant(7, '上海海港超级足球俱乐部'), awayParticipant: participant(8, '皇家马德里竞技联合队'), plannedAt: timestamp, status: 'SCHEDULED', version: 3, officialResult: null, resultVersions: [], createdAt: timestamp, updatedAt: timestamp };
const initialProposal = { id: id(10), leagueId, seasonId, ownershipId: id(11), playerName: '瓦拉内', sourceTeamId: id(7), sourceTeamName: '上海海港超级足球俱乐部', sourceTeamNumber: 7, targetTeamId: id(8), targetTeamName: '皇家马德里竞技联合队', targetTeamNumber: 8, initiatorTeamId: id(7), amountMinor: 15000, status: 'PENDING_ADMIN', reason: '双方已核对球员和价格', reviewReason: null, version: 2, createdAt: timestamp, reviewedAt: null, counterpartyConfirmed: true, events: [] };
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  for (const width of [320, 375, 390, 768]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    let match = structuredClone(initialMatch), proposal = structuredClone(initialProposal);
    const writes = [];
    await page.route('**/v1/**', async (route) => {
      const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
      let data;
      if (path.endsWith('/auth/login') || path.endsWith('/auth/refresh')) data = { accessToken: 'mock-only', refreshToken: 'mock-only-token-'.repeat(3), expiresInSeconds: 3600, refreshExpiresInSeconds: 7200, admin };
      else if (path.endsWith('/auth/me')) data = { admin, platformAdmin: false, leagueGrants: [{ leagueId, leagueName: '非概念实况联赛', role: 'LEAGUE_MANAGER' }] };
      else if (path.endsWith('/seasons')) data = { items: [season], nextCursor: null };
      else if (path === '/v1/competitions') data = { items: [competition], nextCursor: null };
      else if (path.endsWith('/matches')) data = [match];
      else if (path.endsWith('/results')) {
        const body = request.postDataJSON(); writes.push({ path, body, key: request.headers()['idempotency-key'] });
        data = { id: id(12), matchId, version: 1, homeScore: body.homeScore, awayScore: body.awayScore, status: 'OFFICIAL', submissionSide: 'MANAGER', submittedByMe: true, reason: body.reason, createdAt: timestamp };
        match = { ...match, version: 4, status: 'ADMIN_DECIDED', officialResult: { resultVersionId: data.id, version: 1, homeScore: body.homeScore, awayScore: body.awayScore, status: 'OFFICIAL' } };
      } else if (path.endsWith('/review')) {
        const body = request.postDataJSON(); writes.push({ path, body, key: request.headers()['idempotency-key'] });
        proposal = { ...proposal, status: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', reviewReason: body.reason, version: 3 }; data = proposal;
      } else if (path.endsWith('/transfer-proposals')) data = { items: [proposal] };
      else { errors.push(`Unexpected API route: ${path}`); await route.fulfill({ status: 500, json: {} }); return; }
      await route.fulfill({ json: data });
    });
    // Exercise unauthenticated deep link and return after login.
    await page.goto(`${base}/mobile/${leagueId}/matches`);
    await page.getByLabel('管理员账号').fill('mobile-admin');
    await page.getByLabel('密码', { exact: true }).fill('mock-password');
    await page.getByRole('button', { name: '登录后台' }).click();
    await page.getByRole('button', { name: '录入比分', exact: true }).waitFor();
    async function checkBounds(label) {
      const faults = await page.evaluate(() => {
        const bad = [];
        if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('page overflow');
        for (const element of document.querySelectorAll('.mobile-workbench button, .mobile-workbench input, .mobile-workbench select, .mobile-bottom-nav a, .mobile-modal input, .mobile-modal textarea, .mobile-modal .ant-btn')) {
          const r = element.getBoundingClientRect(); if (!r.width) continue;
          if (r.left < -1 || r.right > innerWidth + 1) bad.push(`viewport: ${element.textContent || element.getAttribute('aria-label')}`);
          const parent = element.closest('.mobile-match-card, .mobile-transfer-card, .mobile-segments, .mobile-bottom-nav, .mobile-editor');
          if (parent) { const p = parent.getBoundingClientRect(); const style = getComputedStyle(parent); if (r.left < p.left + parseFloat(style.paddingLeft) - 1 || r.right > p.right - parseFloat(style.paddingRight) + 1) bad.push(`container: ${element.textContent}`); }
        }
        for (const group of document.querySelectorAll('.mobile-segments, .mobile-bottom-nav')) {
          const children = [...group.children].map((e) => e.getBoundingClientRect());
          if (Math.max(...children.map((r) => r.width)) - Math.min(...children.map((r) => r.width)) > 1) bad.push('unequal segment widths');
          children.slice(1).forEach((r, i) => { if (r.left < children[i].right) bad.push('overlapping segments'); });
        }
        return bad;
      });
      assert.deepEqual(faults, [], `${width}px ${label}: ${faults.join(', ')}`);
    }
    await checkBounds('matches');
    assert.ok(await page.getByLabel('轮次', { exact: true }).evaluate((element) => { const style = getComputedStyle(element); const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); ctx.font = style.font; return ctx.measureText(element.selectedOptions[0].text).width <= element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight); }), 'selected round label must fit');
    await page.screenshot({ path: `${output}/matches-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '录入比分', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '核对比分' }).isDisabled(), true);
    await checkBounds('disabled score editor');
    await page.getByLabel('主队比分').fill('3'); await page.getByLabel('客队比分').fill('1'); await page.getByLabel('录入或修正原因').fill('双方已确认');
    await page.getByRole('button', { name: '核对比分' }).click();
    await checkBounds('score confirmation');
    await page.screenshot({ path: `${output}/score-${width}.png`, fullPage: true, animations: 'disabled' });
    assert.equal(writes.length, 0);
    await page.getByRole('button', { name: '确认提交比分' }).click();
    await page.getByRole('button', { name: '修正比分' }).waitFor();
    assert.equal(writes.length, 1); assert.equal(writes[0].body.expectedVersion, 3); assert.ok(writes[0].key);
    await page.getByRole('link', { name: '转会审核', exact: true }).click();
    await page.getByRole('button', { name: '查看并审核' }).waitFor();
    await checkBounds('transfers');
    await page.getByRole('button', { name: '查看并审核' }).click();
    assert.equal(await page.getByRole('button', { name: '确认批准转会' }).isDisabled(), true);
    await page.getByLabel('审核理由').fill('双方已确认，符合联赛规则');
    await page.getByRole('dialog').evaluate(async (element) => { await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))); });
    await checkBounds('transfer approval');
    await page.screenshot({ path: `${output}/transfer-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: '确认批准转会' }).click();
    await page.getByText('当前没有符合条件的转会申请。').waitFor();
    assert.equal(writes.length, 2); assert.equal(writes[1].body.expectedVersion, 2);
    await page.getByRole('link', { name: '工作台', exact: true }).click();
    await page.getByText('此赛季已发布比赛的比分均已录入。').waitFor();
    await checkBounds('home');
    await page.screenshot({ path: `${output}/home-${width}.png`, fullPage: true, animations: 'disabled' });
    await context.close();
    console.log(`${width}px: login, navigation, score, transfer, refresh and bounds passed`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
