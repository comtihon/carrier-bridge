"use client";

import { useEffect, useState } from "react";
import { getUserManager, login } from "@/lib/oidc";
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
        try {
          await getUserManager().signinRedirectCallback();
        } catch {
          // ignore — may have already been processed
        }
        window.location.replace("/");
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
