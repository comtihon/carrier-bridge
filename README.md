# Carrier Bridge

Web UI for building, running and supervising agent workflows on a
carrier backend: a workflow editor and canvas,
agents, scripts, datasources (REST, GraphQL, Google Sheets, Pub/Sub), events,
run history, approvals, and a CopilotKit chat panel.

Built with Next.js (static export), React and Tailwind.

## Development

```bash
npm install
cp .env.local.example .env.local   # point BACKEND_URL at your backend
npm run dev                        # http://localhost:3000
npm test
```

## Configuration

Settings come from `window.runtimeConfig` (`public/config.js`, which a
deployment overwrites) and fall back to `NEXT_PUBLIC_*` build-time variables —
see `src/lib/config.ts`:

| Key | Purpose |
| --- | --- |
| `BACKEND_URL` / `NEXT_PUBLIC_BACKEND_URL` | Backend base URL (default `http://localhost:8000`) |
| `NEXT_PUBLIC_AUTH_ENABLED` | `false` disables OIDC login |
| `NEXT_PUBLIC_ZITADEL_ISSUER`, `NEXT_PUBLIC_ZITADEL_CLIENT_ID` | OIDC issuer and client (any OIDC provider with PKCE) |
| `NEXT_PUBLIC_GOOGLE_PICKER_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_PICKER_API_KEY` | Optional Google Drive picker |
| `NEXT_PUBLIC_SHEETS_COMPUTE_WRITES_ENABLED` | Offer generated-code sheet write bindings |
| `NEXT_PUBLIC_SHOW_RAW_JSON` | Show the raw JSON inspector in run details |

## Releases and deployment

Every push to `main` runs CI (typecheck, tests, build), tags `v<VERSION>`,
publishes a GitHub Release with `carrier-bridge-v<VERSION>.tar.gz` (the static
export), and bumps the patch version.

The build is environment-agnostic. To deploy, unpack the tarball onto any
static host (bucket + CDN, nginx, ...) and overwrite `config.js` with your
settings:

```js
window.runtimeConfig = {
  BACKEND_URL: "https://carrier.example.com",
  NEXT_PUBLIC_AUTH_ENABLED: true,
  NEXT_PUBLIC_ZITADEL_ISSUER: "https://auth.example.com",
  NEXT_PUBLIC_ZITADEL_CLIENT_ID: "<client id>",
};
```

## License

Apache License 2.0 — see [LICENSE](LICENSE).
