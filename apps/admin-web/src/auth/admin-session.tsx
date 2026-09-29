import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AdminLoginRequest, AdminMeResponse } from '@efm/contracts';
import { adminApi, type AdminApi } from '../lib/api';

type SessionPhase = 'checking' | 'anonymous' | 'authenticated';

type AdminSession = {
  phase: SessionPhase;
  identity: AdminMeResponse | null;
  login(input: AdminLoginRequest): Promise<void>;
  logout(): Promise<void>;
};

const SessionContext = createContext<AdminSession | null>(null);

export function AdminSessionProvider({
  children,
  api = adminApi
}: {
  children: ReactNode;
  api?: AdminApi;
}) {
  const [identity, setIdentity] = useState<AdminMeResponse | null>(null);
  const [phase, setPhase] = useState<SessionPhase>('checking');
  const operation = useRef(0);

  useEffect(() => {
    let active = true;
    const restoreOperation = ++operation.current;
    const unsubscribe = api.onSessionExpired(() => {
      operation.current += 1;
      setIdentity(null);
      setPhase('anonymous');
    });
    void api.restore().then((restored) => {
      if (!active || restoreOperation !== operation.current) return;
      setIdentity(restored);
      setPhase(restored ? 'authenticated' : 'anonymous');
    });
    return () => {
      active = false;
      operation.current += 1;
      unsubscribe();
    };
  }, [api]);

  const value = useMemo<AdminSession>(() => ({
    phase,
    identity,
    async login(input) {
      const loginOperation = ++operation.current;
      const authenticated = await api.login(input);
      if (loginOperation !== operation.current) return;
      setIdentity(authenticated);
      setPhase('authenticated');
    },
    async logout() {
      operation.current += 1;
      setIdentity(null);
      setPhase('anonymous');
      try {
        await api.logout();
      } catch {
        // Local revocation is authoritative for this browser even if the API is offline.
      }
    }
  }), [api, identity, phase]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useAdminSession(): AdminSession {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useAdminSession must be used inside AdminSessionProvider');
  return value;
}
