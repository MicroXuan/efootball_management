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
  it('downloads HTTPS images before exposing them as CSS backgrounds', async () => {
    const download = vi.fn((options: {
      success: (result: { statusCode: number; tempFilePath: string }) => void
    }) => {
      options.success({ statusCode: 200, tempFilePath: 'wxfile://tmp/banner.webp' })
    })

    await expect(cacheImageSource('https://media.example/banner.webp', download)).resolves.toBe(
      'wxfile://tmp/banner.webp',
    )
  })
})
