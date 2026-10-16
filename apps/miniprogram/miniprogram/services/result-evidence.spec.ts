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
      getImageInfo: ({ success }: any) => success({ width: 1600, height: 900, type: 'jpeg' }),
      getFileSystemManager: () => ({ readFile: ({ filePath, success }: any) => success({ data: jpeg(filePath === 'original.jpg' ? 1_500_000 : filePath === 'q80.jpg' ? 900_000 : 700_000) }) })
    })
    const selected = await chooseAndCompressEvidence()
    expect(selected.byteSize).toBe(700_000)
    expect(quality).toBeLessThan(80)
    vi.stubGlobal('wx', {
      chooseMedia: ({ success }: any) => success({ tempFiles: [{ tempFilePath: 'original.jpg', size: 2_000_000 }] }),
      compressImage: ({ quality: q, success }: any) => success({ tempFilePath: `q${q}.jpg` }),
      getImageInfo: ({ success }: any) => success({ width: 1600, height: 900, type: 'jpeg' }),
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

  it('resizes an oversized PNG through native canvas and uploads its actual JPEG output', async () => {
    const png = new Uint8Array(1_600_000); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const jpg = jpeg(710_000)
    const sizes: Array<[number, number]> = []
    const drawImage = vi.fn()
    const exports: any[] = []
    vi.stubGlobal('wx', {
      chooseMedia: ({ success }: any) => success({ tempFiles: [{ tempFilePath: 'original.png', size: png.length }] }),
      getFileSystemManager: () => ({ readFile: ({ filePath, success }: any) => success({ data: filePath === 'original.png' ? png.buffer : jpg }) }),
      getImageInfo: ({ src, success }: any) => success({ width: src === 'original.png' ? 2400 : 1600, height: src === 'original.png' ? 1800 : 1200, type: src === 'original.png' ? 'png' : 'jpeg' }),
      createCanvasContext: () => ({ drawImage, draw: (_reserve: boolean, callback: () => void) => callback() }),
      canvasToTempFilePath: (options: any) => { exports.push(options); options.success({ tempFilePath: 'resized.jpg' }) }
    })
    const selected = await chooseAndCompressEvidence(async (width, height) => { sizes.push([width, height]) })
    expect(sizes[0]).toEqual([1600, 1200])
    expect(drawImage).toHaveBeenCalledWith('original.png', 0, 0, 1600, 1200)
    expect(exports[0]).toMatchObject({ fileType: 'jpg', destWidth: 1600, destHeight: 1200 })
    expect(selected).toMatchObject({ path: 'resized.jpg', mimeType: 'image/jpeg', byteSize: 710_000 })
  })

  it('rejects a canvas result whose extension disagrees with the image signature', async () => {
    const png = new Uint8Array(1_600_000); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    vi.stubGlobal('wx', {
      chooseMedia: ({ success }: any) => success({ tempFiles: [{ tempFilePath: 'original.png', size: png.length }] }),
      getFileSystemManager: () => ({ readFile: ({ filePath, success }: any) => success({ data: filePath === 'original.png' ? png.buffer : jpeg(700_000) }) }),
      getImageInfo: ({ src, success }: any) => success({ width: 2400, height: 1800, type: src === 'original.png' ? 'png' : 'jpeg' }),
      createCanvasContext: () => ({ drawImage: () => undefined, draw: (_reserve: boolean, callback: () => void) => callback() }),
      canvasToTempFilePath: ({ success }: any) => success({ tempFilePath: 'resized.png' })
    })
    await expect(chooseAndCompressEvidence(async () => undefined)).rejects.toThrow(/格式/)
  })

  it('takes the same resize-and-JPEG path for an oversized WebP', async () => {
    const webp = new Uint8Array(1_300_000)
    webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    const canvasExport = vi.fn((options: any) => options.success({ tempFilePath: 'smaller.jpg' }))
    vi.stubGlobal('wx', {
      chooseMedia: ({ success }: any) => success({ tempFiles: [{ tempFilePath: 'original.webp', size: webp.length }] }),
      getFileSystemManager: () => ({ readFile: ({ filePath, success }: any) => success({ data: filePath === 'original.webp' ? webp.buffer : jpeg(600_000) }) }),
      getImageInfo: ({ src, success }: any) => success({ width: 2000, height: 1000, type: src === 'original.webp' ? 'webp' : 'jpg' }),
      createCanvasContext: () => ({ drawImage: () => undefined, draw: (_reserve: boolean, callback: () => void) => callback() }),
      canvasToTempFilePath: canvasExport
    })
    const selected = await chooseAndCompressEvidence(async () => undefined)
    expect(canvasExport).toHaveBeenCalledOnce()
    expect(selected.mimeType).toBe('image/jpeg')
    expect(selected.byteSize).toBe(600_000)
  })
})
