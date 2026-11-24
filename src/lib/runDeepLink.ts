import { useEffect, useRef } from "react";

/** Carrier links to a run as `<UI>/#run=<id>` (e.g. from a Slack decision message). */
export const RUN_HASH_PREFIX = "#run=";

/** The run id in a `#run=<id>` hash, or null. */
export function runIdFromHash(hash: string): string | null {
  if (!hash.startsWith(RUN_HASH_PREFIX)) return null;
  const id = decodeURIComponent(hash.slice(RUN_HASH_PREFIX.length)).trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
}

/**
 * Call `onOpen(runId)` when the page is (or becomes) `#run=<id>`, and drop the
 * hash so a reload does not reopen it.
 */
export function useRunDeepLink(onOpen: (runId: string) => void) {
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  useEffect(() => {
    const check = () => {
      const id = runIdFromHash(window.location.hash);
      if (!id) return;
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      onOpenRef.current(id);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);
}
