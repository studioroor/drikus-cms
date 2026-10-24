# Astro starter for Drikus CMS

A small website (a bakery, in Dutch) that is ready to be edited in
[Drikus CMS](https://github.com/studioroor/drikus-cms): news posts, a homepage made of blocks, and
the business details (address, phone, opening hours).

| What the client edits | Where it's stored                                 | Shown on              |
| --------------------- | ------------------------------------------------- | --------------------- |
| **Nieuws**            | `src/content/posts/*.md`                          | `/nieuws/`, homepage  |
| **Homepage**          | `src/content/pages/home.json` (blocks)            | `/`                   |
| **Gegevens**          | `src/data/settings.json`                          | footer of every page  |
| Uploaded images       | `public/uploads/` (resized to WebP by the CMS)    | `/uploads/…`          |

The CMS configuration is [`.drikus/config.yml`](.drikus/config.yml). The Astro side is
[`src/content.config.ts`](src/content.config.ts) for the posts and direct JSON imports for the
homepage and details. When you add a field, add it in both places.

## Start a new client site

```sh
bunx degit studioroor/drikus-cms/examples/astro-starter klant-naam
cd klant-naam
bun install
bun run dev          # http://localhost:4321
```

(`npm install` / `npm run dev` work too.) Then make it the client's own: change the texts in
`src/content` and `src/data`, the colours in `src/layouts/Layout.astro`, `public/favicon.svg`, and
`site` in `astro.config.mjs`.

Push it to a new repository in the `studioroor` organization and follow
[Adding a client site](https://github.com/studioroor/drikus-cms/blob/main/docs/onboarding.md).

## Hosting

The CMS only commits to `main`. The host builds the site and the CMS shows how that's going
("Je wijzigingen staan live!"). Use one of these:

**GitHub Pages** (included): in the repository go to _Settings → Pages_ and set _Source_ to
**GitHub Actions**. Every push runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
Add the client's domain under _Custom domain_ and set it as `site` in `astro.config.mjs`.

**Cloudflare Pages**: delete `.github/workflows/deploy.yml`, then in Cloudflare go to
_Workers & Pages → Create → Pages → Connect to Git_ and pick the repository. Use framework preset
**Astro**, build command `bun run build`, output directory `dist`. Cloudflare reports each build
on the commit, which the CMS shows as the deploy status.

Publish the site on its own domain or subdomain (not `user.github.io/repo/`): images uploaded in
the CMS are linked from the root, as `/uploads/photo.webp`.
