import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError, type AdminApi } from '../lib/api';
import { ResultDisputesPage } from './result-disputes-page';

const leagueId = '11111111-1111-4111-8111-111111111111';
const disputeId = '22222222-2222-4222-8222-222222222222';
const matchId = '33333333-3333-4333-8333-333333333333';
const at = '2026-10-15T12:00:00.000Z';
const row = {
  id: disputeId, matchId, triggerResultVersionId: '44444444-4444-4444-8444-444444444444',
  trigger: 'REJECTED', status: 'READY_FOR_REVIEW', openedByUserId: '55555555-5555-4555-8555-555555555555',
  evidenceDeadlineAt: at, decidedByAdminId: null, decisionType: null, finalHomeScore: null,
  finalAwayScore: null, decisionReason: null, decidedAt: null, version: 2, matchVersion: 7,
  createdAt: at, updatedAt: at, missingRoles: ['OPPONENT'], evidence: [], timeline: []
};
const detail = { ...row, evidence: [], timeline: [
  { id: '66666666-6666-4666-8666-666666666666', matchId, disputeId: null,
    resultVersionId: row.triggerResultVersionId, type: 'RESULT_SUBMITTED', actorType: 'USER',
    actorUserId: row.openedByUserId, actorAdminId: null, metadata: { homeScore: 2, awayScore: 1 }, occurredAt: at },
  { id: '77777777-7777-4777-8777-777777777777', matchId, disputeId,
    resultVersionId: row.triggerResultVersionId, type: 'RESULT_REJECTED', actorType: 'USER',
    actorUserId: row.openedByUserId, actorAdminId: null, metadata: { reason: '比分有误' }, occurredAt: at }
] };

function renderPage(request: AdminApi['request'], extra: Partial<AdminApi> = {}) {
  return render(<MemoryRouter initialEntries={[`/leagues/${leagueId}/result-disputes`]}>
    <Link to="/leagues/league-b/result-disputes">League B</Link><Routes>
    <Route path="/leagues/:leagueId/result-disputes" element={<ResultDisputesPage api={{ request, ...extra } as AdminApi} />} />
  </Routes></MemoryRouter>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it('ignores a previous league queue response after navigation', async () => {
  const pending = deferred<unknown>();
  const request = vi.fn(async (path: string) => {
    if (path.includes('/league-b/')) return path.endsWith('/workspace')
      ? { id: 'league-b', resultEvidenceRequired: false, version: 4 } : [];
    if (path.endsWith('/workspace')) return pending.promise;
    return [row];
  }) as unknown as AdminApi['request'];
  renderPage(request);
  await userEvent.click(screen.getByRole('link', { name: 'League B' }));
  await screen.findByText('当前没有争议。新争议会出现在这里。');
  await act(async () => { pending.resolve({ id: leagueId, resultEvidenceRequired: true, version: 3 }); });
  expect(screen.queryByRole('button', { name: /查看争议/ })).not.toBeInTheDocument();
  expect(screen.getByRole('switch', { name: '强制比分截图' })).not.toBeChecked();
});

it.each(['visible', 'pending'] as const)('clears %s private evidence and ignores a pending toggle on league navigation', async (previewState) => {
  const toggle = deferred<unknown>();
  const transfer = deferred<Blob>();
  const nextLeague = deferred<unknown>();
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path.includes('/league-b/')) return path.endsWith('/workspace') ? nextLeague.promise : [];
    if (path.endsWith('/workspace')) return options?.method === 'PATCH' ? toggle.promise
      : { id: leagueId, resultEvidenceRequired: false, version: 3 };
    if (path.endsWith('/result-disputes')) return [row];
    if (path.endsWith('/read-url')) return { url: 'https://private.test/evidence', expiresAt: at };
    return { ...detail, evidence: [{ id: 'proof-a', role: 'SUBMITTER', status: 'ACTIVE',
      mimeType: 'image/png', byteSize: 10, createdAt: at }] };
  }) as unknown as AdminApi['request'];
  const create = vi.fn(() => 'blob:league-a');
  const revoke = vi.fn();
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = create;
  URL.revokeObjectURL = revoke;
  const transferEvidence = vi.fn(() => transfer.promise);
  try {
    renderPage(request, { transferEvidence });
    await userEvent.click(await screen.findByRole('button', { name: /查看争议/ }));
    await userEvent.click(await screen.findByRole('button', { name: '预览证据' }));
    await waitFor(() => expect(transferEvidence).toHaveBeenCalled());
    if (previewState === 'visible') {
      await act(async () => { transfer.resolve(new Blob(['private'])); });
      await screen.findByRole('img', { name: '争议证据预览' });
    }
    await userEvent.click(screen.getByRole('switch', { name: '强制比分截图' }));
    await userEvent.click(screen.getByRole('link', { name: 'League B' }));
    expect(screen.getByRole('switch', { name: '强制比分截图' })).toBeDisabled();
    await act(async () => {
      toggle.resolve({ id: leagueId, resultEvidenceRequired: true, version: 4 });
      transfer.resolve(new Blob(['private']));
      nextLeague.resolve({ id: 'league-b', resultEvidenceRequired: false, version: 8 });
    });
    expect(screen.queryByRole('img', { name: '争议证据预览' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '裁决原因' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '强制比分截图' })).not.toBeChecked();
    expect(screen.queryByText('已开启每场比分截图要求。')).not.toBeInTheDocument();
    expect(revoke).toHaveBeenCalledWith('blob:league-a');
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

it.each(['detail', 'resolution-success', 'resolution-conflict'] as const)('ignores a pending %s after changing leagues', async (operation) => {
  const pending = deferred<unknown>();
  const request = vi.fn(async (path: string) => {
    if (path.includes('/league-b/')) return path.endsWith('/workspace')
      ? { id: 'league-b', resultEvidenceRequired: false, version: 4 } : [];
    if (path.endsWith('/workspace')) return { id: leagueId, resultEvidenceRequired: false, version: 3 };
    if (path.endsWith('/result-disputes')) return [row];
    if (path.endsWith('/resolve') || operation === 'detail') return pending.promise;
    return detail;
  }) as unknown as AdminApi['request'];
  renderPage(request);
  await userEvent.click(await screen.findByRole('button', { name: /查看争议/ }));
  if (operation !== 'detail') {
    await userEvent.type(await screen.findByRole('textbox', { name: '裁决原因' }), 'A裁决');
    await userEvent.click(screen.getByRole('button', { name: '确认裁决' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('/resolve'), expect.anything()));
  }
  await userEvent.click(screen.getByRole('link', { name: 'League B' }));
  await screen.findByText('当前没有争议。新争议会出现在这里。');
  const callsBeforeCompletion = vi.mocked(request).mock.calls.length;
  await act(async () => {
    if (operation === 'resolution-conflict') pending.reject(new ApiError({ status: 409, code: 'VERSION_CONFLICT' }));
    else pending.resolve(operation === 'detail' ? detail : { id: 'official-a' });
  });
  expect(request).toHaveBeenCalledTimes(callsBeforeCompletion);
  expect(screen.queryByRole('textbox', { name: '裁决原因' })).not.toBeInTheDocument();
  expect(screen.queryByText('2 : 1')).not.toBeInTheDocument();
  expect(screen.queryByText('裁决已记录。')).not.toBeInTheDocument();
  expect(screen.queryByText(/比赛已更新/)).not.toBeInTheDocument();
});

it.each(['success', 'conflict'] as const)('keeps dispute B and its draft intact after a pending A resolution %s', async (outcome) => {
  const pending = deferred<unknown>();
  const secondId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const second = { ...detail, id: secondId, matchVersion: 9,
    timeline: detail.timeline.map((event) => ({ ...event, metadata: event.type === 'RESULT_SUBMITTED'
      ? { homeScore: 4, awayScore: 3 } : { reason: 'B拒绝原因' } })) };
  const request = vi.fn(async (path: string) => {
    if (path.endsWith('/workspace')) return { id: leagueId, resultEvidenceRequired: false, version: 3 };
    if (path.endsWith('/result-disputes')) return [row, { ...row, id: secondId }];
    if (path.endsWith(`/${disputeId}/resolve`)) return pending.promise;
    if (path.endsWith(`/${secondId}/resolve`)) return { id: 'official-b' };
    return path.endsWith(`/${secondId}`) ? second : detail;
  }) as unknown as AdminApi['request'];
  renderPage(request);
  await userEvent.click(await screen.findByRole('button', { name: '查看争议 22222222' }));
  await userEvent.type(await screen.findByRole('textbox', { name: '裁决原因' }), 'A裁决');
  await userEvent.click(screen.getByRole('button', { name: '确认裁决' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining(`/${disputeId}/resolve`), expect.anything()));
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  await userEvent.click(screen.getByRole('button', { name: '查看争议 bbbbbbbb' }));
  await screen.findByText('4 : 3');
  await userEvent.type(screen.getByRole('textbox', { name: '裁决原因' }), 'B裁决');
  await act(async () => {
    if (outcome === 'success') pending.resolve({ id: 'official-a' });
    else pending.reject(new ApiError({ status: 409, code: 'VERSION_CONFLICT' }));
  });
  expect(screen.getByText('4 : 3')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '裁决原因' })).toHaveValue('B裁决');
  expect(screen.queryByText(/比赛已更新/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认裁决' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining(`/${secondId}/resolve`),
    expect.objectContaining({ body: { decisionType: 'USE_SUBMITTED_SCORE', reason: 'B裁决', expectedVersion: 9 } })));
});

it('prioritizes overdue evidence collection ahead of future collection and closed disputes', async () => {
  const overdueId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const futureId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const closedId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const request = vi.fn(async (path: string) => {
    if (path.endsWith('/workspace')) return { id: leagueId, resultEvidenceRequired: false, version: 3 };
    if (path.endsWith('/result-disputes')) return [
      { ...row, id: closedId, status: 'RESOLVED', evidenceDeadlineAt: '2000-01-01T00:00:00.000Z' },
      { ...row, id: futureId, status: 'EVIDENCE_COLLECTION', evidenceDeadlineAt: '2099-01-01T00:00:00.000Z' },
      { ...row, id: overdueId, status: 'EVIDENCE_COLLECTION', evidenceDeadlineAt: '2001-01-01T00:00:00.000Z' }
    ];
    throw new Error(path);
  }) as unknown as AdminApi['request'];
  renderPage(request);
  const buttons = await screen.findAllByRole('button', { name: /查看争议/ });
  expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(
    [overdueId, futureId, closedId].map((id) => `查看争议 ${id.slice(0, 8)}`)
  );
});

it('loads only the league queue, then fetches detail and uses matchVersion to resolve', async () => {
  const paths: string[] = [];
  const request = vi.fn(async (path: string, options?: { method?: string; body?: unknown }) => {
    paths.push(path);
    if (path.endsWith('/workspace')) return { id: leagueId, resultEvidenceRequired: false, version: 3 };
    if (path.endsWith('/result-disputes')) return [row];
    if (path.endsWith(`/${disputeId}/resolve`)) return { ...detail, status: 'RESOLVED' };
    if (path.endsWith(`/${disputeId}`)) return detail;
    throw new Error(path);
  }) as unknown as AdminApi['request'];
  renderPage(request);
  expect(await screen.findByText('待裁决')).toBeInTheDocument();
  expect(request).not.toHaveBeenCalledWith(expect.stringContaining('/read-url'), expect.anything());
  await userEvent.click(screen.getByRole('button', { name: /查看争议/ }));
  expect(await screen.findByText('2 : 1')).toBeInTheDocument();
  expect(screen.getAllByText('比分有误').length).toBeGreaterThan(0);
  expect(screen.getByText(/缺少.*对方/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '确认裁决' }));
  expect(screen.getByText('请填写裁决原因。')).toBeInTheDocument();
  expect(request).not.toHaveBeenCalledWith(expect.stringContaining('/resolve'), expect.anything());
  await userEvent.type(screen.getByRole('textbox', { name: '裁决原因' }), '核验证据');
  await userEvent.click(screen.getByRole('button', { name: '确认裁决' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/leagues/${leagueId}/result-disputes/${disputeId}/resolve`,
    expect.objectContaining({ method: 'POST', body: {
      decisionType: 'USE_SUBMITTED_SCORE', reason: '核验证据', expectedVersion: 7
    } })
  ));
  await waitFor(() => expect(paths.filter((path) => path.endsWith(`/${disputeId}`))).toHaveLength(2));
  expect(paths.filter((path) => path.endsWith('/result-disputes'))).toHaveLength(2);
});

it('uploads optional administrator evidence before resolving the dispute', async () => {
  const uploadId = '99999999-9999-4999-8999-999999999999';
  const calls: string[] = [];
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path.endsWith('/workspace')) return { id: leagueId, resultEvidenceRequired: false, version: 3 };
    if (path.endsWith('/result-disputes')) return [row];
    if (path.endsWith('/uploads') && options?.method === 'POST') { calls.push('create'); return {
      id: uploadId, objectKey: 'private-key', uploadUrl: 'https://private.test/upload',
      headers: { 'Content-Type': 'image/png' }, expiresAt: at
    }; }
    if (path.endsWith('/complete')) { calls.push('complete'); return { id: uploadId, status: 'UPLOADED' }; }
    if (path.endsWith('/resolve')) { calls.push('resolve'); return { id: 'official-1' }; }
    if (path.endsWith(`/${disputeId}`)) return detail;
    throw new Error(path);
  }) as unknown as AdminApi['request'];
  const transferEvidence = vi.fn(async () => { calls.push('transfer'); });
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    randomUUID: () => 'key-1', subtle: { digest: async () => new Uint8Array(32).buffer }
  } });
  try {
    const view = renderPage(request, { transferEvidence });
    await userEvent.click(await screen.findByRole('button', { name: /查看争议/ }));
    await screen.findByText('2 : 1');
    const chosen = new File(['png-bytes'], 'proof.png', { type: 'image/png' });
    Object.defineProperty(chosen, 'arrayBuffer', { value: async () => new TextEncoder().encode('png-bytes').buffer });
    const input = view.container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    await userEvent.upload(input!, chosen);
    await userEvent.type(screen.getByRole('textbox', { name: '裁决原因' }), '补充截图');
    await userEvent.click(screen.getByRole('button', { name: '确认裁决' }));
    await waitFor(() => expect(calls).toEqual(['create', 'transfer', 'complete', 'resolve']));
    expect(request).toHaveBeenCalledWith(`/v1/admin/leagues/${leagueId}/matches/${matchId}/result-evidence/uploads`,
      expect.objectContaining({ body: expect.objectContaining({ role: 'ADMIN', expectedVersion: 7 }) }));
    expect(request).toHaveBeenCalledWith(`/v1/admin/leagues/${leagueId}/result-disputes/${disputeId}/resolve`,
      expect.objectContaining({ body: { decisionType: 'USE_SUBMITTED_SCORE', reason: '补充截图', evidenceUploadId: uploadId, expectedVersion: 7 } }));
  } finally { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto }); }
});

it('reloads the match token on conflict while preserving the decision draft', async () => {
  let detailLoads = 0;
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path.endsWith('/workspace')) return { id: leagueId, resultEvidenceRequired: false, version: 3 };
    if (path.endsWith('/result-disputes')) return [row];
    if (path.endsWith('/resolve') && options?.method === 'POST') {
      if (detailLoads === 1) throw new ApiError({ status: 409, code: 'VERSION_CONFLICT' });
      return { id: 'official-1' };
    }
    if (path.endsWith(`/${disputeId}`)) { detailLoads += 1; return { ...detail, matchVersion: detailLoads === 1 ? 7 : 8 }; }
    throw new Error(path);
  }) as unknown as AdminApi['request'];
  renderPage(request);
  await userEvent.click(await screen.findByRole('button', { name: /查看争议/ }));
  await screen.findByText('2 : 1');
  await userEvent.type(screen.getByRole('textbox', { name: '裁决原因' }), '原始证据可靠');
  await userEvent.click(screen.getByRole('button', { name: '确认裁决' }));
  expect(await screen.findByText(/比赛已更新/)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '裁决原因' })).toHaveValue('原始证据可靠');
  await userEvent.click(screen.getByRole('button', { name: /确认裁决/ }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(`/v1/admin/leagues/${leagueId}/result-disputes/${disputeId}/resolve`,
    expect.objectContaining({ body: { decisionType: 'USE_SUBMITTED_SCORE', reason: '原始证据可靠', expectedVersion: 8 } })));
});

it('saves the league screenshot rule with its league version and scoped route', async () => {
  const request = vi.fn(async (path: string, options?: { method?: string; body?: unknown }) => {
    if (path.endsWith('/workspace')) return options?.method === 'PATCH'
      ? { id: leagueId, resultEvidenceRequired: true, version: 4 }
      : { id: leagueId, resultEvidenceRequired: false, version: 3 };
    if (path.endsWith('/result-disputes')) return [];
    throw new Error(path);
  }) as unknown as AdminApi['request'];
  renderPage(request);
  const toggle = await screen.findByRole('switch', { name: '强制比分截图' });
  await waitFor(() => expect(toggle).toBeEnabled());
  expect(screen.getByText('默认关闭，开启后每场由比分提交方上传 1 张截图')).toBeInTheDocument();
  await userEvent.click(toggle);
  await waitFor(() => expect(request).toHaveBeenCalledWith(`/v1/admin/leagues/${leagueId}/workspace`,
    expect.objectContaining({ method: 'PATCH', body: { resultEvidenceRequired: true, expectedVersion: 3 } })));
  expect(toggle).toBeChecked();
});

it('requires both replacement scores and preserves the reason in the request', async () => {
  const request = vi.fn(async (path: string, options?: { method?: string }) => {
    if (path.endsWith('/workspace')) return { id: leagueId, resultEvidenceRequired: false, version: 3 };
    if (path.endsWith('/result-disputes')) return [row];
    if (path.endsWith(`/${disputeId}/resolve`) && options?.method === 'POST') return { id: 'official-1' };
    if (path.endsWith(`/${disputeId}`)) return detail;
    throw new Error(path);
  }) as unknown as AdminApi['request'];
  renderPage(request);
  await userEvent.click(await screen.findByRole('button', { name: /查看争议/ }));
  await screen.findByText('2 : 1');
  await userEvent.click(screen.getByRole('radio', { name: '替换比分' }));
  await userEvent.type(screen.getByRole('textbox', { name: '裁决原因' }), '核对录像后改判');
  await userEvent.click(screen.getByRole('button', { name: '确认裁决' }));
  expect(screen.getByText('请填写 0–99 的双方整数比分。')).toBeInTheDocument();
  expect(request).not.toHaveBeenCalledWith(expect.stringContaining('/resolve'), expect.anything());
  await userEvent.type(screen.getByRole('spinbutton', { name: '主队比分' }), '3');
  await userEvent.type(screen.getByRole('spinbutton', { name: '客队比分' }), '0');
  await userEvent.click(screen.getByRole('button', { name: '确认裁决' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(
    `/v1/admin/leagues/${leagueId}/result-disputes/${disputeId}/resolve`,
    expect.objectContaining({ body: { decisionType: 'REPLACE_SCORE', homeScore: 3, awayScore: 0,
      reason: '核对录像后改判', expectedVersion: 7 } })
  ));
});

it.each(['close', 'unmount-pending'] as const)('gets a private evidence URL lazily and revokes it on %s', async (mode) => {
  const evidenceId = '88888888-8888-4888-8888-888888888888';
  const evidence = { id: evidenceId, matchId, disputeId, resultVersionId: row.triggerResultVersionId,
    role: 'SUBMITTER', status: 'ACTIVE', uploadedByUserId: row.openedByUserId, uploadedByAdminId: null,
    mimeType: 'image/png', byteSize: 64, checksumSha256: 'a'.repeat(64), expiresAt: null, deletedAt: null, createdAt: at };
  const request = vi.fn(async (path: string) => {
    if (path.endsWith('/workspace')) return { id: leagueId, resultEvidenceRequired: false, version: 3 };
    if (path.endsWith('/result-disputes')) return [row];
    if (path.endsWith('/read-url')) return { url: 'https://private.test/evidence', expiresAt: at };
    if (path.endsWith(`/${disputeId}`)) return { ...detail, evidence: [evidence] };
    throw new Error(path);
  }) as unknown as AdminApi['request'];
  let finishTransfer!: (blob: Blob) => void;
  const pendingTransfer = new Promise<Blob>((resolve) => { finishTransfer = resolve; });
  const transferEvidence = vi.fn(async () => mode === 'unmount-pending'
    ? pendingTransfer : new Blob(['image'], { type: 'image/png' }));
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const create = vi.fn(() => 'blob:preview');
  const revoke = vi.fn();
  URL.createObjectURL = create;
  URL.revokeObjectURL = revoke;
  const view = renderPage(request, { transferEvidence });
  await userEvent.click(await screen.findByRole('button', { name: /查看争议/ }));
  expect(await screen.findByRole('button', { name: '预览证据' })).toBeInTheDocument();
  expect(request).not.toHaveBeenCalledWith(expect.stringContaining('/read-url'), expect.anything());
  await userEvent.click(screen.getByRole('button', { name: '预览证据' }));
  await waitFor(() => expect(request).toHaveBeenCalledWith(expect.stringContaining('/read-url'), expect.anything()));
  if (mode === 'unmount-pending') {
    await waitFor(() => expect(transferEvidence).toHaveBeenCalled());
    view.unmount();
    await act(async () => { finishTransfer(new Blob(['image'], { type: 'image/png' })); });
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('blob:preview');
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    return;
  }
  expect(await screen.findByRole('img', { name: '争议证据预览' })).toHaveAttribute('src', 'blob:preview');
  expect(transferEvidence).toHaveBeenCalledWith('https://private.test/evidence');
  await userEvent.click(screen.getByRole('button', { name: '关闭预览' }));
  expect(revoke).toHaveBeenCalledWith('blob:preview');
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});
