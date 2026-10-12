type ImageDownload = (options: {
  url: string
  success: (result: { statusCode: number; tempFilePath: string }) => void
  fail: (error: unknown) => void
}) => unknown

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
