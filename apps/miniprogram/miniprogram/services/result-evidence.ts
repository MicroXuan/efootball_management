import type { CompleteEvidenceUploadRequest, CreateEvidenceUploadRequest, CreateEvidenceUploadResponse } from '@efm/contracts'
import { ApiError, api } from './api'

const TARGET_BYTES = 800_000
const MAX_BYTES = 1_048_576
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]

const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits))

export function sha256Hex(buffer: ArrayBuffer): string {
  const source = new Uint8Array(buffer)
  const length = Math.ceil((source.length + 9) / 64) * 64
  const bytes = new Uint8Array(length)
  bytes.set(source)
  bytes[source.length] = 0x80
  const bits = source.length * 8
  const view = new DataView(bytes.buffer)
  view.setUint32(length - 8, Math.floor(bits / 0x1_0000_0000))
  view.setUint32(length - 4, bits >>> 0)
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const words = new Uint32Array(64)
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4)
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15]!, b = words[i - 2]!
      words[i] = (words[i - 16]! + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[i - 7]! + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let i = 0; i < 64; i++) {
      const t1 = (h! + (rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25)) + ((e! & f!) ^ (~e! & g!)) + K[i]! + words[i]!) >>> 0
      const t2 = ((rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22)) + ((a! & b!) ^ (a! & c!) ^ (b! & c!))) >>> 0
      h = g; g = f; f = e; e = (d! + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    const values = [a, b, c, d, e, f, g, h]
    for (let i = 0; i < 8; i++) hash[i] = (hash[i]! + values[i]!) >>> 0
  }
  return hash.map((part) => part.toString(16).padStart(8, '0')).join('')
}

function mimeFromBytes(buffer: ArrayBuffer): CreateEvidenceUploadRequest['mimeType'] {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((part, index) => bytes[index] === part)) return 'image/png'
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  throw new Error('请选择 JPG、PNG 或 WebP 图片')
}

function readBytes(path: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: path,
    success: ({ data }) => data instanceof ArrayBuffer ? resolve(data) : reject(new Error('无法读取图片，请重新选择')),
    fail: () => reject(new Error('无法读取图片，请重新选择'))
  }))
}

function compress(path: string, quality: number): Promise<string> {
  return new Promise((resolve, reject) => wx.compressImage({ src: path, quality,
    success: ({ tempFilePath }) => resolve(tempFilePath), fail: () => reject(new Error('图片压缩失败，请重新选择'))
  }))
}

function imageInfo(path: string): Promise<{ width: number; height: number; type: string }> {
  return new Promise((resolve, reject) => wx.getImageInfo({ src: path,
    success: ({ width, height, type }) => resolve({ width, height, type }),
    fail: () => reject(new Error('无法识别图片格式，请重新选择'))
  }))
}

function normalizedMime(value: string): CreateEvidenceUploadRequest['mimeType'] | null {
  const type = value.toLowerCase()
  return type === 'jpg' || type === 'jpeg' ? 'image/jpeg'
    : type === 'png' ? 'image/png' : type === 'webp' ? 'image/webp' : null
}

async function validateImage(path: string, bytes: ArrayBuffer): Promise<CreateEvidenceUploadRequest['mimeType']> {
  const mimeType = mimeFromBytes(bytes)
  const extension = path.split(/[?#]/)[0]?.match(/\.([a-z\d]+)$/i)?.[1]
  if (extension && normalizedMime(extension) !== mimeType) throw new Error('图片扩展名与实际格式不一致，请重新选择')
  const info = await imageInfo(path)
  if (normalizedMime(info.type) !== mimeType || !Number.isInteger(info.width) || !Number.isInteger(info.height)
    || info.width <= 0 || info.height <= 0) throw new Error('图片格式与文件信息不一致，请重新选择')
  return mimeType
}

function exportResizedJpeg(path: string, width: number, height: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const context = wx.createCanvasContext('result-evidence-canvas')
    context.drawImage(path, 0, 0, width, height)
    context.draw(false, () => wx.canvasToTempFilePath({
      canvasId: 'result-evidence-canvas', width, height, destWidth: width, destHeight: height,
      fileType: 'jpg', quality,
      success: ({ tempFilePath }) => resolve(tempFilePath),
      fail: () => reject(new Error('图片缩放失败，请重新选择'))
    }))
  })
}

export type SelectedEvidence = { path: string; bytes: ArrayBuffer; byteSize: number; mimeType: CreateEvidenceUploadRequest['mimeType']; checksumSha256: string }

export async function chooseAndCompressEvidence(resizeCanvas?: (width: number, height: number) => Promise<void>): Promise<SelectedEvidence> {
  const original = await new Promise<string>((resolve, reject) => wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'],
    success: ({ tempFiles }) => tempFiles[0]?.tempFilePath ? resolve(tempFiles[0].tempFilePath) : reject(new Error('未选择图片')),
    fail: () => reject(new Error('未选择图片'))
  }))
  let path = original
  let bytes = await readBytes(path)
  const originalMime = await validateImage(path, bytes)
  if (bytes.byteLength > TARGET_BYTES) {
    if (originalMime === 'image/jpeg') {
      for (const quality of [80, 65, 50, 35, 20]) {
        const nextPath = await compress(original, quality)
        const nextBytes = await readBytes(nextPath)
        await validateImage(nextPath, nextBytes)
        if (nextBytes.byteLength < bytes.byteLength) { path = nextPath; bytes = nextBytes }
        if (bytes.byteLength <= TARGET_BYTES) break
      }
    } else {
      if (!resizeCanvas) throw new Error('当前页面无法缩放图片，请选择较小的截图')
      const dimensions = await imageInfo(original)
      const longest = Math.max(dimensions.width, dimensions.height)
      const edges = [1600, 1280, 960, 720, 540]
      const qualities = [0.85, 0.75, 0.68, 0.6, 0.5]
      for (let index = 0; index < edges.length; index++) {
        const target = Math.min(edges[index]!, Math.round(longest * Math.pow(0.85, index + 1)))
        const ratio = target / longest
        const width = Math.max(1, Math.round(dimensions.width * ratio))
        const height = Math.max(1, Math.round(dimensions.height * ratio))
        await resizeCanvas(width, height)
        const nextPath = await exportResizedJpeg(original, width, height, qualities[index]!)
        const nextBytes = await readBytes(nextPath)
        const nextMime = await validateImage(nextPath, nextBytes)
        if (nextMime !== 'image/jpeg') throw new Error('缩放图片格式不正确，请重新选择')
        if (nextBytes.byteLength < bytes.byteLength) { path = nextPath; bytes = nextBytes }
        if (bytes.byteLength <= TARGET_BYTES) break
      }
    }
  }
  if (bytes.byteLength > MAX_BYTES) throw new Error('图片仍超过 1 MB，请裁剪后重新选择')
  const mimeType = await validateImage(path, bytes)
  return { path, bytes, byteSize: bytes.byteLength, mimeType, checksumSha256: sha256Hex(bytes) }
}

export function createEvidenceUpload(matchId: string, input: CreateEvidenceUploadRequest): Promise<CreateEvidenceUploadResponse> {
  return api.request({ path: `/matches/${encodeURIComponent(matchId)}/result-evidence/uploads`, method: 'POST', data: input })
}

export function completeEvidenceUpload(matchId: string, uploadId: string, input: CompleteEvidenceUploadRequest): Promise<{ id: string; status: 'UPLOADED' }> {
  return api.request({ path: `/matches/${encodeURIComponent(matchId)}/result-evidence/uploads/${encodeURIComponent(uploadId)}/complete`, method: 'POST', data: input })
}

export type EvidenceGrant = Pick<CreateEvidenceUploadResponse, 'uploadUrl' | 'headers'>

export function uploadEvidenceGrant(grant: EvidenceGrant, bytes: ArrayBuffer, accessToken?: string): Promise<void> {
  const isLocal = /\/v1\/result-evidence\/objects\//.test(grant.uploadUrl)
  const header = { ...grant.headers, ...(isLocal && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }
  if (isLocal && !accessToken) return Promise.reject(new ApiError('AUTH_REQUIRED', '请重新登录后上传图片', 401))
  return new Promise((resolve, reject) => wx.request({
    url: grant.uploadUrl, method: 'PUT', data: bytes, header,
    success: ({ statusCode }) => statusCode >= 200 && statusCode < 300 ? resolve() : reject(new Error('图片上传失败，请重试')),
    fail: () => reject(new Error('图片上传失败，请检查网络后重试'))
  }))
}
