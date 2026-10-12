// Runtime configuration, loaded before the app. Deployments overwrite this file
// to point a prebuilt static export at their own backend and identity provider.
window.runtimeConfig = {
  BACKEND_URL: "http://localhost:8000",
  NEXT_PUBLIC_AUTH_ENABLED: false,
  NEXT_PUBLIC_ZITADEL_ISSUER: "",
  NEXT_PUBLIC_ZITADEL_CLIENT_ID: "",
  NEXT_PUBLIC_SHOW_RAW_JSON: false,
};
