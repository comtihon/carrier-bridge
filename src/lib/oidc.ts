import { UserManager, type UserManagerSettings } from "oidc-client-ts";
import { ZITADEL_ISSUER, ZITADEL_CLIENT_ID } from "./config";

let _manager: UserManager | null = null;

export function getUserManager(): UserManager {
  if (!_manager) {
    const settings: UserManagerSettings = {
      authority: ZITADEL_ISSUER,
      client_id: ZITADEL_CLIENT_ID,
      redirect_uri: `${window.location.origin}/callback`,
      post_logout_redirect_uri: window.location.origin,
      response_type: "code",
      scope: "openid profile email",
      automaticSilentRenew: false,
    };
    _manager = new UserManager(settings);
  }
  return _manager;
}

export async function getAccessToken(): Promise<string | undefined> {
  if (typeof window === "undefined") return undefined;
  const user = await getUserManager().getUser();
  return user && !user.expired ? user.access_token : undefined;
}

/**
 * Sign in, coming back to the same `#hash` afterwards — carrier sends people
 * to `<UI>/#approve-runner`, which must survive the round trip.
 */
export async function login(): Promise<void> {
  const hash = window.location.hash;
  await getUserManager().signinRedirect(hash ? { state: { hash } } : undefined);
}

/** The `#hash` `login` was called from, if the callback carried one back. */
export function returnHash(state: unknown): string {
  const hash = (state as { hash?: unknown } | null | undefined)?.hash;
  // Only a fragment: the callback must never send the browser elsewhere.
  return typeof hash === "string" && /^#[\w-]+$/.test(hash) ? hash : "";
}
