# List and media editing: design

Date: 2026-10-24 · Status: approved

> **Update after phase 5 (#8) merged.** Phase 5 already delivers most of sections 5 and 6:
> `MediaService` (`apps/server/src/content/media.ts`) lists repo images in the media folder plus
> staged uploads, maps content paths to repo paths (`pathForSrc`), and serves previews and
> thumbnails (160/400/800) at `GET /media/file?src=…&w=…`; the web app has `MediaField` (preview,
> upload/replace, choose from library, remove, edit path), `MediaPicker` (library with upload,
> search, delete of unpublished uploads), `DropZone`, and `previewUrl(src, siteId, w)`; the
> rich-text image button already opens the library. `media.publicPath` can be set explicitly, so
> hond-morvan works with `media: { folder: src/assets/images, publicPath: /images }`.
> Where this design differs (`/media/raw`, a separate `ImagePicker` with three tabs, `/data`
> thumbnail files, an `UPLOADS_AVAILABLE` switch) phase 5's implementation wins. What remains
> from sections 4–6: the photo grid for image lists, multi-select in `MediaPicker`, multi-file
> drop, thumbnails in list rows, the "Not used yet" filter, "already added" dimming, and the
> incomplete-listing notice for truncated trees.

## Why

Editors lose their way in long lists. Two real cases:

- **stylingbyvaleria → Reviews**: a `list` field with 27 items, most of them several paragraphs
  long. Every item is rendered as an open form, so finding one review means scrolling past all
  the others, and the Add button sits at the very bottom.
- **hond-morvan-v2 → Fotogalerij**: `galleryImages` is a list of ~45 single `image` values. Each
  one renders as a path text box, a hint line and a preview up to 160px tall: dozens of screens of
  scrolling to reorder or find a photo.

Image fields also only take a typed path or URL. Editors don't know the paths of the images in
their repo and can't add new ones.

The folder-collection index (e.g. hond-morvan's Gastenboek) already works well; it only needs
pagination and sorting as it grows.

Success: an editor can find, edit, reorder, add and remove a list item or photo without long
scrolling, can recognise image items at a glance, and can pick or upload an image without
knowing its path.

## Goals

1. A list editor for lists of objects: compact index + selected item side by side.
2. Thumbnails anywhere an item has an image, including nested lists.
3. Image fields as thumbnail cards; image lists as a sortable photo grid.
4. An image picker: choose an image already in the repo, upload a new one, or paste a URL.
5. Pagination and sorting on the folder-collection index.

## Non-goals

- No changes to the content config format beyond what's listed under "Config" below. Existing
  `.drikus/config.yml` files keep working unchanged and get the new UI automatically.
- No image editing (crop, focal point, filters) in this project.
- No media library page of its own (browsing/deleting media outside a field). The picker is the
  only entry point for now.
- No change to how `blocks` fields add blocks (type picker), beyond adopting the new index/detail
  layout and thumbnails described below.

## Anti-goals (would make this a failure even if it works)

- Losing content: reordering, removing or editing items must never drop unknown keys or items the
  schema doesn't describe (the server already preserves unknown keys; the UI must too).
- Forms inside forms inside forms. Nesting must stay one level visible at a time.
- Breaking autosave/drafts: every change still flows through the existing `onChange` → autosave
  path and lands in the same draft.
- A UI that only works on desktop. Every piece must be usable on a phone.

## Current state (for the builder)

- Field rendering: `apps/web/src/components/editor/fields.tsx` (`FieldList`, `FieldInput`,
  `ListInput`, `BlocksInput`, `ItemControls`, `itemTitle`). Lists of objects render every item
  fully expanded; lists of single values render a row per value; both put Add at the bottom.
  Reorder is up/down buttons only.
- Item identity: `keyFor` keys items via a `WeakMap` on item objects, but every edit replaces the
  item object (`{ ...value, [field.name]: v }`), so keys change on each keystroke and the subtree
  remounts (likely an existing focus-loss bug). Single-value items (strings) fall back to index
  keys. The new editor needs real per-item ids (see section 1).
- Image fields: path `Input` + hint + `previewUrl(text, siteUrl)`, i.e. previews load from the
  deployed site, so an image that isn't deployed yet has no preview.
- Entry page: `apps/web/src/routes/entry.tsx`, content in a `max-w-3xl` card.
- Collection index: `apps/web/src/routes/collection.tsx`; search appears above 6 entries; the
  server (`ContentService` list, `apps/server/src/content/service.ts`) sorts by `sortBy`/
  `sortOrder` and returns everything.
- Config: `apps/server/src/content/config.ts`. `media: { folder, publicPath }` already exists in
  the schema but nothing uses it yet. stylingbyvaleria sets it; hond-morvan doesn't.
- Repo access: the git tree and blobs are cached by SHA (`apps/server/src/github/sync.ts`; blobs
  in the `git_blobs` SQLite table). `SiteSync.tree()` returns a `truncated` flag nothing checks.
  Publishing (`publish.ts`) builds a tree via `createTree`, whose `TreeChange` takes text
  `content: string | null` only, and writes `gitBlobs` rows assuming UTF-8. `PublishService`
  throws `nothing_to_publish` without drafts; change counts, preview, summary, stored `changes`
  and the commit message all come from drafts.
- Path safety: the `RepoPath` zod schema plus `entryPathFor`/`slugForPath` in
  `content/paths.ts`. There is no generic allow-list function; a media-folder check is new.
  `.drikus/**` is protected, so the CMS can't edit a site's config itself.
- Rich text (`rich-text.tsx`, #5) keeps Markdown images, previews them from `siteUrl`, and has a
  toolbar button that inserts an image by typed path.
- Media upload is phase 5 of `docs/plan.md` (upload → staging → resize/WebP → committed on
  publish) and is **under construction separately**. See 6b for what this design needs from it.
- No drag-and-drop library in `apps/web` yet.

## Design

Mockups from the brainstorm (approved): option **A, side by side**, with thumbnails; photo grid;
picker with three tabs.

### 1. List editor (lists of objects)

Applies to `list` fields with `fields` (lists of objects). Lists with `field` (single values)
are covered by section 2 when the value is an image; other single-value lists (tags, links) stay
inline as they are today, but get the sticky toolbar and drag reorder.

**Layout (wide screens):** the list field becomes a two-pane panel.

- **Toolbar** (sticky to the top of the panel while it scrolls): field label + item count,
  search box (filters the index by the item's title and other text fields), and the primary
  **+ Add** button. Add appends a new item, selects it, and focuses its first input.
- **Left pane, the index**: one compact row per item. A drag handle, a thumbnail (see below), the
  title (`itemTitle`), and a muted one-line snippet from the next text field. The selected row is
  highlighted. Rows with validation problems (`missing` paths under that item) show a small
  warning dot. Drag to reorder; keyboard reorder via the row's menu (Move up / Move down / Move
  to top / Move to bottom), so the current up/down buttons' function survives without a mouse.
- **Right pane, the item**: the selected item's `FieldList`, with a header showing its title,
  Delete, and ‹ previous / next › links. With no selection (e.g. empty list), an empty state with
  the Add button.
- The default selection is the first item.
- **Item ids:** the editor keeps a parallel array of ids per list in component state (generated
  on load, moved along on reorder, added/removed with items), used for React keys, selection and
  drag. Ids are never written into the content. This replaces `keyFor` for lists.

**Narrow screens (phone / narrow container):** the same component switches to click-through:
the index fills the width; tapping a row replaces it with the item view, which has a back link
(breadcrumb) and previous/next. The breakpoint is based on the panel's container width, not the
viewport, because the editor sits inside a `max-w-3xl` card. *Builder's call: whether the
entry page widens for list-heavy entries so A has room on desktop. Recommended: widen the card
when the entry has a list-of-objects field, since a two-pane editor in 768px is tight.*

**Selection in the URL:** the selected item path is kept in the route's search params (e.g.
`?item=reviews.4` or `?item=services.1.packages.0`) so reload, back/forward and sharing a link
keep the place. One `item` param holds the full drilled-in path; selecting uses history
*replace* (so Back leaves the entry rather than stepping through every click), drilling into a
nested list uses *push* (so Back steps out one level). Reordering updates the param to follow
the moved item; deleting moves it to the neighbour. The entry route gets a `validateSearch`.

**Short lists:** a list of objects with ≤ 3 items whose fields are all short (no `text`,
`markdown`, `richtext`, nested `list`/`blocks`) may render inline as today. *Builder's call;
the threshold is a guess, not something the user asked for. When in doubt, use the index.*

**Delete:** removes the item and selects the neighbour. Offer Undo (a toast) rather than a
confirm dialog. Undo re-inserts the item at its old position through `onChange`; autosave then
saves again (no need to cancel the pending save). There is no toast component yet; add a small
one in `components/ui`.

### 2. Nested lists

A list (or blocks) field inside a selected item doesn't render as full forms. It renders as the
same compact rows (drag handle, thumbnail, title, snippet, ›) with its own small "+ Add". Clicking
a row drills in: the right pane now shows that nested item, and a breadcrumb at the top of the
pane grows (`Services › Personal shopping › Basis`). Each crumb navigates back up. Previous/next
work among siblings at the current level. This works to any depth; only one level of forms is
ever visible.

On narrow screens this is the same drill-down, full width.

`blocks` fields use the same index/detail treatment, with the block type label shown in the row
(as today's header does) and the existing block-type picker behind Add.

### 3. Thumbnails

A row gets a thumbnail when the item has an `image` field with a value: the first `image` field
in the item's fields (searching one level into `object` fields). If the item has image fields
but none set, show a neutral placeholder so rows stay aligned; if the item type has no image
field at all, no thumbnail column. This applies to the index, nested rows and block rows.

Thumbnails load through a CMS media endpoint (section 6), not the deployed site, so they work for
images that aren't published yet and for sites without a `siteUrl`.

### 4. Image fields

**Single `image` field:** a thumbnail card: the image (≈72×54, `object-cover`), file name, full
path in muted text, **Replace** (opens the picker) and **Remove**. When empty: a dashed drop target
"Choose image" that opens the picker and also accepts a dropped file (upload). The raw path stays
editable through the picker's "Paste URL" tab. `file` fields get the same card with a file icon
instead of the image.

**List of images** (`list` with `field.type: image`): a photo grid.

- Square thumbnails, responsive columns (≈6 across in the editor card on desktop, 3 on phone).
- Drag to reorder (with a placeholder slot showing where it lands); a position number on each.
- Hover/focus shows ✕ to remove; on touch, tap a photo for a small sheet with Replace / Remove /
  Move.
- "Select" mode for removing several at once.
- Last tile: "+ Add, or drop here". The toolbar also has **+ Add photos**. Both open the picker in
  multi-select mode.
- Dropping files from the computer anywhere on the grid uploads them and appends them.
- `maxItems` hides Add when full and shows "5 / 5".
- Stable keys: image values are strings, so `keyFor` falls back to indices; the grid needs its own
  stable ids (e.g. a parallel id array kept in component state) so drag animation and React state
  survive reorders and duplicates.

### 5. Image picker

A dialog (full screen on phone) with three tabs.

- **On the site**: every image in the repo under the media folder. Grid of thumbnails with file
  names, search by file name, and a filter "Not used yet": an image counts as used when its
  public path appears anywhere in the text of any entry (published or draft, folder and file
  collections, including rich text and Markdown bodies). Computed on request and cached by head
  SHA plus the latest draft update.
  Images already in the current list show dimmed with "already in gallery". Single fields pick
  one (click = choose); lists allow multi-select with a "N selected · Add" footer.
- **Upload**: a drop zone + file chooser, multiple files for lists. Shows progress per file. The
  uploaded image is staged by phase 5 and immediately usable in the field (6b). Hidden until
  phase 5 lands.
- **Paste URL**: a text input for an external URL or a path typed by hand: today's behaviour.

The rich-text toolbar's image button opens the same picker (single select) instead of its
path prompt, and rich-text image previews use `/media/raw` like other thumbnails.

The picker writes the **public path** into the field (what the site expects, e.g.
`/images/gite5.webp`), not the repo path.

**Repo path ↔ public path.** With `media: { folder, publicPath }` configured: repo
`<folder>/<name>` ↔ public `<publicPath>/<name>`. Without it, the CMS needs a rule to map a
picked repo file to the value the site uses. hond-morvan is the awkward case: its values are
`/images/x.webp`, but its files live in `src/assets/images/` (Astro). Decision: **"On the site"
and Upload require a `media` config**. Without one, the picker only offers Paste URL, plus a
note for superadmins on how to add `media:`. hond-morvan gets `media: { folder:
src/assets/images, publicPath: /images }` added to its config as part of rollout. Thumbnails for
existing values also use this mapping (public → repo path) to find the blob; values outside the
media folder fall back to `siteUrl` as today, and `/media/raw` never serves them. Verified for
hond-morvan: `src/utils/images.ts` resolves `/images/x` to `src/assets/images/x` via
`import.meta.glob`, so the mapping holds. Because `.drikus/**` is protected, adding `media:` is
a manual commit to the client repo by a developer, not something the CMS does.

### 6. Server: media

Two parts, shipped separately.

**6a. Read (needed for thumbnails and "On the site")**

- `GET /sites/:id/media`: images under the media folder from the cached head tree: repo path,
  public path, size, blob SHA. Includes staged uploads (from 6b) once they exist.
- `GET /sites/:id/media/raw?path=…&w=…`: serves the image with the right content type and
  `Cache-Control: immutable` keyed by blob SHA. A new media-path check allows only paths under
  the media folder (normalised, no `..`); access requires site membership, same as content
  routes. SVG is not served (and not uploadable) in this project.
- **Thumbnails:** `w` (e.g. 96 / 320) returns a `sharp`-resized WebP. Image bytes and thumbnails
  are cached as files under `/data/media-cache/<sha>[-<w>].webp`, **not** in `git_blobs`, so
  the database doesn't grow with photos. Originals come from the GitHub blob API on a miss.
- If `tree()` reports `truncated`, the media list is marked incomplete and the picker says so.

**6b. Upload: phase 5, built separately**

Uploading (staging, type checks, resizing/WebP, committing on publish, how publish lists and
counts uploads, which file types and limits are allowed) is phase 5 of `plan.md`, which is
already under construction in its own branch. This design doesn't specify it; it only relies on
phase 5 providing:

- an endpoint that takes one or more files for a site and returns, per file, the repo path and
  public path it will be committed under (inside the media folder);
- staged uploads showing up in `GET /sites/:id/media` (6a), marked as not yet published;
- staged uploads being served by `/media/raw`, so they get thumbnails before they're published.

If phase 5 lands with a different shape, the picker's Upload tab and drop-to-upload adapt to
it; 6a can coordinate with phase 5 on owning the media list and raw endpoints. Until phase 5
lands, the Upload tab and drop targets are hidden.

`sharp` (used by 6a for thumbnails, and presumably by phase 5) must work in the `oven/bun` slim
image on linux/amd64 and linux/arm64 (Fly and Synology). Its prebuilt binaries cover both;
verify in the Docker build.

### 7. Collection index: pagination and sorting

On `collection.tsx`:

- **Sort control** next to the search: options are the title/summary field, `sortBy` (the
  default, with its `sortOrder`) and any top-level `date`/`datetime` fields. Direction toggle.
  No "recently edited" sort: published entries have no edit time without a per-file GitHub
  history call. Remember the choice per collection in `localStorage`.
- **Pagination** client-side: 25 per page with page controls at the bottom (and the count, e.g.
  "26–50 of 87"). Search filters across all entries, not the current page. Page and sort go in
  the URL search params.
- Rows show a second muted column for the sort field's value when it isn't the title (e.g. the
  date for Gastenboek).
- API: the list endpoint returns, per entry, a `values` map with the `sortBy` field and every
  top-level `date`/`datetime` field; `clientCollection()` sends `sortBy`/`sortOrder` to the
  web app.
- Server-side pagination is out of scope; the list endpoint already loads everything for
  sorting.

## Config

No config changes in this design (upload options like a max width belong to phase 5).

Docs: update `docs/content-config.md` to document `media` (`folder`, `publicPath`) and that it
enables the picker and repo thumbnails, and describe the new list and image editing.

## Build order

Each step ships on its own and is useful without the next:

1. **List editor**: sections 1–3, with thumbnails via `siteUrl` as today until 6a lands.
2. **Image fields and photo grid**: section 4, with Add opening a picker that only has Paste
   URL.
3. **Media read**: section 6a + picker "On the site" tab; thumbnails switch to `/media/raw`.
   Rich-text image button opens the picker. Add `media:` to hond-morvan's config (manual commit).
4. **Upload wiring**: once phase 5 lands, show the picker's Upload tab and drop-to-upload on the
   grid and single field, using phase 5's endpoint (6b).
5. **Collection index**: section 7. Independent; can go anywhere in the order.

## Left to the builder

- Drag-and-drop implementation (library such as `@dnd-kit` or native), as long as it works with
  touch and has a keyboard alternative.
- Exact breakpoints, spacing and visual details within the existing Tailwind/stone/brand style.
- Component structure (e.g. extracting `ListInput`/`BlocksInput` into their own files).
- Whether search in the list editor also matches nested text.
- i18n: all new strings in both `en.ts` and `nl.ts`.
- Tests: server tests for the 6a endpoints (media-folder path check, membership, truncated
  trees, thumbnail cache) and the list endpoint's new `values`, alongside the existing ones in
  `apps/server/test`; the web app has no test setup today.

## Calls made without the user (check these)

- Short lists (≤ 3 items, short fields only) may stay inline; the threshold is a guess.
- Back button: selecting an item replaces history, drilling into a nested list pushes.
- Delete has Undo instead of a confirm dialog.
- No "recently edited" sort on the collection index (no edit time for published entries).
- The picker needs a `media:` config; without it only Paste URL is offered.
- SVG isn't served or picked.
- The rich-text image button uses the picker too.
- Thumbnails and image bytes are cached as files under `/data`, not in SQLite.
- Alt text isn't part of this design: sites that want it add an `alt` field next to the image.
