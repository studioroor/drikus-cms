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

| `type`             | Stores                                                                   | Options                                                         |
| ------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `string` (default) | text                                                                     | `maxLength`                                                     |
| `text`             | multi-line text                                                          | `maxLength`                                                     |
| `richtext`         | Markdown, edited visually (bold, headings, lists, links, quotes, images) | `imageStyles`, see below                                        |
| `markdown`         | Markdown in a plain text box (use for MDX)                               |                                                                 |
| `number`           | number                                                                   | `min`, `max`, `step`                                            |
| `boolean`          | `true`/`false`                                                           |                                                                 |
| `date`             | `YYYY-MM-DD`                                                             |                                                                 |
| `datetime`         | `YYYY-MM-DDTHH:mm`                                                       |                                                                 |
| `select`           | one value, or a list with `multiple: true`                               | `options: [a, b]` or `[{ label, value }]`                       |
| `reference`        | the slug of an entry in another folder collection                        | `collection`, `multiple`                                        |
| `image`, `file`    | a path such as `/uploads/photo.jpg` (uploading arrives in a later phase) |                                                                 |
| `url`              | a link                                                                   |                                                                 |
| `color`            | `#rrggbb`                                                                |                                                                 |
| `object`           | a group of fields                                                        | `fields`                                                        |
| `list`             | a list of groups (`fields`) or of single values (`field`)                | `minItems`, `maxItems`                                          |
| `blocks`           | a list of typed sections, each `{ type: <block name>, …fields }`         | `blocks: [{ name, label, fields }]`, `typeKey` (default `type`) |
| `hidden`           | kept as is, not shown                                                    |                                                                 |

### Images in rich text

Images in a `richtext` field are stored as Markdown: `![alt text](/uploads/photo.jpg "Caption")`.
They can stand on their own line or sit inside a paragraph, so text flows around them. The
editor previews paths starting with `/` from the site's URL.

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

## Drafts

Changes are saved automatically as **drafts** in the CMS database while an editor types. Nothing
reaches GitHub yet. Drafts are shared per file: if two people edit the same page, the last save
wins and the page shows who edited it last. Publishing all drafts as one commit is phase 4.
