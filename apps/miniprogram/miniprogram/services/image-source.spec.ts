import { describe, expect, it, vi } from 'vitest'
import { cacheImageSource, resolveImageSource } from './image-source'

describe('resolveImageSource', () => {
  it('keeps HTTPS images as remote sources', async () => {
    const download = vi.fn()

    await expect(resolveImageSource('https://media.example/crest.webp', download)).resolves.toBe(
      'https://media.example/crest.webp',
    )
    expect(download).not.toHaveBeenCalled()
  })

  it('downloads HTTP images before rendering them in the mini program', async () => {
    const download = vi.fn((options: {
      url: string
      success: (result: { statusCode: number; tempFilePath: string }) => void
    }) => {
      options.success({ statusCode: 200, tempFilePath: 'wxfile://tmp/league.webp' })
    })

    await expect(resolveImageSource('http://127.0.0.1:3000/v1/media/league.webp', download)).resolves.toBe(
      'wxfile://tmp/league.webp',
    )
    expect(download).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://127.0.0.1:3000/v1/media/league.webp',
    }))
  })

  it('rejects unsuccessful HTTP image downloads', async () => {
    const download = vi.fn((options: {
      success: (result: { statusCode: number; tempFilePath: string }) => void
    }) => {
      options.success({ statusCode: 404, tempFilePath: '' })
    })

    await expect(resolveImageSource('http://127.0.0.1:3000/v1/media/missing.webp', download)).rejects.toThrow(
      'IMAGE_DOWNLOAD_FAILED',
    )
  })
})

describe('cacheImageSource', () => {
  it('reuses the downloaded temporary file for the same banner during one app session', async () => {
    let downloads = 0
    const download = (options: {
      success: (result: { statusCode: number; tempFilePath: string }) => void
    }) => {
      downloads += 1
      options.success({ statusCode: 200, tempFilePath: 'wxfile://tmp/session-banner.webp' })
    }

    const first = await cacheImageSource('https://media.example/session-banner.webp', {
      downloadHttp: download,
      downloadCloud: vi.fn(),
    })
    const second = await cacheImageSource('https://media.example/session-banner.webp', {
      downloadHttp: download,
      downloadCloud: vi.fn(),
    })

    expect(first).toBe('wxfile://tmp/session-banner.webp')
    expect(second).toBe('wxfile://tmp/session-banner.webp')
    expect(downloads).toBe(1)
  })

  it('downloads the banner again when its cache identity changes', async () => {
    let downloads = 0
    const download = (options: {
      success: (result: { statusCode: number; tempFilePath: string }) => void
    }) => {
      downloads += 1
      options.success({ statusCode: 200, tempFilePath: `wxfile://tmp/banner-${downloads}.webp` })
    }
    const source = 'https://media.example/versioned-banner.webp'
    const clients = { downloadHttp: download, downloadCloud: vi.fn() }

    await expect(cacheImageSource(source, clients, `${source}:1`)).resolves.toBe('wxfile://tmp/banner-1.webp')
    await expect(cacheImageSource(source, clients, `${source}:1`)).resolves.toBe('wxfile://tmp/banner-1.webp')
    await expect(cacheImageSource(source, clients, `${source}:2`)).resolves.toBe('wxfile://tmp/banner-2.webp')
    expect(downloads).toBe(2)
  })

  it('downloads HTTPS images before exposing them as CSS backgrounds', async () => {
    const download = vi.fn((options: {
      success: (result: { statusCode: number; tempFilePath: string }) => void
    }) => {
      options.success({ statusCode: 200, tempFilePath: 'wxfile://tmp/banner.webp' })
    })

    await expect(cacheImageSource('https://media.example/banner.webp', {
      downloadHttp: download,
      downloadCloud: vi.fn(),
    })).resolves.toBe(
      'wxfile://tmp/banner.webp',
    )
  })

  it('downloads CloudBase file IDs without relying on a configured HTTPS download domain', async () => {
    const downloadCloud = vi.fn((options: {
      fileID: string
      success: (result: { statusCode: number; tempFilePath: string }) => void
    }) => {
      options.success({ statusCode: 200, tempFilePath: 'wxfile://tmp/cloud-banner.webp' })
    })

    await expect(cacheImageSource('cloud://production/banner.webp', {
      downloadHttp: vi.fn(),
      downloadCloud,
    })).resolves.toBe('wxfile://tmp/cloud-banner.webp')
    expect(downloadCloud).toHaveBeenCalledWith(expect.objectContaining({
      fileID: 'cloud://production/banner.webp',
    }))
  })
})
