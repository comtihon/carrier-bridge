"use client";

import { useEffect, useState } from "react";
import { getUserManager, login, returnHash } from "@/lib/oidc";
import { AUTH_ENABLED } from "@/lib/config";

type AuthState = "loading" | "authenticated" | "redirecting";

export function Providers({ children }: { children: React.ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>(
    AUTH_ENABLED ? "loading" : "authenticated"
  );

  useEffect(() => {
    if (!AUTH_ENABLED) return;

    async function initAuth() {
      if (window.location.pathname === "/callback") {
        let hash = "";
        try {
          const user = await getUserManager().signinRedirectCallback();
          hash = returnHash(user?.state);
        } catch {
          // ignore — may have already been processed
        }
        window.location.replace(`/${hash}`);
        return;
      }

      const user = await getUserManager().getUser();
      if (user && !user.expired) {
        setAuthState("authenticated");
      } else {
        setAuthState("redirecting");
        await login();
      }
    }

    initAuth();
  }, []);

  if (authState === "loading" || authState === "redirecting") {
    return null;
  }

  return <>{children}</>;
}
