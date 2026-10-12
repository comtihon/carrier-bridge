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

export async function login(): Promise<void> {
  await getUserManager().signinRedirect();
}
