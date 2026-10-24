# List and Media Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace endless-scroll list editing with an index + detail editor (with thumbnails and
nested drill-down), turn image fields into thumbnail cards and a sortable photo grid with a picker,
serve repo images to the CMS, and add sorting/pagination to collection indexes.

**Architecture:** Pure helpers (`apps/web/src/lib/list.ts`, `lib/media.ts`,
`lib/collection-view.ts`) hold all path/selection/sort logic and are unit-tested with `bun test`.
React components in `apps/web/src/components/editor/` (`list-editor.tsx`, `nested-rows.tsx`,
`image-field.tsx`, `image-grid.tsx`, `image-picker.tsx`) render them and replace the object/blocks
branches of `ListInput`/`BlocksInput` in `fields.tsx`. The server gets a media module
(`content/media.ts`, `content/media-store.ts`) and two routes under the existing per-site content
routes.

**Tech Stack:** Bun, Hono, drizzle/SQLite, React 19, TanStack Router/Query, Tailwind v4
(container queries), `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (new),
`sharp` (new, server).

**Spec:** `docs/superpowers/specs/2026-10-24-list-and-media-editing-design.md`

## Global Constraints

- Every content change goes through the existing `onChange` → autosave path; ids, selection and
  UI state are never written into content.
- Unknown keys on items and unknown items in lists are preserved by every edit, reorder and delete.
- Only one level of item forms is visible at a time; nested lists render as compact rows.
- Every new UI works on phone width; the list editor switches layout on its **container** width.
- All new strings in both `apps/web/src/locales/en.ts` and `nl.ts`.
- Package manager is bun: `bun add`, `bun run <script>`, `bunx`. Root `bun test` runs all tests
  (server and web `*.test.ts`); `bun run typecheck`; `bun run lint`.
- SVG is never served by `/media/raw` and never offered in the picker.
- Upload UI (picker Upload tab, drop-to-upload) stays hidden behind
  `UPLOADS_AVAILABLE = false` in `apps/web/src/lib/media.ts` until phase 5 lands (out of scope).
- Commit after every task; message style matches the repo (imperative, sentence case), ending
  with the `Co-Authored-By` line.

## Review Focus

- Stale `?item=` after reload (index past the end, or path into a removed nested list) → falls
  back to the deepest valid level, never crashes. Test in Task 1 (`resolveChain`).
- The same image twice in a gallery → two tiles that drag independently. Test in Task 1
  (`reconcileIds`/`moveIds` are index-based, not value-based).
- Data replaced from outside the form (restore a revision, resolve a conflict, Undo) changes list
  lengths → ids reconcile instead of keeping stale ones. Test in Task 1 (`reconcileIds`).
- A malformed item (string or array inside a list of objects) → shown as "Item n", editing it
  produces an object, other items untouched. Test in Task 1 (`setIn`).
- `/media/raw` with `..`, a path outside the media folder, an `.svg`, or an arbitrary `w` → 404 /
  400, never the file. Test in Task 6.

---

### Task 1: List helpers

**Files:**
- Create: `apps/web/src/lib/list.ts`
- Test: `apps/web/src/lib/list.test.ts`

**Interfaces:**
- Produces (all exported from `@/lib/list`; `FieldDef`, `Data` from `@/lib/content`):
  - `move<T>(list: T[], from: number, to: number): T[]` (moved here from `fields.tsx`)
  - `itemFields(field: FieldDef, item: unknown): FieldDef[] | null`: `field.fields` for lists,
    the matching block's fields for `blocks` (by `field.typeKey`), `null` for an unknown block.
  - `itemTitle(fields: FieldDef[], item: Data): string | null` (moved from `fields.tsx`)
  - `itemSnippet(fields: FieldDef[], item: Data): string | null`: first non-empty
    `string`/`text`/`markdown` value after the one `itemTitle` used, newlines collapsed to spaces,
    max 120 chars; `richtext` fields are skipped.
  - `hasImageField(fields: FieldDef[]): boolean`: an `image` field at top level or one level into
    an `object` field.
  - `thumbnailOf(fields: FieldDef[], item: Data): string | null`: value of the first such image
    field, `null` when empty.
  - `matchesSearch(fields: FieldDef[], item: Data, term: string): boolean`: case-insensitive
    substring over top-level `string`/`text`/`markdown`/`richtext`/`url` values; empty term → true.
  - `type ChainLevel = { listPath: string; index: number; field: FieldDef; fields: FieldDef[] | null; item: Data }`
  - `resolveChain(field: FieldDef, listPath: string, value: unknown[], selected: string | null): ChainLevel[]`:
    `selected` is a full dot path (e.g. `services.1.packages.0`) as built by `FieldList`. Walks
    `<listPath>.<i>` then `.<childField>.<j>` for child `list` (with `fields`) / `blocks` fields;
    stops at the first segment that doesn't resolve. Empty array when `selected` doesn't start
    with `listPath + '.'` or index 0 is out of range.
  - `setIn(value: unknown[], segments: (string | number)[], next: unknown): unknown[]`: immutable
    update; non-object containers on the way are replaced by `{}`; siblings and unknown keys kept.
  - `reconcileIds(ids: string[], length: number): string[]`: same array if lengths match, else
    keeps `ids.slice(0, length)` and appends fresh `crypto.randomUUID()`s.
  - `insertId(ids: string[], at: number): string[]`, `removeId(ids: string[], at: number): string[]`,
    `moveIds(ids: string[], from: number, to: number): string[]`.
  - `usesListEditor(field: FieldDef): boolean`: `list` with `fields`, or `blocks`.
  - `hasListEditor(fields: FieldDef[]): boolean`: any top-level field (or one level into
    `object`) for which `usesListEditor` is true.
  - `isInlineList(field: FieldDef, value: unknown[]): boolean`: `true` when
    `value.length <= 3`, `field.type === 'list'`, and every field in `field.fields` is one of
    `string`, `url`, `number`, `boolean`, `date`, `datetime`, `color`, `select`, `reference`, `image`.

- [ ] **Step 1: Write the failing tests** in `apps/web/src/lib/list.test.ts` (`bun:test`). Fixture:
  a `services` list field with `fields: [title(string), icon(image), intro(text), packages(list of {name(string), image(image)})]`.
  - `resolveChain(services, 'services', data, 'services.1.packages.0')` → 2 levels; level 1
    `index === 0`, `listPath === 'services.1.packages'`, `item.name === 'Basis'`.
  - `resolveChain(..., 'services.9')` → `[]`; `'services.1.packages.7'` → 1 level (Review Focus).
  - `resolveChain(..., 'reviews.0')` → `[]`.
  - `setIn(data, [1, 'packages', 0, 'name'], 'X')` changes only that value; `data[0]` is the same
    reference; an unknown key `extra: 1` on `data[1]` survives.
  - `setIn(['oops', {a: 1}], [0, 'title'], 'T')` → `[{ title: 'T' }, { a: 1 }]` (Review Focus).
  - `reconcileIds(['a','b'], 2)` returns the same array; `reconcileIds(['a','b','c'], 1)` →
    `['a']`; `reconcileIds(['a'], 3)` → length 3 starting with `'a'`, all unique.
  - `moveIds(['a','b','c'], 0, 2)` → `['b','c','a']`; with ids for `['/x.webp','/x.webp']` the two
    ids differ (Review Focus).
  - `thumbnailOf` finds `icon`; finds `hero.image` inside an `object` field; `null` when empty;
    `hasImageField` false for a fields list without images.
  - `itemSnippet` skips the title value and collapses `"a\n\nb"` to `"a b"`.
  - `matchesSearch` matches `'valeria'` in a text field case-insensitively; `''` → true.
  - `isInlineList` true for 2 items of `{name, url}`, false for 4 items, false with a `text` field.
  - `itemFields` on a blocks field returns the block's fields, `null` for an unknown type.

- [ ] **Step 2: Run** `bun test apps/web/src/lib/list.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** the functions above in `apps/web/src/lib/list.ts`. Delete `move` and
  `itemTitle` from `fields.tsx` and import them from `@/lib/list`.

- [ ] **Step 4: Run** `bun test apps/web/src/lib/list.test.ts && bun run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `Add list editing helpers`.

---

### Task 2: Two-pane list editor

**Files:**
- Create: `apps/web/src/components/editor/list-editor.tsx`, `apps/web/src/components/editor/item-index.tsx`,
  `apps/web/src/components/editor/list-ids.tsx`, `apps/web/src/components/ui/toast.tsx`,
  `apps/web/src/lib/use-container-width.ts`
- Modify: `apps/web/src/components/editor/fields.tsx` (`FieldInput` `list`/`blocks` cases,
  remove `keyFor`'s use for object lists; extract the block-type grid into `BlockPicker`),
  `apps/web/src/routes/entry.tsx:319,360` (card width), `apps/web/src/locales/en.ts`, `nl.ts`,
  `apps/web/package.json` (dnd-kit)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `ListIdsProvider({ children })` and `useListIds(path: string, length: number): { ids: string[]; insert(at: number): void; remove(at: number): void; move(from: number, to: number): void }`
    in `list-ids.tsx`: ids kept in a `Map<string, string[]>` ref in the provider, passed through
    `reconcileIds` on every render. `EntryPage` and `NewEntry` wrap their `FieldList` in the provider.
  - `ListEditor({ field, value, path, onChange }: { field: FieldDef; value: unknown[]; path: string; onChange: (v: unknown) => void })`
  - `ItemIndex({ field, value, listPath, ids, selectedIndex, onSelect, onMove, search }: …)`:
    the sortable compact rows, reused by Task 3.
  - `useContainerWidth(ref: RefObject<HTMLElement | null>): number` (ResizeObserver).
  - `Toast({ message, actionLabel, onAction, onClose, timeoutMs = 8000 })`: fixed bottom-center.
  - `BlockPicker({ blocks, onPick, onCancel })` exported from `fields.tsx`.
  - Selection state is local in this task: `useState<string | null>` holding a full item path.
    Task 3 moves it into the URL behind the same `select(path, mode)` call.

- [ ] **Step 1: Add dependencies** `bun add --cwd apps/web @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2`.

- [ ] **Step 2: Build `ItemIndex`**: `DndContext` with `PointerSensor`, `TouchSensor` (delay 200ms)
  and `KeyboardSensor` (`sortableKeyboardCoordinates`); `SortableContext` with
  `verticalListSortingStrategy` over `ids`. Row = grip, 30px thumbnail (only when
  `hasImageField(fields)`; neutral placeholder when `thumbnailOf` is null; image `src` from
  `previewUrl(path, siteUrl)` for now, swapped to `thumbSrc` in Task 7), title
  (`itemTitle` ?? `t('editor.item', { n })`, blocks prefixed with the block label), snippet,
  amber dot when any `missing` path starts with `${listPath}.${i}`. Rows not matching `search`
  are hidden, except the selected one.

- [ ] **Step 3: Build `ListEditor`**:
  - Sticky toolbar: label + count pill, search `Input`, primary Add (blocks: opens `BlockPicker`
    in a `Dialog`). Add appends (`{}` or block defaults, as today), calls `ids.insert`, selects
    the new item and focuses its first input (`[data-field] input, textarea` inside the pane).
  - Width from `useContainerWidth`; **wide** when ≥ 640px: index 40% left, pane right. Default
    selection on wide = first item. **Narrow**: index only until a row is tapped, then pane only
    with a "‹ {list label}" back link; no default selection.
  - Pane header: item title, move menu (Move up / Move down / Move to top / Move to bottom), Delete,
    ‹ previous / next ›. Body: `FieldList` with `path={`${path}.${i}`}` and
    `onChange={(v) => onChange(setIn(value, [i], v))}`. Unknown block type: existing
    `errors.invalid_input` message.
  - Delete: remove item and id, select neighbour, show `Toast` "{title} verwijderd · Ongedaan maken";
    Undo re-inserts the removed item and id at the old index and selects it.
  - Empty list: empty state with Add.

- [ ] **Step 4: Wire into `FieldInput`**: `case 'list'`: `field.field` → existing single-value
  rows (keep), `usesListEditor` and `!isInlineList` → `ListEditor`, inline → existing expanded
  rendering. `case 'blocks'` → `ListEditor`. Delete the old object branch of `ListInput` and the
  old `BlocksInput` body (keep `BlockPicker`). Keys in the inline branch use `useListIds`.

- [ ] **Step 5: Widen the card**: in `entry.tsx` both `max-w-3xl` wrappers become
  `cn('mx-auto', hasListEditor(collection.fields) ? 'max-w-6xl' : 'max-w-3xl')`.

- [ ] **Step 6: Strings** (en / nl): `editor.searchItems` "Search…" / "Zoeken…",
  `editor.moveTop` "Move to top" / "Naar boven", `editor.moveBottom` "Move to bottom" / "Naar onderen",
  `editor.removed` "{{title}} removed" / "{{title}} verwijderd", `editor.undo` "Undo" / "Ongedaan maken",
  `editor.previous` "Previous" / "Vorige", `editor.next` "Next" / "Volgende",
  `editor.backToList` "Back to {{label}}" / "Terug naar {{label}}", `editor.noItems` "Nothing here yet" / "Nog niets toegevoegd".

- [ ] **Step 7: Verify**: `bun run typecheck && bun run lint && bun test`. Expected: all pass.
  Then `bun run dev`, open a site with a list of objects (fixture: `docs/examples` or a linked
  test site) and check: 27-item list shows as index; search, add (focus lands in first input),
  drag reorder, keyboard reorder via the menu, delete + undo, previous/next, narrow layout at
  375px width, typing in an item keeps focus (no remount).

- [ ] **Step 8: Commit** `Edit lists of items in an index with a detail pane`.

---

### Task 3: Nested drill-down and selection in the URL

**Files:**
- Create: `apps/web/src/components/editor/nested-rows.tsx`, `apps/web/src/components/editor/list-nav.ts`
- Modify: `apps/web/src/components/editor/list-editor.tsx`, `fields.tsx` (`FieldInput`),
  `apps/web/src/router.tsx:165-176` (entry route `validateSearch`), `apps/web/src/routes/entry.tsx`

**Interfaces:**
- Consumes: `resolveChain`, `setIn`, `ItemIndex`, `useListIds` (Tasks 1–2).
- Produces:
  - Entry route search: `{ item?: string }`, valid when it matches `/^[\w-]+(\.[\w-]+)*$/` and is
    ≤ 300 chars.
  - `ListNavContext = createContext<{ select(path: string | null, mode: 'push' | 'replace'): void } | null>(null)`
    in `list-nav.ts`, provided by the pane of a `ListEditor`.
  - `NestedRows({ field, value, path, onChange })`: compact `ItemIndex` rows (24px thumbs) plus a
    small "+ Add"; clicking row `i` calls `select(`${path}.${i}`, 'push')`; Add appends then selects.

- [ ] **Step 1: `validateSearch`** on `entryRoute` returning `{ item }` per the rule above.

- [ ] **Step 2: Selection from the URL**: `ListEditor` reads `item` via `useSearch({ strict: false })`
  and uses it when it starts with `${path}.`; otherwise falls back to local state (Task 2
  behaviour). `select(p, mode)` calls `navigate({ search: (s) => ({ ...s, item: p ?? undefined }), replace: mode === 'replace' })`.
  Row clicks and prev/next use `'replace'`; drilling uses `'push'`. Reorder and delete update
  the param to the moved / neighbouring item's path (`'replace'`).

- [ ] **Step 3: Drill-down pane**: compute `resolveChain(field, path, value, selected)`. The pane
  edits the **last** level: `FieldList` with `fields = level.fields`, `path = `${level.listPath}.${level.index}``,
  `onChange = (v) => onChange(setIn(value, segmentsOf(level), v))` where `segmentsOf` turns the
  level's path relative to `path` into `(string | number)[]`. Above the form, a breadcrumb: list
  label, then one crumb per level (title or "Item n"); clicking a crumb selects that level
  (`'push'`). Previous/next move within the last level's siblings. Narrow mode back link goes up
  one level (index view at the top level).

- [ ] **Step 4: `FieldInput`**: when `useContext(ListNavContext)` is non-null and
  `usesListEditor(field)` (not inline), render `NestedRows` instead of `ListEditor`.

- [ ] **Step 5: Verify**: `bun run typecheck && bun run lint && bun test`; then in `bun run dev`
  with a config that has a list inside a list item: drill in two levels, reload (same place), Back
  steps out one level, edit a nested field (saved via autosave: check the draft in the publish
  dialog), stale `?item=…7` falls back to the parent.

- [ ] **Step 6: Commit** `Drill into nested lists and keep the selected item in the URL`.

---

### Task 4: Image card, photo grid and picker (Paste URL)

**Files:**
- Create: `apps/web/src/components/editor/image-field.tsx`, `image-grid.tsx`, `image-picker.tsx`,
  `apps/web/src/lib/media.ts`, `apps/web/src/lib/media.test.ts`
- Modify: `fields.tsx` (`image`/`file` case, single-value `list` with `field.type === 'image'`),
  locales

**Interfaces:**
- Produces:
  - In `lib/media.ts`: `export const UPLOADS_AVAILABLE = false`;
    `type MediaConfig = { folder: string; publicPath: string }`;
    `toRepoPath(media: MediaConfig, publicPath: string): string | null` (strips `media.publicPath`
    + `/`, prefixes `media.folder/`; `null` when outside or contains `..`);
    `toPublicPath(media: MediaConfig, repoPath: string): string`;
    `thumbSrc(path: string, ctx: { siteId: string; siteUrl: string | null; media: MediaConfig | null }, w?: 96 | 320): string | null`:
    for now returns `previewUrl(path, ctx.siteUrl)`; Task 7 adds the `/media/raw` branch.
  - `ImagePicker({ open, onClose, multiple, current, onPick }: { open: boolean; onClose(): void; multiple: boolean; current: string[]; onPick(paths: string[]): void })`:
    a `Dialog` with tabs; this task only has the **Paste URL** tab (input + Add/Choose button).
  - `ImageField({ id, field, value, onChange })`: thumbnail card (72×54 `object-cover`, file
    name, full path muted, Replace, Remove) or dashed "Choose image" button when empty; `file`
    fields show a `FileText` icon instead of the image.
  - `ImageGrid({ field, value, path, onChange })`: sortable grid (`rectSortingStrategy`), ids from
    `useListIds`, square tiles `grid-cols-3 @lg:grid-cols-6`, position number, ✕ on hover/focus,
    click a tile → small menu (Replace, Remove, Move to start, Move to end), "Select" mode with
    "Remove n" action, last tile "+ Add", toolbar "+ Add photos", `maxItems` shows "n / max" and
    hides Add when full. Add opens `ImagePicker` with `multiple` and `current = value`.

- [ ] **Step 1: Failing tests** in `lib/media.test.ts`:
  `toRepoPath({folder:'src/assets/images', publicPath:'/images'}, '/images/gite5.webp')` →
  `'src/assets/images/gite5.webp'`; `'/elsewhere/x.png'` → `null`; `'/images/../.env'` → `null`;
  `toPublicPath(same, 'src/assets/images/a/b.png')` → `'/images/a/b.png'`.

- [ ] **Step 2: Run** `bun test apps/web/src/lib/media.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `lib/media.ts`, then the three components; wire `FieldInput`:
  `image`/`file` → `ImageField`; `list` with `field.field?.type === 'image'` → `ImageGrid`.

- [ ] **Step 4: Strings** (en / nl): `media.choose` "Choose image" / "Kies afbeelding",
  `media.replace` "Replace" / "Vervangen", `media.remove` "Remove" / "Weghalen",
  `media.addPhotos` "Add photos" / "Foto's toevoegen", `media.add` "Add" / "Toevoegen",
  `media.select` "Select" / "Selecteren", `media.removeN` "Remove {{count}}" / "{{count}} weghalen",
  `media.moveStart` "Move to start" / "Naar het begin", `media.moveEnd` "Move to end" / "Naar het eind",
  `media.tabSite` "On the site" / "Op de site", `media.tabUpload` "Upload" / "Uploaden",
  `media.tabUrl` "Paste URL" / "Plak URL", `media.selected` "{{count}} selected" / "{{count}} geselecteerd",
  `media.alreadyUsed` "Already added" / "Al toegevoegd". Remove the now-unused `editor.imageHint`.

- [ ] **Step 5: Verify**: `bun test && bun run typecheck && bun run lint`; in `bun run dev`, a
  45-image list renders as a grid, drag works with mouse and touch emulation, the same path twice
  gives two independent tiles, Replace/Remove on a single image, `maxItems: 5` shows "5 / 5".

- [ ] **Step 6: Commit** `Show image fields as thumbnails and image lists as a photo grid`.

---

### Task 5: Server media module and SiteSync uncached blobs

**Files:**
- Create: `apps/server/src/content/media.ts`, `apps/server/test/media-unit.test.ts`
- Modify: `apps/server/src/github/sync.ts` (add `blobUncached`), `apps/server/test/fake-github.ts`
  (binary files)

**Interfaces:**
- Produces:
  - `const MEDIA_EXT = new Set(['jpg','jpeg','png','webp','gif','avif'])`
  - `resolveMedia(media: Config['media']): { folder: string; publicPath: string } | null`:
    `publicPath` defaults to `'/' + folder`; trailing slashes trimmed.
  - `isMediaPath(folder: string, path: string): boolean`: starts with `folder + '/'`, no `..`
    segment, no `//`, no leading `/`, extension in `MEDIA_EXT` (case-insensitive).
  - `repoToPublic(media, repoPath): string`.
  - `listMedia(entries: TreeEntry[], media): { path: string; publicPath: string; size: number; sha: string }[]`:
    blobs passing `isMediaPath`, sorted by path.
  - `SiteSync.blobUncached(site: LinkedSite, sha: string): Promise<Buffer>`: GitHub blob fetch
    without writing `git_blobs`.
  - `fakeGitHub` `addRepo`/`commit` accept `Record<string, string | Buffer>`; blobs stored as
    `string | Buffer`; text readers call `.toString()`.

- [ ] **Step 1: Failing tests** in `media-unit.test.ts`: `isMediaPath('assets/images', …)` true
  for `assets/images/a.webp`, `assets/images/sub/B.JPG`; false for `assets/images/../x.png`,
  `assets/imagesx/a.png`, `assets/images/a.svg`, `/assets/images/a.png`, `assets/images//a.png`.
  `resolveMedia({ folder: 'public/uploads' })` → `publicPath '/public/uploads'`;
  `listMedia` filters a mixed tree to the two images and sorts them.

- [ ] **Step 2: Run** `bun test apps/server/test/media-unit.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `media.ts`, `blobUncached` (reuse `#withRepo` and
  `this.github.repo(site.repoId).blob`), and the fake's binary support.

- [ ] **Step 4: Run** `bun test`. Expected: PASS (existing tests unaffected by the fake change).

- [ ] **Step 5: Commit** `Add media path rules and uncached blob reads`.

---

### Task 6: Media routes and thumbnail cache

**Files:**
- Create: `apps/server/src/content/media-store.ts`, `apps/server/test/media-api.test.ts`
- Modify: `apps/server/src/env.ts` (`Deps.mediaCacheDir: string | null`),
  `apps/server/src/bootstrap.ts` (`join(DATA_DIR, 'media-cache')`), `apps/server/test/helpers.ts`
  (`mediaCacheDir: null`), every other `Deps` literal, `apps/server/src/routes/content.ts`,
  `apps/server/package.json` (sharp), `Dockerfile` if sharp needs it

**Interfaces:**
- Consumes: Task 5.
- Produces:
  - `class MediaStore { constructor(dir: string | null); original(sync: SiteSync, site: LinkedSite, sha: string): Promise<Buffer>; thumbnail(sync: SiteSync, site: LinkedSite, sha: string, w: 96 | 320): Promise<Buffer> }`:
    files `<dir>/<sha>` and `<dir>/<sha>-<w>.webp`; with `dir === null` no disk cache. Thumbnail:
    `sharp(original).rotate().resize({ width: w, height: w, fit: 'cover' }).webp({ quality: 75 })`.
  - `GET /api/sites/:siteId/media` → `{ configured: boolean; complete: boolean; folder: string | null; publicPath: string | null; items: { path; publicPath; size; sha; used: boolean }[] }`
    (`used` is `false` for every item until Task 8). `complete` is `!tree.truncated`.
  - `GET /api/sites/:siteId/media/raw?path=<repo path>&w=<96|320>` → image bytes; content type
    from extension (thumbnails `image/webp`); `etag "<sha>"` / `"<sha>-<w>"`, 304 on match;
    `cache-control: private, max-age=300` (not `immutable` as the spec suggests: the URL names a
    path, whose blob can change; the ETag makes revalidation cheap); `content-disposition: inline`;
    `x-content-type-options: nosniff`. 404 `not_found` when not configured, not `isMediaPath`, or
    not in the tree; 400 for any other `w`.
  - `/content` response gains `media: { folder: string; publicPath: string } | null`.

- [ ] **Step 1: Add** `bun add --cwd apps/server sharp`.

- [ ] **Step 2: Failing tests** in `media-api.test.ts`, using the `world()` pattern from
  `icon.test.ts` with a repo containing `.drikus/config.yml` (a minimal valid config with
  `media: { folder: assets/images, publicPath: /assets/images }`), a real 4×4 PNG generated with
  `sharp({ create: … }).png().toBuffer()` at `assets/images/a.png`, `assets/images/b.svg` and
  `src/secret.png`:
  - list returns only `a.png` with `publicPath '/assets/images/a.png'`, `configured: true`,
    `complete: true`.
  - raw `path=assets/images/a.png` → 200, bytes equal the PNG, `content-type image/png`, ETag;
    repeating with `if-none-match` → 304.
  - `w=96` → 200 `image/webp`, `sharp(body).metadata()` width 96.
  - Review Focus: `assets/images/../src/secret.png`, `src/secret.png`, `assets/images/b.svg` →
    404; `w=97` → 400.
  - a non-member editor gets 403/404 as other content routes do (follow `access.test.ts`).
  - without `media` in the config: list `{ configured: false, items: [] }`, raw 404.
  - `MediaStore` with a temp dir writes `<sha>-96.webp` once and serves it from disk the second
    time (spy on `sync.blobUncached` call count = 1).

- [ ] **Step 3: Run** `bun test apps/server/test/media-api.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement** `MediaStore`, `Deps.mediaCacheDir`, the routes in `contentRoutes`
  (handle `GitHubError` like `/icon`), and `media` in `/content`.

- [ ] **Step 5: Run** `bun test && bun run typecheck && bun run lint`. Expected: PASS.

- [ ] **Step 6: Docker check**: if `docker` is available, `docker buildx build --platform linux/amd64,linux/arm64 .`
  must succeed and `docker run` the amd64 image long enough to load sharp
  (`bun -e "require('sharp')"`). If docker isn't available, say so in the task report.

- [ ] **Step 7: Commit** `Serve repo images and thumbnails to the editor`.

---

### Task 7: Picker "On the site", repo thumbnails, rich-text picker

**Files:**
- Modify: `apps/web/src/lib/media.ts` (`mediaQuery`, `thumbSrc`), `media.test.ts`,
  `apps/web/src/components/editor/context.ts` (`media`), `entry.tsx` (provide it),
  `image-picker.tsx`, `item-index.tsx`, `image-field.tsx`, `image-grid.tsx`, `rich-text.tsx`,
  `docs/content-config.md`, locales

**Interfaces:**
- Consumes: Task 6 endpoints; Task 4 components.
- Produces:
  - `EditorContextValue.media: MediaConfig | null` (from `/content`'s `media`).
  - `mediaQuery(siteId: string)` → the `/media` response.
  - `thumbSrc`: when `ctx.media` and `toRepoPath(...)` is non-null →
    `/api/sites/${siteId}/media/raw?path=${encodeURIComponent(repo)}${w ? `&w=${w}` : ''}`;
    otherwise `previewUrl(path, siteUrl)`.

- [ ] **Step 1: Failing test**: `thumbSrc('/images/a.webp', { siteId: 's1', siteUrl: null, media: {folder:'src/assets/images', publicPath:'/images'} }, 96)`
  → `'/api/sites/s1/media/raw?path=src%2Fassets%2Fimages%2Fa.webp&w=96'`; outside the folder with
  `siteUrl 'https://x.nl'` → `'https://x.nl/elsewhere/a.png'`.

- [ ] **Step 2: Run** `bun test apps/web/src/lib/media.test.ts`. Expected: FAIL; then implement; PASS.

- [ ] **Step 3: "On the site" tab** (shown only when `media` is set; default tab then): grid
  of `thumbSrc(item.publicPath, ctx, 320)` tiles with file-name captions, file-name search,
  "Not used yet" toggle (filters on `used`), items whose `publicPath` is in `current` dimmed with
  `media.alreadyUsed` and not selectable; single mode picks on click, multi mode toggles with a
  "{{count}} selected · Add" footer; `complete === false` shows `media.incomplete`. Without
  `media` the dialog shows only Paste URL plus, for superadmins, `media.notConfigured`.

- [ ] **Step 4: Thumbnails everywhere** use `thumbSrc` (index rows 96, nested rows 96, image
  card 320, grid 320).

- [ ] **Step 5: Rich text**: the toolbar image button opens `ImagePicker` (single) instead of
  `window.prompt`, inserting the picked path the same way; image previews use `thumbSrc`.

- [ ] **Step 6: Docs**: in `docs/content-config.md` replace the "uploading arrives in a later
  phase" text, document `media` (`folder`, `publicPath`, default `/<folder>`), and what it
  enables (picker, repo thumbnails). Strings: `media.notUsed` "Not used yet" / "Nog niet gebruikt",
  `media.incomplete` "Not every image could be listed (very large repository)." / "Niet alle
  afbeeldingen konden worden getoond (zeer grote repository).", `media.notConfigured` "Add
  `media:` to .drikus/config.yml to pick images from the repository." / "Voeg `media:` toe aan
  .drikus/config.yml om afbeeldingen uit de repository te kiezen.", `media.search` "Search by file
  name…" / "Zoek op bestandsnaam…".

- [ ] **Step 7: Verify**: `bun test && bun run typecheck && bun run lint`; in `bun run dev`
  against a site with `media:` configured: picker lists repo images, picking writes the public
  path, thumbnails load from `/media/raw` (network tab), rich-text button inserts via the picker.

- [ ] **Step 8: Commit** `Pick images from the repository`.

---

### Task 8: "Not used yet"

**Files:**
- Modify: `apps/server/src/content/service.ts` (`mediaUsage`), `routes/content.ts` (`used`),
  `apps/server/test/media-api.test.ts`

**Interfaces:**
- Produces: `ContentService.mediaUsage(publicPaths: string[]): Promise<Set<string>>`: for every
  collection, the text of each published file under it (folder prefix / file path) plus every
  upsert draft's serialized content; a path is used when the text contains it. Cached in a
  module-level `Map` keyed `${site.id}:${headSha}:${max draft updatedAt}` (keep at most 50 keys).

- [ ] **Step 1: Failing test**: config with a folder collection whose entry references
  `/assets/images/a.png` in a rich-text body and a file collection referencing nothing;
  `b.png` unreferenced → list returns `used: true` for `a`, `false` for `b`; after saving a draft
  that references `b.png`, `b` becomes `used: true`.

- [ ] **Step 2: Run**, expect FAIL; **implement**; run `bun test`, expect PASS.

- [ ] **Step 3: Commit** `Mark repo images that no content uses`.

---

### Task 9: Collection index sorting and pagination

**Files:**
- Create: `apps/web/src/lib/collection-view.ts`, `apps/web/src/lib/collection-view.test.ts`
- Modify: `apps/server/src/content/service.ts` (`listEntries` `values`),
  `apps/server/src/routes/content.ts` (`clientCollection`), `apps/server/test/content-api.test.ts`,
  `apps/web/src/router.tsx` (collection route `validateSearch`), `apps/web/src/routes/collection.tsx`,
  locales

**Interfaces:**
- Produces:
  - Server: each listed entry gains `values: Record<string, unknown>` holding the `sortBy` field
    and every top-level `date`/`datetime` field; `clientCollection` gains
    `sortBy: string | null`, `sortOrder: 'asc' | 'desc'`.
  - Collection route search `{ page?: number; sort?: string; dir?: 'asc' | 'desc' }`.
  - `sortOptions(collection: CollectionInfo): { key: string; label: Label | string }[]`:
    `'title'` first, then `sortBy` (if not a date field), then date/datetime fields.
  - `sortEntries(entries: EntrySummary[], key: string, dir: 'asc' | 'desc'): EntrySummary[]`:
    `'title'` compares `title ?? slug` with `localeCompare`; other keys compare `values[key]`,
    missing values last regardless of direction, ties by title.
  - `paginate<T>(list: T[], page: number, size = 25): { items: T[]; page: number; pages: number; from: number; to: number }`:
    page clamped to `1..pages` (`pages ≥ 1`).

- [ ] **Step 1: Failing tests**: server: listing the Gastenboek-like fixture returns
  `values.date`; `/content` collections include `sortBy`/`sortOrder`. Web: `sortEntries` by
  `date` desc puts an entry without a date last; `paginate(range(60), 3)` → items 51–60,
  `pages 3`, `from 51`, `to 60`; `paginate([], 5)` → `page 1, pages 1`.

- [ ] **Step 2: Run**, expect FAIL; **implement** server and helpers; run, expect PASS.

- [ ] **Step 3: UI**: sort `Select` + direction toggle next to search (search box now always
  shown above 6 entries as today); default from URL, else `localStorage['drikus.sort.<siteId>.<collection>']`
  (read/write in try/catch), else `sortBy`/`sortOrder` or `title`/`asc`; writing a choice updates
  URL (`replace`) and storage. Search filters all entries, resets page to 1. Rows show the sort
  value (dates formatted with `toLocaleDateString`) in a muted column when the key isn't
  `title`. Pagination footer only when > 25 entries: "{{from}}–{{to}} of {{total}}", previous / next.
  Strings: `collection.sort` "Sort by" / "Sorteer op", `collection.sortTitle` "Title" / "Titel",
  `collection.ascending` / `collection.descending`, `collection.range` "{{from}}–{{to}} of {{total}}" / "{{from}}–{{to}} van {{total}}".

- [ ] **Step 4: Verify** `bun test && bun run typecheck && bun run lint`; in `bun run dev`, a
  collection with 60 entries pages, sorting survives reload.

- [ ] **Step 5: Commit** `Sort and page collection indexes`.

---

### Task 10: Docs and final check

**Files:**
- Modify: `docs/content-config.md` (list/blocks/image editing behaviour), `README.md` (feature
  table, if it lists editor features)

- [ ] **Step 1:** Describe in `docs/content-config.md`: lists of objects and blocks open as an
  index with a detail pane, short lists (≤ 3 items with short fields) stay inline, image lists
  become a photo grid, and the first `image` field supplies row thumbnails.
- [ ] **Step 2:** `bun test && bun run typecheck && bun run lint && bun run build`. Expected: all pass.
- [ ] **Step 3: Commit** `Document list and image editing`.

## After this plan (not tasks here)

- hond-morvan-v2: add `media: { folder: src/assets/images, publicPath: /images }` to
  `.drikus/config.yml` (manual commit in that repo).
- Upload wiring once phase 5 merges: flip `UPLOADS_AVAILABLE`, add the Upload tab and drop
  targets against phase 5's endpoint.
