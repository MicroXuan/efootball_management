export const apiBaseUrl = 'http://127.0.0.1:3000/v1'

export const localWechatLoginCode = /^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?\//.test(apiBaseUrl)
  ? 'test-code-local-user'
  : undefined
