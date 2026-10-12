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

`cloudbuild.yaml` is an example pipeline deploying the static export to a GCS
bucket behind a CDN; set its substitutions on your own trigger.
