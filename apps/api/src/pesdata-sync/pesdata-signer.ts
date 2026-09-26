import { createHash } from 'node:crypto';

export type PesdataRequestParam =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly unknown[]
  | Record<string, unknown>;

function encodePesdataValue(value: Exclude<PesdataRequestParam, null | undefined>): string {
  const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);

  return encodeURIComponent(serialized)
    .replace(/%27/g, "'")
    .replace(/!/g, '%21')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

export function canonicalizePesdataParams(
  params: Record<string, PesdataRequestParam>
): string {
  return Object.keys(params)
    .filter((key) => {
      const value = params[key];
      return value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0);
    })
    .sort()
    .map((key) => `${key}=${encodePesdataValue(params[key] as Exclude<PesdataRequestParam, null | undefined>)}`)
    .join('&');
}

export function signPesdataRequest(
  params: Record<string, PesdataRequestParam>,
  timestamp: number,
  nonce: string,
  seed: string
): string {
  const canonical = canonicalizePesdataParams(params);
  return createHash('md5').update(`${timestamp}${nonce}${seed}${canonical}`).digest('hex');
}
