declare global {
  interface Window {
    runtimeConfig?: {
      BACKEND_URL?: string;
      NEXT_PUBLIC_AUTH_ENABLED?: boolean | string;
      NEXT_PUBLIC_SHOW_RAW_JSON?: boolean | string;
      NEXT_PUBLIC_ZITADEL_ISSUER?: string;
      NEXT_PUBLIC_ZITADEL_CLIENT_ID?: string;
      NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID?: string;
      NEXT_PUBLIC_GOOGLE_PICKER_API_KEY?: string;
      NEXT_PUBLIC_SHEETS_COMPUTE_WRITES_ENABLED?: string | boolean;
    };
  }
}

function runtimeOrEnv(key: keyof NonNullable<Window["runtimeConfig"]>, envVal: string | undefined, fallback: string): string {
  if (typeof window !== "undefined" && window.runtimeConfig?.[key] != null) {
    return String(window.runtimeConfig[key]);
  }
  return envVal ?? fallback;
}

export const BACKEND_URL = runtimeOrEnv("BACKEND_URL", process.env.NEXT_PUBLIC_BACKEND_URL, "http://localhost:8000");

export const AUTH_ENABLED =
  typeof window !== "undefined" && window.runtimeConfig?.NEXT_PUBLIC_AUTH_ENABLED != null
    ? window.runtimeConfig.NEXT_PUBLIC_AUTH_ENABLED !== false && window.runtimeConfig.NEXT_PUBLIC_AUTH_ENABLED !== "false"
    : process.env.NEXT_PUBLIC_AUTH_ENABLED !== "false";

export const ZITADEL_ISSUER = runtimeOrEnv("NEXT_PUBLIC_ZITADEL_ISSUER", process.env.NEXT_PUBLIC_ZITADEL_ISSUER, "");

export const ZITADEL_CLIENT_ID = runtimeOrEnv("NEXT_PUBLIC_ZITADEL_CLIENT_ID", process.env.NEXT_PUBLIC_ZITADEL_CLIENT_ID, "");

/**
 * OAuth client id for the Google Picker, and its (optional) developer key.
 *
 * The Picker runs in this browser and signs the viewer in with their own
 * Google account, so it needs a Web OAuth client of its own — a different
 * thing from the service account the backend impersonates, and one nobody has
 * created yet. Empty is the normal state: the "Pick from Drive" button hides
 * itself and pasting the spreadsheet's URL does the whole job, so nothing here
 * blocks on it.
 */
/**
 * Whether generated-code (tier-2) sheet *write* bindings are offered at all.
 *
 * Mirrors the backend's SHEETS_COMPUTE_WRITES_ENABLED, and defaults OFF for
 * the same reason: a generated read is wrong in a response, a generated write
 * is wrong in somebody's spreadsheet. With this off the UI does not show a
 * disabled button — it does not offer the capability, which is the honest way
 * to represent something the backend will refuse.
 */
export const SHEETS_COMPUTE_WRITES_ENABLED =
  typeof window !== "undefined" && window.runtimeConfig?.NEXT_PUBLIC_SHEETS_COMPUTE_WRITES_ENABLED != null
    ? window.runtimeConfig.NEXT_PUBLIC_SHEETS_COMPUTE_WRITES_ENABLED === true ||
      window.runtimeConfig.NEXT_PUBLIC_SHEETS_COMPUTE_WRITES_ENABLED === "true"
    : process.env.NEXT_PUBLIC_SHEETS_COMPUTE_WRITES_ENABLED === "true";

export const GOOGLE_PICKER_CLIENT_ID = runtimeOrEnv("NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID", process.env.NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID, "");
export const GOOGLE_PICKER_API_KEY = runtimeOrEnv("NEXT_PUBLIC_GOOGLE_PICKER_API_KEY", process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY, "");
