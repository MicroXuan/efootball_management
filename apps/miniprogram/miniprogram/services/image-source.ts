type ImageDownload = (options: {
  url: string
  success: (result: { statusCode: number; tempFilePath: string }) => void
  fail: (error: unknown) => void
}) => unknown

type CloudImageDownload = (options: {
  fileID: string
  success: (result: { statusCode: number; tempFilePath: string }) => void
  fail: (error: unknown) => void
}) => unknown

type ImageDownloads = {
  downloadHttp: ImageDownload
  downloadCloud: CloudImageDownload
}

export function resolveImageSource(url: string, download: ImageDownload): Promise<string> {
  if (!url.startsWith('http://')) return Promise.resolve(url)

  return new Promise((resolve, reject) => {
    download({
      url,
      success: (result) => {
        if (result.statusCode === 200 && result.tempFilePath) {
          resolve(result.tempFilePath)
          return
        }
        reject(new Error('IMAGE_DOWNLOAD_FAILED'))
      },
      fail: () => reject(new Error('IMAGE_DOWNLOAD_FAILED')),
    })
  })
}

export function cacheImageSource(source: string, downloads: ImageDownloads): Promise<string> {
  const isCloudFile = source.startsWith('cloud://')
  if (!isCloudFile && !/^https?:\/\//.test(source)) return Promise.resolve(source)

  return new Promise((resolve, reject) => {
    const callbacks = {
      success: (result) => {
        if (result.statusCode === 200 && result.tempFilePath) {
          resolve(result.tempFilePath)
          return
        }
        reject(new Error('IMAGE_DOWNLOAD_FAILED'))
      },
      fail: () => reject(new Error('IMAGE_DOWNLOAD_FAILED')),
    } satisfies Pick<Parameters<ImageDownload>[0], 'success' | 'fail'>
    if (isCloudFile) {
      downloads.downloadCloud({ fileID: source, ...callbacks })
    } else {
      downloads.downloadHttp({ url: source, ...callbacks })
    }
  })
}
