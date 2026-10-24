# Adding a client site

A checklist for putting a new client's website in Drikus CMS. It assumes the CMS is running and
the GitHub App is set up (see the [README](../README.md#github-app-setup)).

## 1. Create the repository

Start from the [Astro starter](../examples/astro-starter) (or add a `.drikus/config.yml` to an
existing site, see [content configuration](content-config.md)):

```sh
bunx degit studioroor/drikus-cms/examples/astro-starter klant-naam
cd klant-naam && bun install && bun run dev
```

Make it the client's own (texts, colours, favicon, `site` in `astro.config.mjs`), then create a
repository **in the `studioroor` organization** and push it to `main`.

## 2. Set up hosting

The CMS only commits; the host builds and publishes.
- **GitHub Pages:** _Settings → Pages → Source: GitHub Actions_. The starter's
  `.github/workflows/deploy.yml` runs on every push. Add the client's domain under _Custom
  domain_.
- **Cloudflare Pages:** delete `.github/workflows/deploy.yml` and connect the repository in
  Cloudflare (preset **Astro**, build `bun run build`, output `dist`).

Use the site's own domain or subdomain: uploaded images are linked as `/uploads/…`.

## 3. Give the CMS access

On GitHub: **organization settings → GitHub Apps → your app → Configure → Repository access**,
and add the new repository to _Only select repositories_. The CMS can't see repositories that
aren't in this list.

## 4. Add the site in the CMS

**Admin → Sites → Add site**: pick the repository (the list refreshes from GitHub), and fill in
the name and the **Website address** so the CMS can link to the live site. The site shows a
warning if `.drikus/config.yml` is missing or has errors.

## 5. Invite the client

**Admin → Users → Add user**: their email, name, language, role **Editor**, and tick their
website. Copy the invite link and send it yourself (the CMS doesn't send email). The link works
once and expires after 72 hours; **Admin → Users** can make a new one.

## 6. Test it

Log in as the client (or open the site yourself), change a text, and click **Publish**. Check that:
- the commit appears on GitHub, authored by the editor's name
- the publish dialog shows _Updating the website…_ and then _Your changes are live!_
- **View website** shows the change

## Troubleshooting

| Problem                                    | Cause and fix                                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository missing from the list in step 4 | Not in the app's repository access (step 3). Refresh the list afterwards.                                                                                                                                          |
| "The configuration has errors"             | The CMS lists the problems by path. Fix `.drikus/config.yml` in the repo; the CMS picks it up on the next push.                                                                                                    |
| No deploy status after publishing          | Pages isn't set to _GitHub Actions_, the workflow is missing, or Cloudflare isn't connected. With nothing reporting, the dialog shows _Updating the website…_ for a few minutes and then only says it's published. |
| Deploy failed                              | Open the run from the publish dialog. Usually a content field the site's code doesn't expect: keep `src/content.config.ts` in sync with the CMS config.                                                            |
| Images don't show on the live site         | The site is published under a sub-path (`user.github.io/repo/`). Use its own domain.                                                                                                                               |
