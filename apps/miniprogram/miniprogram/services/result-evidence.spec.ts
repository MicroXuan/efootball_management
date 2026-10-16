import { afterEach, describe, expect, it, vi } from 'vitest'
import { chooseAndCompressEvidence, uploadEvidenceGrant, sha256Hex } from './result-evidence'

afterEach(() => vi.unstubAllGlobals())

describe('result evidence upload', () => {
  const jpeg = (length: number) => { const bytes = new Uint8Array(length).fill(1); bytes.set([0xff, 0xd8, 0xff]); return bytes.buffer }
  it('hashes the selected bytes for the server checksum', () => {
    expect(sha256Hex(new Uint8Array([97, 98, 99]).buffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('compresses toward 800 KB and rejects any final file above 1 MiB', async () => {
    let quality = 0
    vi.stubGlobal('wx', {
      chooseMedia: ({ success }: any) => success({ tempFiles: [{ tempFilePath: 'original.jpg', size: 1_500_000 }] }),
      compressImage: ({ quality: q, success }: any) => { quality = q; success({ tempFilePath: `q${q}.jpg` }) },
      getFileSystemManager: () => ({ readFile: ({ filePath, success }: any) => success({ data: jpeg(filePath === 'original.jpg' ? 1_500_000 : filePath === 'q80.jpg' ? 900_000 : 700_000) }) })
    })
    const selected = await chooseAndCompressEvidence()
    expect(selected.byteSize).toBe(700_000)
    expect(quality).toBeLessThan(80)
    vi.stubGlobal('wx', {
      chooseMedia: ({ success }: any) => success({ tempFiles: [{ tempFilePath: 'original.jpg', size: 2_000_000 }] }),
      compressImage: ({ quality: q, success }: any) => success({ tempFilePath: `q${q}.jpg` }),
      getFileSystemManager: () => ({ readFile: ({ success }: any) => success({ data: jpeg(1_048_577) }) })
    })
    await expect(chooseAndCompressEvidence()).rejects.toThrow(/1 MB/)
  })

  it('PUTs bytes with exact grant headers and authenticates only the local fallback', async () => {
    const requests: any[] = []
    vi.stubGlobal('wx', { request: (options: any) => { requests.push(options); options.success({ statusCode: 200, data: {} }) } })
    const bytes = new Uint8Array([1, 2]).buffer
    await uploadEvidenceGrant({ uploadUrl: 'https://storage.example/put', headers: { Signature: 'signed', 'content-type': 'image/jpeg' } }, bytes, 'token')
    await uploadEvidenceGrant({ uploadUrl: 'http://127.0.0.1:3000/v1/result-evidence/objects/key', headers: { 'content-type': 'image/jpeg' } }, bytes, 'token')
    expect(requests[0]).toMatchObject({ url: 'https://storage.example/put', method: 'PUT', data: bytes, header: { Signature: 'signed', 'content-type': 'image/jpeg' } })
    expect(requests[0].header.Authorization).toBeUndefined()
    expect(requests[1].header.Authorization).toBe('Bearer token')
  })
})
