import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ cacheImageSource: vi.fn() }))
vi.mock('../../services/image-source', () => ({ cacheImageSource: mocks.cacheImageSource }))

type Definition = {
  observers?: Record<string, unknown>
  methods?: Record<string, unknown>
}

async function componentDefinition() {
  let definition: Definition | undefined
  vi.stubGlobal('Component', (options: Definition) => { definition = options })
  vi.stubGlobal('wx', {
    downloadFile: vi.fn(),
    cloud: { downloadFile: vi.fn() },
  })
  await import('./index')
  if (!definition) throw new Error('component was not registered')
  return definition
}

function instance(directHttps = false) {
  const data = {
    displaySrc: '', requestedSrc: '', requestedDirectHttps: directHttps, imageFailed: false, directHttps,
  }
  return {
    data,
    setData(patch: Partial<typeof data>) { Object.assign(data, patch) },
  }
}

describe('entity artwork source selection', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.cacheImageSource.mockReset()
  })

  it('renders opted-in HTTPS artwork directly without downloading it', async () => {
    const definition = await componentDefinition()
    const context = instance(true)
    const observer = definition.observers?.['src, directHttps'] as Function

    observer.call(context, 'https://img.pesdata.net/player.webp', true)

    expect(context.data).toMatchObject({
      displaySrc: 'https://img.pesdata.net/player.webp',
      requestedSrc: 'https://img.pesdata.net/player.webp',
      imageFailed: false,
    })
    expect(mocks.cacheImageSource).not.toHaveBeenCalled()
  })

  it('keeps cloud and local sources on the cached resolver and ignores stale completions', async () => {
    const completions = new Map<string, (value: string) => void>()
    mocks.cacheImageSource.mockImplementation((src: string) => new Promise<string>((resolve) => {
      completions.set(src, resolve)
    }))
    const definition = await componentDefinition()
    const context = instance(false)
    const observer = definition.observers?.['src, directHttps'] as Function

    observer.call(context, 'cloud://bucket/old.webp', false)
    observer.call(context, 'cloud://bucket/new.webp', false)
    completions.get('cloud://bucket/old.webp')?.('wxfile://tmp/old.webp')
    await Promise.resolve()
    expect(context.data.displaySrc).toBe('')
    completions.get('cloud://bucket/new.webp')?.('wxfile://tmp/new.webp')
    await Promise.resolve()
    expect(context.data.displaySrc).toBe('wxfile://tmp/new.webp')
  })

  it('keeps the current image when its source is reported again', async () => {
    mocks.cacheImageSource.mockResolvedValue('wxfile://tmp/crest.webp')
    const definition = await componentDefinition()
    const context = instance(false)
    const observer = definition.observers?.['src, directHttps'] as Function

    observer.call(context, 'cloud://bucket/crest.webp', false)
    await Promise.resolve()
    expect(context.data.displaySrc).toBe('wxfile://tmp/crest.webp')

    observer.call(context, 'cloud://bucket/crest.webp', false)
    expect(context.data.displaySrc).toBe('wxfile://tmp/crest.webp')
    expect(mocks.cacheImageSource).toHaveBeenCalledTimes(1)
  })

  it('shows the fallback for an empty source and after a real image error', async () => {
    const definition = await componentDefinition()
    const context = instance(true)
    const observer = definition.observers?.['src, directHttps'] as Function
    const onImageError = definition.methods?.onImageError as Function

    observer.call(context, '', true)
    expect(context.data).toMatchObject({ displaySrc: '', imageFailed: false })
    observer.call(context, 'https://img.pesdata.net/player.webp', true)
    onImageError.call(context)
    expect(context.data.imageFailed).toBe(true)
  })
})
