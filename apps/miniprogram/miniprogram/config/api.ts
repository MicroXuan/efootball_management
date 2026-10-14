export const apiBaseUrl = 'http://127.0.0.1:3000/v1'

export const localWechatLoginCode = /^http:\/\/(127\.0\.0\.1|localhost)(?::\d+)?\//.test(apiBaseUrl)
  // Deliberately does not use the API's test-code-* identity namespace. The local
  // fake gateway will resolve this to its configured DEV_WECHAT_OPEN_ID instead.
  ? 'devtools-code-unavailable'
  : undefined
