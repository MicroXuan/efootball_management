import { useEffect, useState } from 'react';

// Each dependency change hides the previous response immediately; late responses are discarded.
export function useResource<T>(load: () => Promise<T>, revision = 0): { data?: T; failed?: boolean } {
  const [state, setState] = useState<{ load: typeof load; revision: number; data?: T; failed?: boolean }>();
  useEffect(() => {
    let active = true;
    void load().then((data) => { if (active) setState({ load, revision, data }); })
      .catch(() => { if (active) setState({ load, revision, failed: true }); });
    return () => { active = false; };
  }, [load, revision]);
  return state?.load === load && state.revision === revision ? state : {};
}
