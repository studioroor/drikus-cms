# Content configuration (`.drikus/config.yml`)

Each website repository describes its editable content in `.drikus/config.yml`. You can also use
`.yaml` or `.json`. The CMS only ever reads this file as data and never runs code from a client
repository. Editors can't change it.

Add this line at the top to get autocomplete and validation in VS Code (with the YAML extension):

```yaml
# yaml-language-server: $schema=https://github.com/studioroor/drikus-cms/raw/main/schema/drikus-config.schema.json
```

A complete example is in [`examples/astro-bakery.config.yml`](examples/astro-bakery.config.yml).
If the file has errors, superadmins see them on the site's page in the CMS. Editors just see that
the site isn't ready for editing yet.

## Site icon

The CMS shows each site with its favicon or logo from the repository. It looks for the usual
files, such as `favicon.svg`, `icon.svg`, `apple-touch-icon.png`, `favicon.png`, `logo.svg` and
`favicon.ico`. It prefers files in `public/`, `static/`, `app/` or `assets/` and skips
`node_modules`, `dist` and other build folders. If it picks the wrong file, name the right one:

```yaml
icon: src/assets/brand/mark.svg
```

## Collections

| Key                    |              |                                                                                                                   |
| ---------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `name`                 | required     | Identifier: letters, digits, `-` and `_`                                                                          |
| `label`, `description` |              | Text, or `{ nl: …, en: … }` per UI language                                                                       |
| `folder`               | either this… | Folder with one file per entry, e.g. `src/content/posts`                                                          |
| `file`                 | …or this     | A single file, e.g. `src/content/pages/home.json`                                                                 |
| `format`               |              | `md`, `mdx`, `json` or `yaml`. Folders default to `md`; files use their extension                                 |
| `slug`                 |              | File name template for new entries, default `{{title}}`. Variables: any field, `{{year}}`, `{{month}}`, `{{day}}` |
| `summary`              |              | Field shown as the entry's title in lists (default: `title` or the first text field)                              |
| `sortBy`, `sortOrder`  |              | Sort lists by a field, `asc` (default) or `desc`                                                                  |
| `create`, `delete`     |              | Allow editors to add or delete entries (default `true`)                                                           |
| `fields`               | required     | The form, see below                                                                                               |

Paths can't start with `/`, contain `..`, or point inside `.git`, `.github` or `.drikus`. The CMS
only writes files directly inside a collection's folder (or its single file), and slugs are
limited to letters, digits, `-` and `_`.

In Markdown (`md`/`mdx`) files, a field named **`body`** holds the text below the frontmatter.
Frontmatter keys that aren't in `fields` (for example Astro's `layout`) are kept as they are.

## Fields

Every field has `name` (required), and optionally `label`, `hint`, `required` and `default`.

| `type`             | Stores                                                                    | Options                                                         |
| ------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `string` (default) | text                                                                      | `maxLength`                                                     |
| `text`             | multi-line text                                                           | `maxLength`                                                     |
| `richtext`         | Markdown, edited visually (bold, headings, lists, links, quotes, images)  | `imageStyles`, see below                                        |
| `markdown`         | Markdown in a plain text box (use for MDX)                                |                                                                 |
| `number`           | number                                                                    | `min`, `max`, `step`                                            |
| `boolean`          | `true`/`false`                                                            |                                                                 |
| `date`             | `YYYY-MM-DD`                                                              |                                                                 |
| `datetime`         | `YYYY-MM-DDTHH:mm`                                                        |                                                                 |
| `select`           | one value, or a list with `multiple: true`                                | `options: [a, b]` or `[{ label, value }]`                       |
| `reference`        | the slug of an entry in another folder collection                         | `collection`, `multiple`                                        |
| `image`, `file`    | a path such as `/uploads/photo.webp`, uploaded or picked from the library |                                                                 |
| `url`              | a link                                                                    |                                                                 |
| `color`            | `#rrggbb`                                                                 |                                                                 |
| `object`           | a group of fields                                                         | `fields`                                                        |
| `list`             | a list of groups (`fields`) or of single values (`field`)                 | `minItems`, `maxItems`                                          |
| `blocks`           | a list of typed sections, each `{ type: <block name>, …fields }`          | `blocks: [{ name, label, fields }]`, `typeKey` (default `type`) |
| `hidden`           | kept as is, not shown                                                     |                                                                 |

### Images in rich text

Images in a `richtext` field are stored as Markdown: `![alt text](/uploads/photo.jpg "Caption")`.
They can stand on their own line or sit inside a paragraph, so text flows around them. Editors
insert them from the media library (uploading right there if needed) and fill in the description
for screen readers in the image's settings.

If your site reads a hint after `#` in the image path (for example `photo.jpg#right` to float an
image), list the hints as `imageStyles` and editors can pick one per image:

```yaml
- name: body
  type: richtext
  imageStyles:
    - { value: right, label: { nl: Rechts naast de tekst, en: Right of the text } }
    - { value: left, label: Links naast de tekst }
    - { value: medium, label: Middelgroot }
    - small
```

What a hint does is up to your site; the CMS only writes it into the path.

## Images and files

Editors upload images and files from any `image` or `file` field (click or drag and drop), from
the image button in rich text, or pick earlier uploads from the **media library**. Tick **Not used yet** in the library to see
files that no collection file or pending draft mentions. Very large repositories may list only
part of their files; the library says so.

```yaml
media:
  folder: public/uploads # where uploads are committed (default)
  publicPath: /uploads # the URL the site serves that folder at (derived from folder)
  maxWidth: 2000 # wider images are scaled down (default 2000)
  format: webp # webp (default) or original (keep JPEG/PNG/GIF)
  quality: 82 # image quality, 40–100
  maxSizeMb: 15 # largest upload accepted
```

- Uploads are checked by their content, not their name. Accepted images: JPEG, PNG, WebP, GIF,
  AVIF (and HEIC when the server can decode it). Accepted files: PDF, Word/Excel/PowerPoint
  (`.docx`, `.xlsx`, `.pptx`), ZIP, TXT, CSV, MP3 and MP4. **SVG is refused**, because it can
  contain scripts.
- Images are rotated upright, scaled down to `maxWidth`, **stripped of metadata** (camera
  details, GPS location) and converted to WebP unless `format: original`.
- File names are made from the original name plus a short content hash
  (`taart-3fa9c1d2.webp`), so different files never collide and uploading the same file twice
  stores it once.
- Uploads wait in the CMS until the next **publish**, and are committed in the same commit as the
  content that uses them. Until then they are marked _new_ in the library and can still be
  deleted; published files stay (pages may use them).
- Previews in the editor come from the CMS itself, so new uploads show before they're published.
  Paths that aren't in the repository are previewed from the live site.

## Drafts and publishing

Changes are saved automatically as **drafts** in the CMS database while an editor types. Drafts
are shared per file: if two people edit the same page, the last save wins and the page shows who
edited it last.

**Publish** (on the site page, or from any changed page) puts all drafts of the site live in
**one commit** on the configured branch:
- The commit is created with the Git Data API, on top of the branch's current head, and the branch
  is moved without force. If someone pushed in the meantime, the CMS rebuilds the commit on the new
  head (up to three times).
- The commit author is the editor's name; the message lists the changed files and ends with a
  `Drikus-CMS-User:` trailer.
- Publishing is blocked until every change is ready:
  - **Required fields** must be filled in.
  - **Conflicts**: if a file changed on GitHub after the draft was started, the editor chooses
    _Use my version_ (overwrite) or _Keep the other version_ (drop the draft).
  - Drafts that no longer match the config (a collection was renamed or removed) can be discarded.
- Edits saved while a publish is running stay as drafts, on top of what was just published.

After publishing, the CMS follows the commit's **check runs and commit statuses** (GitHub Actions,
Cloudflare Pages, Netlify, …) and shows _updating the website…_, _live_ or _failed_. If a repository
has no checks at all, it shows _published_ after a few minutes. This needs the GitHub App's
_Checks_ and _Commit statuses_ read permissions; without them the deploy state is simply unknown.
Superadmins see links to the commits in the publish history.
