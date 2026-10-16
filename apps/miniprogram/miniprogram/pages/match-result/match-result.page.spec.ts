import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../services/api'
import { competitionsApi } from '../../services/competitions'
import * as evidence from '../../services/result-evidence'

vi.mock('../../services/competitions', () => ({ competitionsApi: {
  myMatches: vi.fn(), resultDispute: vi.fn(), submitResult: vi.fn(), confirmResult: vi.fn(), rejectResult: vi.fn(),
  openTimeoutDispute: vi.fn(), attachResultEvidence: vi.fn()
} }))
vi.mock('../../services/result-evidence', () => ({
  chooseAndCompressEvidence: vi.fn(), createEvidenceUpload: vi.fn(), uploadEvidenceGrant: vi.fn(), completeEvidenceUpload: vi.fn()
}))
vi.mock('../../services/session', () => ({ session: { getAccessToken: () => 'token' } }))

const markup = readFileSync(resolve(__dirname, 'index.wxml'), 'utf8')
let registered: any

beforeAll(async () => {
  vi.stubGlobal('Page', (definition: any) => { registered = definition })
  vi.stubGlobal('wx', { showToast: vi.fn() })
  await import('./index')
})
beforeEach(() => vi.clearAllMocks())

function page(evidenceRequired: boolean) {
  const instance = { ...registered, data: { ...registered.data, state: 'SUBMIT', homeScore: '2', awayScore: '1', reason: '比分截图不一致',
    item: { match: { id: 'match-1', version: 4 }, evidenceRequired } },
    setData(update: Record<string, unknown>) { this.data = { ...this.data, ...update } }, load: vi.fn().mockResolvedValue(undefined) }
  return instance
}

describe('participant match result page', () => {
  it('offers a role-aware action for every result state', () => {
    for (const state of ['SUBMIT', 'WAIT_CONFIRM', 'CONFIRM', 'CONFIRMATION_EXPIRED', 'EVIDENCE_COLLECTION', 'READY_FOR_REVIEW', 'DONE']) {
      expect(markup).toContain(`state === '${state}'`)
    }
    expect(markup).toContain('bindtap="chooseEvidence"')
    expect(markup).toContain('bindtap="openTimeout"')
    expect(markup).toContain('bindtap="attachEvidence"')
    expect(markup).toContain('拒绝后将进入证据收集')
    expect(markup).toContain('{{evidenceStatus.submitter}}')
    expect(markup).toContain('{{evidenceStatus.opponent}}')
    expect(markup).not.toMatch(/objectKey|uploadUrl|readUrl|checksumSha256/)
  })

  it('submits an ordinary score without creating an image upload', async () => {
    const instance = page(false)
    vi.mocked(competitionsApi.submitResult).mockResolvedValue({})
    await instance.submit()
    expect(competitionsApi.submitResult).toHaveBeenCalledWith('match-1', { homeScore: 2, awayScore: 1, expectedVersion: 4 })
    expect(evidence.createEvidenceUpload).not.toHaveBeenCalled()
  })

  it('completes required evidence before sending the score', async () => {
    const instance = page(true)
    instance.selectedEvidence = { bytes: new Uint8Array([1, 2]).buffer, byteSize: 2, mimeType: 'image/jpeg', checksumSha256: 'a'.repeat(64) }
    vi.mocked(evidence.createEvidenceUpload).mockResolvedValue({ id: 'upload-1', uploadUrl: 'https://storage.example/put', headers: { Signature: 'grant' } } as any)
    vi.mocked(evidence.uploadEvidenceGrant).mockResolvedValue()
    vi.mocked(evidence.completeEvidenceUpload).mockResolvedValue({ id: 'upload-1', status: 'UPLOADED' })
    vi.mocked(competitionsApi.submitResult).mockResolvedValue({})
    await instance.submit()
    expect(evidence.completeEvidenceUpload).toHaveBeenCalledWith('match-1', 'upload-1', { expectedVersion: 4 })
    expect(competitionsApi.submitResult).toHaveBeenCalledWith('match-1', { homeScore: 2, awayScore: 1, expectedVersion: 4, evidenceUploadId: 'upload-1' })
    expect(vi.mocked(evidence.completeEvidenceUpload).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(competitionsApi.submitResult).mock.invocationCallOrder[0]!)
  })

  it('preserves scores, reason and local selection after a version conflict and refreshes', async () => {
    const instance = page(false)
    const selected = { bytes: new Uint8Array([1]).buffer }
    instance.selectedEvidence = selected
    vi.mocked(competitionsApi.submitResult).mockRejectedValue(new ApiError('VERSION_CONFLICT', 'changed', 409))
    await instance.submit()
    expect(instance.data).toMatchObject({ homeScore: '2', awayScore: '1', reason: '比分截图不一致' })
    expect(instance.selectedEvidence).toBe(selected)
    expect(instance.load).toHaveBeenCalledWith(true)
    expect(instance.data.errorMessage).toMatch(/状态已更新/)
  })

  it('clears a stale load error when the retry control reloads the match', async () => {
    const instance = page(false)
    instance.data.id = 'match-1'
    instance.data.errorMessage = '上次加载失败'
    instance.load = registered.load
    vi.mocked(competitionsApi.myMatches).mockResolvedValue({ items: [{
      action: 'SUBMIT', myEvidenceRole: null, confirmationDeadlineAt: null, disputeSummary: null, timeline: [],
      match: { id: 'match-1', officialResult: null, resultConfirmationDeadlineAt: null }
    }], nextCursor: null } as any)
    await instance.retry()
    expect(instance.data.errorMessage).toBe('')
  })
})
