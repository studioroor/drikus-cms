# Drikus CMS

A self-hosted, Git-based CMS for the small static websites a freelancer builds and hosts for clients.
It is an alternative to Decap, Sveltia and Pages CMS. **Clients never need a GitHub account:**
Drikus CMS manages its own users and writes to repositories through a single GitHub App.
- One CMS for all client sites (Astro, or any static site that reads Markdown/JSON/YAML)
- Simple, friendly editing for non-technical people (Dutch and English UI)
- Runs as a single Docker container with SQLite, on a Synology NAS or Fly.io

The full design and roadmap is in [`docs/plan.md`](docs/plan.md).

## Status

| Phase | What                                                                                  | State |
| ----- | ------------------------------------------------------------------------------------- | ----- |
| 0     | Scaffold: Bun workspaces, Hono, React, Drizzle/SQLite, Docker, CI                     | ✅    |
| 1     | Accounts: superadmin, invites, sessions, 2FA, users/sites/memberships, audit log, CLI | ✅    |
| 2     | GitHub App: scoped installation tokens, repo linking, webhooks, cache                 | ✅    |
| 3     | Content schema (`.drikus/config.yml`) + editor                                        | ⏳    |
| 4     | Drafts → one-commit publish, deploy status                                            | ⏳    |
| 5     | Media uploads                                                                         | ⏳    |
| 6     | Multilingual content                                                                  | ⏳    |

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **API:** [Hono](https://hono.dev) with typed RPC client, Zod validation
- **Database:** SQLite (`bun:sqlite`, WAL) via [Drizzle ORM](https://orm.drizzle.team)
- **Web:** React 19 SPA, Vite, TanStack Router + Query, Tailwind CSS v4, i18next

```
apps/server   Hono API, auth, admin CLI, serves the built SPA
apps/web      React SPA (admin + editor UI)
deploy/       docker-compose (Synology) and fly.toml
docs/         design plan
```

## Development

```sh
bun install
bun run dev          # API on :3000, web on http://localhost:5173 (proxies /api)
```

On first start with an empty database, the server prints a one-time **setup link** to create the
first superadmin. You can also use the CLI: `bun run cli create-admin you@example.com "Your Name"`.
Superadmins have to enable two-step verification (TOTP) before they can use the admin screens,
unless `REQUIRE_ADMIN_2FA=false` is set.

```sh
bun test             # API tests (in-memory SQLite)
bun run typecheck
bun run lint         # Biome
bun run build        # builds the web app into apps/web/dist
```

Changed `apps/server/src/db/schema.ts`? Generate a migration with
`bun run --cwd apps/server db:generate`. Migrations run automatically on start.

## Deployment

The image is published to `ghcr.io/studioroor/drikus-cms` by CI on every push to `main`
(amd64 and arm64). Everything that must persist lives in `/data`:
- `drikus.db` is the SQLite database.
- `secret.key` encrypts secrets such as 2FA seeds. **Back it up together with the database.**

| Variable                      | Default                      |                                                                    |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------ |
| `PUBLIC_URL`                  | `http://localhost:3000`      | Public address; used for invite links and CSRF origin checks       |
| `DATA_DIR`                    | `./data` (`/data` in Docker) | Database and key location                                          |
| `PORT`                        | `3000`                       |                                                                    |
| `TRUST_PROXY`                 | `false`                      | Set `true` behind a reverse proxy so rate limiting sees client IPs |
| `SECRET_KEY`                  | generated                    | Optional base64 32-byte key instead of `secret.key`                |
| `REQUIRE_ADMIN_2FA`           | `true`                       | Set `false` to make two-step verification optional for superadmins |
| `GITHUB_APP_ID`               | unset                        | Enables the GitHub integration                                     |
| `GITHUB_APP_PRIVATE_KEY_FILE` | `$DATA_DIR/github-app.pem`   | Private key of the GitHub App                                      |
| `GITHUB_APP_PRIVATE_KEY`      | unset                        | Alternative: the key as PEM text or base64 (e.g. for Fly secrets)  |
| `GITHUB_WEBHOOK_SECRET`       | unset                        | Enables `/api/github/webhook`; without it the CMS polls GitHub     |
| `GITHUB_ORG`                  | `studioroor`                 | Account the app is installed on                                    |

**Synology:** copy [`deploy/docker-compose.yml`](deploy/docker-compose.yml) into a Container
Manager project, set `PUBLIC_URL`, and point a reverse proxy rule (with HTTPS) at port 3000.

**Fly.io:** see the comments in [`deploy/fly.toml`](deploy/fly.toml). Run exactly one machine
with one volume, because SQLite is a single file.

**Admin CLI in Docker:** `docker exec -it drikus-cms drikus help`. It can create admins, print
invite/reset links, reset 2FA, and enable or disable users.

## GitHub App setup

Drikus CMS talks to GitHub as one GitHub App owned by your organization. Clients never log in to
GitHub, so the app has **no OAuth callback**.
1. Go to `https://github.com/organizations/<org>/settings/apps/new`.
2. Set **Homepage URL** to your `PUBLIC_URL`. Leave **Callback URL** empty and leave
   _Request user authorization (OAuth) during installation_ unchecked.
3. **Webhook:** set it to Active with URL `<PUBLIC_URL>/api/github/webhook`, and use a random
   secret (`openssl rand -hex 32`) as `GITHUB_WEBHOOK_SECRET`. If the CMS isn't reachable from the
   internet, leave the webhook inactive; the CMS then checks GitHub itself.
4. **Repository permissions:** Contents _Read and write_, Metadata _Read-only_, Checks
   _Read-only_, Commit statuses _Read-only_, Actions _Read-only_. No organization or account
   permissions.
5. **Events:** Push, Check run, Status, Workflow run.
6. **Where can it be installed:** only on this account.
7. After creating the app, note the **App ID** and generate a **private key**. Save the key as
   `data/github-app.pem` (`chmod 600`).
8. **Install App** → your org → _Only select repositories_. Add each client repo here as you
   onboard them. The CMS can only see repos in this list.

Then set `GITHUB_APP_ID` (and `GITHUB_WEBHOOK_SECRET`) and restart. **Admin → Sites** shows the
connection status and lets you link each site to a repository. Use the plug button to test the
connection.

## Security model

- Clients never send repo names or file paths. The server resolves everything from the site
  record, and every `/api/sites/:siteId/*` route checks membership. A site you can't access
  returns the same 404 as one that doesn't exist.
- Sites are linked by GitHub repository **ID**, which survives renames. Every GitHub call for a
  site uses an installation token scoped to _only that repository_, so even a bug can't reach
  another client's repo. Webhooks are verified with HMAC-SHA256 in constant time.
- Passwords are hashed with Argon2id. Logins are rate-limited per IP and per account, with
  generic errors and constant-ish timing.
- Sessions use opaque random tokens in `HttpOnly`, `SameSite=Lax` cookies (`__Host-` prefixed on
  HTTPS). Only the SHA-256 of a token is stored. Sessions have idle and absolute expiry and are
  revoked on password change, disable, or role change.
- CSRF: mutations require a custom header plus a same-origin `Origin`/`Sec-Fetch-Site`.
- Invite and reset links are single-use, expire, and are stored hashed. The token sits in the URL
  fragment, so it never reaches logs or `Referer` headers. A link never bypasses 2FA.
- TOTP seeds are encrypted at rest with AES-256-GCM, and replayed codes are rejected.
- Strict CSP, `frame-ancestors 'none'`, `no-store` on API responses, and an audit log of logins
  and admin actions.
