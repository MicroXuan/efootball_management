import { useRef } from 'react';

const createKey = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export function useMutationKey() {
  const key = useRef<string | null>(null);
  return {
    current: () => key.current ??= createKey(),
    reset: () => { key.current = null; }
  };
}
