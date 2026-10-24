# Drikus CMS

A self-hosted, Git-based CMS for the small static websites a freelancer builds and hosts for clients.
It is an alternative to Decap, Sveltia and Pages CMS. **Clients never need a GitHub account:**
Drikus CMS manages its own users and writes to repositories through a single GitHub App.
- One CMS for all client sites (Astro, or any static site that reads Markdown/JSON/YAML)
- Simple, friendly editing for non-technical people (Dutch and English UI)
- Runs as a single Docker container with SQLite, on a Synology NAS or Fly.io

The full design and roadmap is in [`docs/plan.md`](docs/plan.md).
How to describe a site's content is in [`docs/content-config.md`](docs/content-config.md).
Adding a client site, step by step: [`docs/onboarding.md`](docs/onboarding.md), starting from the
[Astro starter](examples/astro-starter).

## Status

| Phase | What                                                                                  | State |
| ----- | ------------------------------------------------------------------------------------- | ----- |
| 0     | Scaffold: Bun workspaces, Hono, React, Drizzle/SQLite, Docker, CI                     | ✅    |
| 1     | Accounts: superadmin, invites, sessions, 2FA, users/sites/memberships, audit log, CLI | ✅    |
| 2     | GitHub App: scoped installation tokens, repo linking, webhooks, cache                 | ✅    |
| 3     | Content schema (`.drikus/config.yml`) + editor                                        | ✅    |
| 4     | Drafts → one-commit publish, deploy status                                            | ✅    |
| 5     | Media uploads                                                                         | ✅    |
| 6     | Multilingual content                                                                  | ✅    |
| 7     | Ops & docs: Fly.io/Synology deploy, daily backups, Astro starter, onboarding guide    | ✅    |

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **API:** [Hono](https://hono.dev) with typed RPC client, Zod validation
- **Database:** SQLite (`bun:sqlite`, WAL) via [Drizzle ORM](https://orm.drizzle.team)
- **Web:** React 19 SPA, Vite, TanStack Router + Query, Tailwind CSS v4, i18next

```
apps/server   Hono API, auth, admin CLI, serves the built SPA
apps/web      React SPA (admin + editor UI)
deploy/       docker-compose (Synology) and fly.toml
docs/         design plan, content configuration, onboarding
examples/     Astro starter site for new clients
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
- `backups/` holds the daily snapshots (see [Backups](#backups)).

| Variable                      | Default                      |                                                                      |
| ----------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `PUBLIC_URL`                  | `http://localhost:3000`      | Public address; used for invite links and CSRF origin checks         |
| `DATA_DIR`                    | `./data` (`/data` in Docker) | Database and key location                                            |
| `PORT`                        | `3000`                       |                                                                      |
| `TRUST_PROXY`                 | `false`                      | Set `true` behind one reverse proxy so rate limiting sees client IPs |
| `SECRET_KEY`                  | generated                    | Optional base64 32-byte key instead of `secret.key`                  |
| `REQUIRE_ADMIN_2FA`           | `true`                       | Set `false` to make two-step verification optional for superadmins   |
| `BACKUP_KEEP`                 | `7`                          | Daily database snapshots to keep; `0` turns them off                 |
| `BACKUP_DIR`                  | `$DATA_DIR/backups`          | Where the snapshots go                                               |
| `GITHUB_APP_ID`               | unset                        | Enables the GitHub integration                                       |
| `GITHUB_APP_PRIVATE_KEY_FILE` | `$DATA_DIR/github-app.pem`   | Private key of the GitHub App                                        |
| `GITHUB_APP_PRIVATE_KEY`      | unset                        | Alternative: the key as PEM text or base64 (e.g. for Fly secrets)    |
| `GITHUB_WEBHOOK_SECRET`       | unset                        | Enables `/api/github/webhook`; without it the CMS polls GitHub       |
| `GITHUB_ORG`                  | `studioroor`                 | Account the app is installed on                                      |

**Synology:** copy [`deploy/docker-compose.yml`](deploy/docker-compose.yml) into a Container
Manager project, set `PUBLIC_URL`, and point a reverse proxy rule (with HTTPS) at port 3000.

**Fly.io:** see the comments in [`deploy/fly.toml`](deploy/fly.toml). Run exactly one machine
with one volume, because SQLite is a single file: deploy with `--ha=false`, and check
`fly machines list`. A second machine would have its own, separate database.

**Admin CLI in Docker:** `docker exec -it drikus-cms drikus help`. It can create admins, print
invite/reset links, reset 2FA, enable or disable users, and make or list backups.

## Backups

The website content is safe in Git. The CMS database holds what isn't: accounts, 2FA seeds,
memberships, drafts that haven't been published, uploads waiting for the next publish, and the
publish history.

Once a day the CMS writes a **snapshot** of the database to `/data/backups`
(`drikus-<date>T<time>Z.db`, the last 7 by default, see `BACKUP_KEEP`). A snapshot is a complete
SQLite file, made safely while the CMS runs. `backups/secret.key` is a copy of the key the 2FA seeds
are encrypted with (not when the key comes from `SECRET_KEY`; keep that one yourself). Make one
right away with `drikus backup`, and list them with `drikus backups`.

Copy the snapshots somewhere else:
- **Synology:** add the project's `data/backups` folder to a **Hyper Backup** task (to another NAS,
  a USB disk or C2). Back up `backups/`, not the live `drikus.db`: a copy of a database that's being
  written can be broken.
- **Fly.io:** volumes get daily snapshots (`fly volumes snapshots list <volume>`). For a copy off
  Fly: `fly ssh sftp get /data/backups/<file> -c deploy/fly.toml`.

**Restore:**
1. Stop the CMS.
2. Copy the snapshot over `data/drikus.db`, and delete `drikus.db-wal` and `drikus.db-shm` if they
   exist.
3. Make sure `data/secret.key` is the key from the same backup.
4. Start the CMS. Migrations bring an older snapshot up to date.

Drafts and uploads made after the snapshot are lost. Published content is in Git and isn't affected.

## Moving to another host

Everything lives in `/data`, so moving (for example from Fly.io to a Synology) means taking a fresh
snapshot along:
1. **Ask editors to publish or finish their changes**, then make a snapshot on the old host and
   download it with the key. On Fly.io:

   ```sh
   fly ssh console -c deploy/fly.toml -C "drikus backup"
   fly ssh sftp get /data/backups/<newest>.db drikus.db -c deploy/fly.toml
   fly ssh sftp get /data/secret.key secret.key -c deploy/fly.toml
   ```

   (Skip `secret.key` if you use `SECRET_KEY`; set the same value on the new host.)
2. **New host:** put `drikus.db` and `secret.key` in its `data` folder (for Synology, next to
   `docker-compose.yml`), together with the GitHub App key as `github-app.pem`, or keep using
   `GITHUB_APP_PRIVATE_KEY`. Set the same `GITHUB_APP_ID` and `GITHUB_WEBHOOK_SECRET`, plus the new
   `PUBLIC_URL` and `TRUST_PROXY=true`. Start it and check `/api/health` and the log.
3. **Synology:** add a reverse proxy rule (_Control Panel → Login Portal → Advanced → Reverse
   Proxy_) from `https://<your domain>:443` to `http://localhost:3000`, with a certificate for the
   domain (_Security → Certificate_).
4. **GitHub App:** change the webhook URL (and the homepage URL) to the new `PUBLIC_URL`. Check
   _Advanced → Recent deliveries_ after the next publish.
5. **DNS:** point the domain at the new host. If the address changed, everyone logs in again
   (sessions belong to a domain), and invite links made before the move point to the old one.
6. Stop the old host once everything works (`fly scale count 0`), and remove it after a week or so.

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
