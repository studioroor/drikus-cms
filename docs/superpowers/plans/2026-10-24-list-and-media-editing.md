# List and Media Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace endless-scroll list editing with an index + detail editor (with thumbnails and
nested drill-down), turn image lists into a sortable photo grid using phase 5's media library,
add "Not used yet" to the library, and add sorting/pagination to collection indexes.

**Architecture:** Pure helpers (`apps/web/src/lib/list.ts`, `lib/collection-view.ts`) hold the
path/selection/id/sort logic and are unit-tested with `bun test`. New components in
`apps/web/src/components/editor/` (`list-ids.tsx`, `item-index.tsx`, `list-editor.tsx`,
`list-nav.ts`, `nested-rows.tsx`, `image-grid.tsx`) replace the object/blocks branches of
`ListInput`/`BlocksInput` in `fields.tsx`. Media builds on phase 5 (#8): `MediaPicker`,
`MediaField`, `DropZone`, `useUpload` in `components/editor/media.tsx`, `previewUrl` and
`mediaQuery` in `lib/content.ts`, `MediaService` in `apps/server/src/content/media.ts`.

**Tech Stack:** Bun, Hono, drizzle/SQLite, React 19, TanStack Router/Query, Tailwind v4
(container queries), `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (new).

**Spec:** `docs/superpowers/specs/2026-10-24-list-and-media-editing-design.md` (read the
"Update after phase 5" note at the top: phase 5's media implementation wins where they differ).

## Global Constraints

- Every content change goes through the existing `onChange` → autosave path; ids, selection and
  UI state are never written into content.
- Unknown keys on items and unknown items in lists are preserved by every edit, reorder and delete.
- Only one level of item forms is visible at a time; nested lists render as compact rows.
- Every new UI works on phone width; the list editor switches layout on its **container** width.
- All new strings in both `apps/web/src/locales/en.ts` and `nl.ts`.
- Thumbnails always come from `previewUrl(src, siteId, 160 | 400 | 800)` (phase 5); no other
  image URL scheme.
- Reuse phase 5's `MediaPicker`, `DropZone`, `useUpload`; extend them, don't fork them.
- Package manager is bun: `bun add`, `bun run <script>`, `bunx`. Root `bun test` runs all tests
  (server and web `*.test.ts`); `bun run typecheck`; `bun run lint`.
- Commit after every task; message style matches the repo (imperative, sentence case), ending
  with the `Co-Authored-By` line.

## Review Focus

- Stale `?item=` after reload (index past the end, or a path into a removed nested list) → falls
  back to the deepest valid level, never crashes. Test in Task 1 (`resolveChain`).
- The same image twice in a gallery → two tiles that drag independently. Test in Task 1
  (ids are index-based, not value-based).
- Data replaced from outside the form (restore a revision, resolve a conflict, Undo) changes list
  lengths → ids reconcile instead of keeping stale ones. Test in Task 1 (`reconcileIds`).
- A malformed item (string or array inside a list of objects) → shown as "Item n", editing it
  produces an object, other items untouched. Test in Task 1 (`setIn`).
- Dropping 8 photos on a grid with `maxItems: 5` and 3 already in it, or one of several uploads
  failing → the grid fills to 5, nothing beyond is added, successful uploads are kept and the
  error shows. Test in Task 4 (`appendUpTo`).

---

### Task 1: List helpers

**Files:**
- Create: `apps/web/src/lib/list.ts`
- Test: `apps/web/src/lib/list.test.ts`
- Modify: `apps/web/src/components/editor/fields.tsx` (import moved helpers)

**Interfaces:**
- Produces (all exported from `@/lib/list`; `FieldDef`, `Data` from `@/lib/content`):
  - `move<T>(list: T[], from: number, to: number): T[]` (moved here from `fields.tsx`)
  - `itemFields(field: FieldDef, item: unknown): FieldDef[] | null`: `field.fields` for lists,
    the matching block's fields for `blocks` (by `field.typeKey`), `null` for an unknown block.
  - `itemTitle(fields: FieldDef[], item: Data): string | null` (moved from `fields.tsx`)
  - `itemSnippet(fields: FieldDef[], item: Data): string | null`: first non-empty
    `string`/`text`/`markdown` value after the one `itemTitle` used, newlines collapsed to single
    spaces, max 120 chars; `richtext` fields are skipped.
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
    with `listPath + '.'` or the first index is out of range.
  - `setIn(value: unknown[], segments: (string | number)[], next: unknown): unknown[]`: immutable
    update; non-object containers on the way are replaced by `{}`; siblings and unknown keys kept.
  - `reconcileIds(ids: string[], length: number): string[]`: same array if lengths match, else
    `ids.slice(0, length)` plus fresh `crypto.randomUUID()`s.
  - `insertId(ids: string[], at: number): string[]`, `removeId(ids: string[], at: number): string[]`,
    `moveIds(ids: string[], from: number, to: number): string[]`.
  - `usesListEditor(field: FieldDef): boolean`: `list` with `fields`, or `blocks`.
  - `hasListEditor(fields: FieldDef[]): boolean`: any top-level field (or one level into
    `object`) for which `usesListEditor` is true.
  - `isInlineList(field: FieldDef, value: unknown[]): boolean`: `true` when `value.length <= 3`,
    `field.type === 'list'`, and every field in `field.fields` is one of `string`, `url`,
    `number`, `boolean`, `date`, `datetime`, `color`, `select`, `reference`, `image`.

- [ ] **Step 1: Write the failing tests** in `apps/web/src/lib/list.test.ts` (`bun:test`). Fixture:
  a `services` list field with `fields: [title(string), icon(image), intro(text), packages(list of {name(string), image(image)})]`.
  - `resolveChain(services, 'services', data, 'services.1.packages.0')` → 2 levels; the last has
    `index === 0`, `listPath === 'services.1.packages'`, `item.name === 'Basis'`.
  - `resolveChain(..., 'services.9')` → `[]`; `'services.1.packages.7'` → 1 level (Review Focus).
  - `resolveChain(..., 'reviews.0')` → `[]`.
  - `setIn(data, [1, 'packages', 0, 'name'], 'X')` changes only that value; `data[0]` is the same
    reference; an unknown key `extra: 1` on `data[1]` survives.
  - `setIn(['oops', { a: 1 }], [0, 'title'], 'T')` → `[{ title: 'T' }, { a: 1 }]` (Review Focus).
  - `reconcileIds(['a','b'], 2)` returns the same array; `reconcileIds(['a','b','c'], 1)` →
    `['a']`; `reconcileIds(['a'], 3)` → length 3 starting with `'a'`, all unique.
  - `moveIds(['a','b','c'], 0, 2)` → `['b','c','a']`; `reconcileIds([], 2)` for a list
    `['/x.webp','/x.webp']` gives two different ids (Review Focus).
  - `thumbnailOf` finds `icon`; finds `hero.image` inside an `object` field; `null` when empty;
    `hasImageField` false for fields without images.
  - `itemSnippet` skips the title value and collapses `"a\n\nb"` to `"a b"`.
  - `matchesSearch` matches `'valeria'` in a text field case-insensitively; `''` → true.
  - `isInlineList` true for 2 items of `{name, url}`, false for 4 items, false with a `text` field.
  - `itemFields` on a blocks field returns the block's fields, `null` for an unknown type.

- [ ] **Step 2: Run** `bun test apps/web/src/lib/list.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** the functions in `apps/web/src/lib/list.ts`. Delete `move` and
  `itemTitle` from `fields.tsx` and import them from `@/lib/list`.

- [ ] **Step 4: Run** `bun test apps/web/src/lib/list.test.ts && bun run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `Add list editing helpers`.

---

### Task 2: Two-pane list editor

**Files:**
- Create: `apps/web/src/components/editor/list-editor.tsx`, `item-index.tsx`, `list-ids.tsx`,
  `apps/web/src/components/ui/toast.tsx`, `apps/web/src/lib/use-container-width.ts`
- Modify: `apps/web/src/components/editor/fields.tsx` (`FieldInput` `list`/`blocks` cases;
  extract the block-type grid into `BlockPicker`), `apps/web/src/routes/entry.tsx` (provider,
  card width), `apps/web/src/locales/en.ts`, `nl.ts`, `apps/web/package.json`

**Interfaces:**
- Consumes: everything from Task 1; `previewUrl` from `@/lib/content`; `useEditor()` (`siteId`,
  `missing`, `readOnly`).
- Produces:
  - `ListIdsProvider({ children })` and `useListIds(path: string, length: number): { ids: string[]; insert(at: number): void; remove(at: number): void; move(from: number, to: number): void }`
    in `list-ids.tsx`: ids live in a `Map<string, string[]>` ref in the provider and pass through
    `reconcileIds` on every render. `EntryPage` and `NewEntry` wrap their `FieldList` in it.
  - `ListEditor({ field, value, path, onChange }: { field: FieldDef; value: unknown[]; path: string; onChange: (v: unknown) => void })`
  - `ItemIndex({ field, value, listPath, ids, selectedIndex, onSelect, onMove, search, size }: { …; size: 'md' | 'sm' })`:
    sortable compact rows, reused by Task 3 (`size: 'sm'` = 24px thumbs).
  - `useContainerWidth(ref: RefObject<HTMLElement | null>): number` (ResizeObserver).
  - `Toast({ message, actionLabel, onAction, onClose, timeoutMs = 8000 })`: fixed bottom-center.
  - `BlockPicker({ blocks, onPick, onCancel })` exported from `fields.tsx`.
  - Selection here is local `useState<string | null>` holding a full item path, set through a
    `select(path, mode)` function that Task 3 rewires to the URL.

- [ ] **Step 1: Add dependencies** `bun add --cwd apps/web @dnd-kit/core@6.3.1 @dnd-kit/sortable@10.0.0 @dnd-kit/utilities@3.2.2`.

- [ ] **Step 2: Build `ItemIndex`**: `DndContext` with `PointerSensor`, `TouchSensor` (delay
  200ms) and `KeyboardSensor` (`sortableKeyboardCoordinates`); `SortableContext` with
  `verticalListSortingStrategy` over `ids`. Row: grip, thumbnail when `hasImageField(fields)`
  (`previewUrl(src, siteId, 160)`, 30px `object-cover`; neutral placeholder when
  `thumbnailOf` is null), title (`itemTitle` ?? `t('editor.item', { n })`; blocks prefixed with
  the block label), snippet, amber dot when any `missing` path starts with `${listPath}.${i}`.
  Rows not matching `search` are hidden, except the selected one.

- [ ] **Step 3: Build `ListEditor`**:
  - Sticky toolbar: label + count pill, search `Input`, primary Add (blocks: `BlockPicker` in a
    `Dialog`). Add appends (`{}` or block defaults, as today), calls `ids.insert`, selects the new
    item and focuses its first input or textarea in the pane.
  - **Wide** when container ≥ 640px: index 40% left, pane right; default selection = first item.
    **Narrow**: index only until a row is tapped, then pane only with a "‹ {label}" back link; no
    default selection.
  - Pane header: item title, move menu (Move up / Move down / Move to top / Move to bottom),
    Delete, ‹ previous / next ›. Body: `FieldList` with `path={`${path}.${i}`}` and
    `onChange={(v) => onChange(setIn(value, [i], v))}`. Unknown block type: existing
    `errors.invalid_input` message.
  - Delete: remove item and id, select the neighbour, show `Toast` with `editor.removed` and
    `editor.undo`; Undo re-inserts item and id at the old index and selects it.
  - Empty list: empty state with Add.

- [ ] **Step 4: Wire into `FieldInput`**: `case 'list'`: `field.field` → existing single-value
  rows (Task 4 swaps image lists to the grid), `usesListEditor && !isInlineList` → `ListEditor`,
  inline → existing expanded rendering keyed by `useListIds`. `case 'blocks'` → `ListEditor`.
  Remove the old object branch of `ListInput`, the old `BlocksInput` body, and `keyFor` once
  unused.

- [ ] **Step 5: Widen the card**: in `entry.tsx` both `mx-auto max-w-3xl` wrappers become
  `cn('mx-auto', hasListEditor(collection.fields) ? 'max-w-6xl' : 'max-w-3xl')`.

- [ ] **Step 6: Strings** (en / nl): `editor.searchItems` "Search…" / "Zoeken…",
  `editor.moveTop` "Move to top" / "Naar boven", `editor.moveBottom` "Move to bottom" / "Naar onderen",
  `editor.removed` "{{title}} removed" / "{{title}} verwijderd", `editor.undo` "Undo" / "Ongedaan maken",
  `editor.previous` "Previous" / "Vorige", `editor.next` "Next" / "Volgende",
  `editor.backToList` "Back to {{label}}" / "Terug naar {{label}}", `editor.noItems` "Nothing here yet" / "Nog niets toegevoegd".

- [ ] **Step 7: Verify**: `bun run typecheck && bun run lint && bun test` pass. Then
  `bun run dev` against a site whose config has a list of objects with 20+ items (any linked test
  site, or the fake setup used in `apps/server/test`) and check: index instead of open forms;
  search; Add focuses the first input; drag reorder; keyboard reorder via the menu; delete +
  undo; previous/next; narrow layout at 375px; typing in an item keeps focus.

- [ ] **Step 8: Commit** `Edit lists of items in an index with a detail pane`.

---

### Task 3: Nested drill-down and selection in the URL

**Files:**
- Create: `apps/web/src/components/editor/nested-rows.tsx`, `apps/web/src/components/editor/list-nav.ts`
- Modify: `list-editor.tsx`, `fields.tsx` (`FieldInput`), `apps/web/src/router.tsx`
  (`entryRoute` `validateSearch`)

**Interfaces:**
- Consumes: `resolveChain`, `setIn`, `ItemIndex`, `useListIds`.
- Produces:
  - Entry route search `{ item?: string }`, kept when it matches `/^[\w-]+(\.[\w-]+)*$/` and is
    at most 300 chars.
  - `ListNavContext = createContext<{ select(path: string | null, mode: 'push' | 'replace'): void } | null>(null)`
    in `list-nav.ts`, provided around the pane of a `ListEditor`.
  - `NestedRows({ field, value, path, onChange })`: `ItemIndex` with `size: 'sm'` plus a small
    "+ Add"; clicking row `i` calls `select(`${path}.${i}`, 'push')`; Add appends, then selects.

- [ ] **Step 1: `validateSearch`** on `entryRoute` per the rule above.

- [ ] **Step 2: Selection from the URL**: `ListEditor` reads `item` with `useSearch({ strict: false })`
  and uses it when it starts with `${path}.`; otherwise local state as in Task 2.
  `select(p, mode)` → `navigate({ search: (s) => ({ ...s, item: p ?? undefined }), replace: mode === 'replace' })`.
  Row clicks and previous/next use `'replace'`; drilling and crumbs use `'push'`. Reorder and
  delete move the param to the moved / neighbouring item (`'replace'`).

- [ ] **Step 3: Drill-down pane**: `resolveChain(field, path, value, selected)`; the pane edits
  the **last** level: `FieldList` with `fields = level.fields`,
  `path = `${level.listPath}.${level.index}``, `onChange = (v) => onChange(setIn(value, segments, v))`
  where `segments` is the level's path relative to `path`, numeric parts as numbers. Breadcrumb
  above the form: list label, then one crumb per level (title or "Item n"). Previous/next move
  among the last level's siblings. Narrow back link goes up one level.

- [ ] **Step 4: `FieldInput`**: when `useContext(ListNavContext)` is non-null and the field
  `usesListEditor` (and isn't inline), render `NestedRows` instead of `ListEditor`.

- [ ] **Step 5: Verify**: `bun run typecheck && bun run lint && bun test`; in `bun run dev` with
  a list inside a list item: drill in two levels, reload keeps the place, Back steps out one
  level, a nested edit autosaves (visible in the publish dialog), `?item=…packages.7` falls back
  to the parent item.

- [ ] **Step 6: Commit** `Drill into nested lists and keep the selected item in the URL`.

---

### Task 4: Photo grid for image lists

**Files:**
- Create: `apps/web/src/components/editor/image-grid.tsx`
- Modify: `apps/web/src/components/editor/media.tsx` (`MediaPicker` multi-select,
  `DropZone` multiple files), `fields.tsx` (`list` with `field.field?.type === 'image'`),
  `apps/web/src/lib/list.ts` + `list.test.ts` (`appendUpTo`), locales

**Interfaces:**
- Consumes: `useListIds`, `moveIds` (Tasks 1–2); `MediaPicker`, `DropZone`, `useUpload`,
  `previewUrl` (phase 5).
- Produces:
  - `appendUpTo<T>(list: T[], items: T[], max?: number): { list: T[]; added: number; dropped: number }`
    in `lib/list.ts`.
  - `MediaPicker` gains optional `multiple?: boolean`, `current?: string[]`,
    `onSelectMany?: (srcs: string[]) => void`. With `multiple`, clicking toggles selection
    (checkbox overlay), a footer shows `media.selected` + Add (calls `onSelectMany`, closes);
    items whose `src` is in `current` are dimmed with `media.alreadyAdded` and not selectable.
    Uploading inside the picker in multi mode selects the new item instead of closing.
    Single-select behaviour is unchanged.
  - `DropZone` gains optional `multiple?: boolean` and `onFiles?: (files: File[]) => void`
    (file input gets `multiple`; drop passes all files). Existing `onFile` callers unchanged.
  - `ImageGrid({ field, value, path, onChange }: { field: FieldDef; value: unknown[]; path: string; onChange: (v: unknown) => void })`.

- [ ] **Step 1: Failing tests** for `appendUpTo`: `appendUpTo(['a','b','c'], ['d','e','f','g','h'], 5)`
  → `list ['a','b','c','d','e']`, `added 2`, `dropped 3`; without `max` all are added; duplicates
  are allowed (`appendUpTo(['a'], ['a'])` → `['a','a']`).

- [ ] **Step 2: Run** `bun test apps/web/src/lib/list.test.ts`. Expected: FAIL; implement; PASS.

- [ ] **Step 3: Extend `MediaPicker` and `DropZone`** as specified.

- [ ] **Step 4: Build `ImageGrid`**: toolbar with label, count (`n / max` when `maxItems`),
  "Select" toggle, primary `media.addPhotos`. Square tiles (`grid-cols-3 @lg:grid-cols-6`,
  `previewUrl(src, siteId, 400)`, `object-cover`), position number, ✕ on hover/focus, drag with
  `rectSortingStrategy` over `useListIds` ids. Clicking a tile opens a small menu: Replace (opens
  `MediaPicker` single, replaces that index), Remove, Move to start, Move to end. Select mode:
  checkboxes and a `media.removeN` action. Last tile `+ media.add` opens `MediaPicker` with
  `multiple` and `current = value`; `onSelectMany` → `appendUpTo` with `field.maxItems`. The
  whole grid is a `DropZone` with `multiple`: files upload one after another via `useUpload`,
  each success is appended through `appendUpTo` (stop once full), failures show phase 5's
  `Alert` with `errorMessage`. Add and drop are disabled when full or `readOnly`.

- [ ] **Step 5: Wire** `FieldInput`: `list` with `field.field?.type === 'image'` → `ImageGrid`.

- [ ] **Step 6: Strings** (en / nl): `media.addPhotos` "Add photos" / "Foto's toevoegen",
  `media.add` "Add" / "Toevoegen", `media.select` "Select" / "Selecteren",
  `media.removeN` "Remove {{count}}" / "{{count}} weghalen", `media.moveStart` "Move to start" /
  "Naar het begin", `media.moveEnd` "Move to end" / "Naar het eind", `media.selected`
  "{{count}} selected" / "{{count}} geselecteerd", `media.alreadyAdded` "Already added" /
  "Al toegevoegd", `media.full` "Full ({{max}} max)" / "Vol (max. {{max}})". Reuse existing
  `media.*` keys from phase 5 where one fits.

- [ ] **Step 7: Verify**: `bun test && bun run typecheck && bun run lint`; in `bun run dev`, a
  45-image list renders as a grid; drag with mouse and touch emulation; the same image twice gives
  two independent tiles; multi-pick from the library; drop 3 files → 3 uploads appended; with
  `maxItems: 5` the grid stops at 5; single image fields (`MediaField`) still work.

- [ ] **Step 8: Commit** `Show image lists as a sortable photo grid`.

---

### Task 5: "Not used yet" and incomplete listings in the library

**Files:**
- Modify: `apps/server/src/content/media.ts` (`MediaService.list`, new `usage`),
  `apps/server/test/media.test.ts`, `apps/web/src/components/editor/media.tsx` (`MediaPicker`),
  locales, `docs/content-config.md`

**Interfaces:**
- Produces:
  - `MediaItem.used: boolean`; `MediaService.list()` returns
    `{ settings, items, complete: boolean }` with `complete = !tree.truncated`.
  - `MediaService.usage(srcs: string[]): Promise<Set<string>>`: for every collection, the text of
    each published file (folder prefix / file path, via `ContentService.files()` and its blob
    reads) plus each upsert draft's serialized content; a `src` is used when the text contains it.
    Cached in a module-level `Map` keyed `${site.id}:${headSha}:${latest draft updatedAt}`,
    at most 50 keys.
  - `MediaPicker`: a `media.notUsed` toggle next to search (filters to `!used`), and a
    `media.incomplete` notice when `complete === false`.

- [ ] **Step 1: Failing tests** in `media.test.ts` (reuse its world/setup helpers): a folder
  collection entry whose rich-text body references `/uploads/a.webp`, a file collection
  referencing nothing, and `public/uploads/b.webp` unreferenced → list gives `used: true` for
  `a`, `false` for `b`, `complete: true`; after saving a draft that references `/uploads/b.webp`,
  `b` is `used: true`; a staged upload not yet referenced is `used: false`.

- [ ] **Step 2: Run** `bun test apps/server/test/media.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** `usage`, `used`, `complete`; then the picker toggle and notice.

- [ ] **Step 4: Strings** (en / nl): `media.notUsed` "Not used yet" / "Nog niet gebruikt",
  `media.incomplete` "Not every file could be listed (very large repository)." / "Niet alle
  bestanden konden worden getoond (zeer grote repository).". Mention the filter in the "Images and
  files" section of `docs/content-config.md`.

- [ ] **Step 5: Run** `bun test && bun run typecheck && bun run lint`. Expected: PASS.

- [ ] **Step 6: Commit** `Show which library images no content uses yet`.

---

### Task 6: Collection index sorting and pagination

**Files:**
- Create: `apps/web/src/lib/collection-view.ts`, `apps/web/src/lib/collection-view.test.ts`
- Modify: `apps/server/src/content/service.ts` (`listEntries` `values`),
  `apps/server/src/routes/content.ts` (`clientCollection`), `apps/server/test/content-api.test.ts`,
  `apps/web/src/router.tsx` (collection route `validateSearch`), `apps/web/src/routes/collection.tsx`,
  locales

**Interfaces:**
- Produces:
  - Server: each listed entry gains `values: Record<string, unknown>` with the `sortBy` field and
    every top-level `date`/`datetime` field; `clientCollection` gains `sortBy: string | null`,
    `sortOrder: 'asc' | 'desc'`.
  - Collection route search `{ page?: number; sort?: string; dir?: 'asc' | 'desc' }`.
  - `sortOptions(collection: CollectionInfo): { key: string; label: Label | string }[]`:
    `'title'` first, then `sortBy` (if not already a date field), then date/datetime fields.
  - `sortEntries(entries: EntrySummary[], key: string, dir: 'asc' | 'desc'): EntrySummary[]`:
    `'title'` compares `title ?? slug` with `localeCompare`; other keys compare `values[key]`;
    missing values last in both directions; ties by title.
  - `paginate<T>(list: T[], page: number, size = 25): { items: T[]; page: number; pages: number; from: number; to: number }`:
    page clamped to `1..pages`, `pages ≥ 1`.

- [ ] **Step 1: Failing tests**: server: listing a Gastenboek-like fixture returns
  `values.date`; `/content` collections include `sortBy`/`sortOrder`. Web: `sortEntries` by
  `date` desc puts an entry without a date last; `paginate(range(60), 3)` → 10 items, `pages 3`,
  `from 51`, `to 60`; `paginate([], 5)` → `page 1, pages 1, from 0, to 0`.

- [ ] **Step 2: Run** `bun test`, expect FAIL; **implement**; run, expect PASS.

- [ ] **Step 3: UI**: sort `Select` + direction toggle next to the search box (search still
  appears above 6 entries). Initial sort from the URL, else
  `localStorage['drikus.sort.<siteId>.<collection>']` (reads/writes in try/catch), else
  `sortBy`/`sortOrder`, else `title`/`asc`; changing it updates the URL (`replace`) and storage.
  Search filters all entries and resets to page 1. When the sort key isn't `title`, rows show its
  value in a muted column (dates via `toLocaleDateString`). Pagination footer only above 25
  entries: `collection.range` and previous / next.
  Strings: `collection.sort` "Sort by" / "Sorteer op", `collection.sortTitle` "Title" / "Titel",
  `collection.ascending` "Ascending" / "Oplopend", `collection.descending` "Descending" / "Aflopend",
  `collection.range` "{{from}}–{{to}} of {{total}}" / "{{from}}–{{to}} van {{total}}".

- [ ] **Step 4: Verify** `bun test && bun run typecheck && bun run lint`; in `bun run dev`, a
  collection with 60 entries pages, and the sort survives a reload.

- [ ] **Step 5: Commit** `Sort and page collection indexes`.

---

### Task 7: Docs and final check

**Files:**
- Modify: `docs/content-config.md`, `README.md` (status table, if it lists editor features)

- [ ] **Step 1:** In `docs/content-config.md`, describe: lists of objects and blocks open as an
  index with a detail pane; short lists (≤ 3 items with short fields) stay inline; image lists
  become a photo grid; the first `image` field supplies row thumbnails; the selected item is in
  the URL.
- [ ] **Step 2:** `bun test && bun run typecheck && bun run lint && bun run build`. Expected: all pass.
- [ ] **Step 3: Commit** `Document list and image editing`.

## After this plan (not tasks here)

- hond-morvan-v2: add `media: { folder: src/assets/images, publicPath: /images }` to
  `.drikus/config.yml` (manual commit in that repo), so its existing photos show in the library
  and uploads land where `src/utils/images.ts` finds them.
