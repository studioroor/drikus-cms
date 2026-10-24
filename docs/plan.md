# Drikus CMS — Plan

## Context

Drikus hosts many small client sites (Astro and plain static sites on GitHub/Cloudflare Pages) and wants to stop paying for WordPress hosting. The goal is **one self-hosted, Git-based CMS for all clients**, an alternative to Decap, Sveltia and Pages CMS, with one key difference: **clients never need a GitHub account**. Drikus CMS manages its own accounts. It writes to the repos through a single **GitHub App** that Drikus owns. It must be very easy for non-technical editors, secure (clients must never touch another client's repo), and run as one container with SQLite on a Synology NAS or Fly.io. Email sending is out of scope for now; Drikus hands out the links himself.

The repo is empty (only `README.md`), so this is a greenfield build.

## Decisions (from the brainstorm)

| Topic              | Decision                                                                                                                                                                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack              | **Bun + Hono** API, **React SPA** (Vite, TanStack Router + Query), **Drizzle ORM on `bun:sqlite`**, **Tailwind + shadcn/ui**, **Tiptap** rich text, **Zod** everywhere                                                                                                                                                      |
| Hosting            | One Docker image plus a volume (`/data`) on Synology or Fly.io. No Vercel. Daily SQLite snapshots in `/data/backups` (Litestream was considered, not needed)                                                                                                                                                                |
| Repo ownership     | All client repos sit under the `studioroor` org. The GitHub App is installed once there                                                                                                                                                                                                                                     |
| Site support       | Core is format-based (md/mdx/json/yaml at configured paths), so plain sites work. Astro gets extra helpers                                                                                                                                                                                                                  |
| Schema             | Lives in the repo at `.drikus/config.yml` (YAML/JSON only, **never executable TS**, see Security)                                                                                                                                                                                                                           |
| Media              | Committed into the repo (e.g. `public/uploads`), resized and converted to WebP before commit                                                                                                                                                                                                                                |
| Save flow          | Autosaved **drafts in SQLite**. **Publish** writes all pending changes as **one atomic commit** to the default branch                                                                                                                                                                                                       |
| Editor UX          | Forms generated from the schema, rich text, and **reorderable page blocks** (hero, text+image, FAQ, …)                                                                                                                                                                                                                      |
| Roles              | **Superadmin** (Drikus) and per-site **Editor**. Only the superadmin creates accounts and assigns sites                                                                                                                                                                                                                     |
| Login              | Email + password (Argon2id via `Bun.password`), optional TOTP 2FA (**required for superadmin**). One-time invite/reset links                                                                                                                                                                                                |
| UI language        | Dutch + English, set per user                                                                                                                                                                                                                                                                                               |
| Content i18n       | Optional per site (locales declared in config)                                                                                                                                                                                                                                                                              |
| Preview v1         | Deploy status + "View site" link after publish. Branch preview deploys come in a later phase                                                                                                                                                                                                                                |
| Deploy             | **The CMS only commits.** Each repo's own GitHub Actions workflow, or the Cloudflare Pages Git integration, builds and deploys. The CMS reads the deploy status from the **check runs and commit statuses on the published commit SHA**, which works for both. No artifact uploads and no Cloudflare credentials in the CMS |
| GitHub org         | The App is owned by and installed on the **`studioroor`** org (not the personal `drikusroor` account)                                                                                                                                                                                                                       |
| Concurrent editors | Drafts are per site+path (shared, last write wins). Show a soft notice: "Anna also edited this page 5 min ago". No locking. Revisit if it ever becomes a real problem                                                                                                                                                       |

## Architecture

```
apps/server   Hono API (Bun.serve), serves the built SPA, webhook endpoint, CLI
apps/web      React SPA (Vite) – admin + editor UI, i18n (NL/EN)
packages/config   Zod schema for .drikus/config.yml + field-type definitions + JSON Schema export
packages/shared   shared types; Hono RPC client types (type-safe API calls)
```

- Bun workspaces, Biome (lint/format), `bun test`, Playwright for e2e.
- Hono RPC (`hc<AppType>`) gives a type-safe client in the SPA without codegen.
- **Admin CLI/TUI** (`bun run cli`) for bootstrap and ops: create the first superadmin, reset passwords/2FA, list sites/users, run migrations. On first boot with no users, a one-time setup token is printed to the logs as a fallback.
- Single multi-stage Dockerfile → `oven/bun` slim image. Ships `fly.toml` and `docker-compose.yml` (Synology). SQLite runs in WAL mode at `/data/drikus.db`, with uploads staged under `/data/staging`.

## GitHub App integration

- Drikus creates **one GitHub App** with these permissions: Contents RW, Metadata R, Checks R, Commit statuses R, Actions R, and later Pull requests RW. Webhooks: `push`, `installation`, `installation_repositories`.
- App ID, private key and webhook secret come from **env/Docker secrets**, never from the DB.
- The server signs a JWT, gets an **installation token**, and caches it in memory until shortly before expiry.
- **Per-request scoping**: every token minted for a site request is limited to `repository_ids: [site.repoId]` and only the permissions it needs. Even a server bug cannot then write to another client's repo with that token.
- **Linking a site**: the superadmin picks a repo from the installation's repo list. The site is stored by **GitHub repo ID** (survives renames) plus branch and site URL.
- **Webhooks** (HMAC-verified) refresh the cached head SHA, re-validate `.drikus/config.yml` on change, and mark drafts as stale when upstream changes their files.
- **Commits** go through the Git Data API: blobs → tree → commit → `PATCH ref` (no force). The author is the editor's name with a noreply email, plus a `Drikus-CMS-User:` trailer, so you can always see who changed what.
- **Concurrency**: each draft stores its `base_sha`. At publish, any file changed upstream since then gets a friendly "this page was changed elsewhere" dialog (keep mine / take theirs). A non-fast-forward ref update rebuilds the tree on the new head and retries.

### GitHub App configuration (decided)

- Owned by the `studioroor` org and installable only on that account. **No OAuth: no callback URL, and no "request user authorization".** Clients never touch GitHub.
- Repo permissions: Contents RW, Metadata R, Checks R, Commit statuses R, Actions R. No org or account permissions.
- Webhook URL: `<PUBLIC_URL>/api/github/webhook`. Subscribed events: Push, Check run, Status, Workflow run. The installation events are delivered automatically.
- Optional Setup URL: `<PUBLIC_URL>/admin/sites` with "Redirect on update" checked.
- **Webhooks are optional.** If the CMS isn't publicly reachable (e.g. a NAS kept off the internet), the server falls back to checking the branch head SHA when a site is opened and polls deploy status after publish.
- New env vars in phase 2: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_FILE` (default `/data/github-app.pem`) or `GITHUB_APP_PRIVATE_KEY` (base64), and `GITHUB_WEBHOOK_SECRET`. The installation ID is discovered automatically via `GET /orgs/studioroor/installation` (org configurable with `GITHUB_ORG`).
- An admin "GitHub" status panel shows: App reachable, installation found, number of repos accessible, and whether webhooks have been received recently.

## Authorization & security model (the "can't edit someone else's repo" part)

1. **Clients never send repo names or arbitrary paths.** The API is `/api/sites/:siteId/collections/:collection/entries/:slug`. The server resolves the repo and the file path itself from the site record and the config.
2. **Membership middleware** on every `/api/sites/:siteId/*` route: superadmin, or a row in `site_members(user_id, site_id)`. Anything else returns 404 (it does not leak whether the site exists).
3. **Path allow-list**: the resolved paths must match a collection's folder/file or the media folder. Paths are normalised, and `..`, absolute paths, symlinks and `.github/**` / `.drikus/**` / workflow files are rejected. Editors can never change the schema or CI.
4. **Scoped installation tokens** (above) as defence-in-depth.
5. **Sessions**: opaque random token in an `HttpOnly; Secure; SameSite=Lax` cookie, stored **hashed** in SQLite, with idle and absolute expiry and revocation on password change. CSRF: Origin check plus a custom header on mutations.
6. **Passwords**: Argon2id, login rate limiting and lockout per IP and per account, TOTP 2FA, and one-time invite/reset tokens (hashed, single use, 72h).
7. **Content safety**: rich text is stored as Markdown/sanitised HTML, the config is parsed as data only (no code execution from client repos = no RCE), and uploads are type-sniffed, size-limited and re-encoded. SVG is blocked for editors (XSS) unless the config allows it and it is sanitised.
8. Strict CSP, security headers, an **audit log** (logins, publishes, membership changes), and dependency audit in CI.

## Data model (SQLite / Drizzle)

`users` (email, name, password_hash, role, locale, totp_secret_enc, disabled_at) · `sessions` (token_hash, user_id, expires_at, ip, ua) · `auth_tokens` (invite/reset, hash, expires, used_at) · `sites` (name, repo_id, repo_full_name cache, branch, site_url, config_cache, head_sha) · `site_members` (user_id, site_id) · `drafts` (site_id, path, content, base_sha, updated_by, updated_at) · `staged_media` (site_id, path, file on volume, size) · `publishes` (site_id, user_id, commit_sha, status, deploy_url) · `file_cache` (blob_sha → content, content-addressed, immutable) · `audit_log`.

**Cache & sync**: repo trees and blobs are cached by SHA, so they never go stale. A webhook-driven head SHA means listing pages is instant and the GitHub API is hit only when the head changes.

## `.drikus/config.yml` (sketch)

```yaml
site: { name: "Bakkerij Jansen", url: "https://bakkerijjansen.nl" }
media: { folder: public/uploads, publicPath: /uploads, maxWidth: 2000 }
i18n: { locales: [nl, en], default: nl, structure: folders } # optional
collections:
  - name: posts # many entries
    label: { nl: Nieuws, en: News }
    folder: src/content/posts
    format: md # md | mdx | json | yaml
    slug: "{{title}}"
    fields:
      - { name: title, type: string, required: true }
      - { name: date, type: date }
      - { name: cover, type: image }
      - { name: body, type: richtext }
  - name: home # singleton
    file: src/content/pages/home.json
    fields:
      - name: sections
        type: blocks
        blocks:
          - { name: hero, fields: [{ name: heading, type: string }, { name: image, type: image }] }
          - {
              name: faq,
              fields:
                [
                  {
                    name: items,
                    type: list,
                    fields: [{ name: q, type: string }, { name: a, type: text }],
                  },
                ],
            }
```
Field types in v1: string, text, richtext, number, boolean, date, datetime, select, image, file, url, color, slug, list, object, blocks, reference. The JSON Schema export gives Drikus autocomplete in VS Code.

## Editor UX principles

- The home screen lists "your websites" (skipped if there is only one), then plain-language collections ("Nieuws", "Homepage") with no file or Git vocabulary anywhere.
- Big, calm forms with field labels and help text from the config, live validation, and autosave with a "Saved as draft" indicator.
- One prominent **Publish** button showing a change count ("3 changes ready"). After publishing, a progress view tracks the deploy (via check runs/statuses) and then shows "Live: view site".
- Blocks: add from a visual picker, drag to reorder, collapse/expand, duplicate.
- Images: drag-drop, client-side preview, crop/alt text (alt text required for accessibility), and a media library per site.
- Mobile-friendly. Plenty of empty states and undo (discard draft).

## Build phases

0. **Scaffold**: workspaces, Biome, tsconfig, Hono + Vite skeleton, Drizzle + migrations, Dockerfile, GitHub Actions CI (lint, typecheck, test).
1. **Accounts**: superadmin bootstrap CLI, login/logout, sessions, invite/reset links, TOTP, rate limiting, user and site admin screens, site membership, NL/EN i18n.
2. **GitHub App**: app auth + scoped tokens, installation repo picker, site↔repo link by ID, webhook endpoint, tree/blob cache.
3. **Schema + editor**: config Zod parser, collection/entry listing, form renderer with all field widgets, Tiptap, blocks, drafts with autosave.
4. **Publish**: atomic multi-file commit, conflict handling, publish history, deploy status.
5. **Media**: upload → staging → resize/WebP (`sharp`) → committed on publish; media library.
6. **Content i18n**: locale switcher and per-locale file structures.
7. **Ops & docs**: `fly.toml`, Synology `docker-compose.yml`, daily database snapshots, README with GitHub App setup and backups, an Astro starter (`examples/astro-starter`) and an onboarding guide.

Later: branch preview deploys, PR/review mode per site, email (invites/notifications), passkeys, an Astro helper package that generates `content.config.ts` from the Drikus config, a visual on-page editor.

## Verification

- `bun test` covers the config parser, path allow-list (traversal attempts), membership middleware (user A cannot read or write site B → 404), session/CSRF, token hashing, and the commit-tree builder. GitHub is behind an interface with a fake implementation.
- Playwright e2e against the fake GitHub: superadmin creates a client via an invite link, the client logs in, edits, sees the autosaved draft, and publishes. The fake records exactly one commit containing the expected files.
- Manual integration against a real test GitHub App plus a sandbox Astro repo: publish → commit on `main` → Cloudflare/GitHub Pages deploy → status shown in the CMS.
- `docker build` + `docker run -v data:/data` smoke test. Restart the container to confirm data persists.

## First implementation step after approval

Phases 0 + 1 (scaffold + accounts), committed and pushed to `claude/eager-carson-k6lz3o`.
