import { useNavigate, useSearch } from '@tanstack/react-router'
import { ArrowUpDown, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { Toast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { type FieldDef, useLabel } from '@/lib/content'
import {
  asObject,
  type ChainLevel,
  insideItemOf,
  move,
  movedIndex,
  resolveChain,
  setIn,
} from '@/lib/list'
import { useContainerWidth } from '@/lib/use-container-width'
import { useEditor } from './context'
import { FieldList } from './fields'
import { ItemIndex, useItemLabeler } from './item-index'
import { useListIds, useListIdsFor } from './list-ids'
import { ListNavContext } from './list-nav'
import { useAddItem } from './nested-rows'

type Mode = 'push' | 'replace'

/** Below this container width the index and the item take turns instead of sitting side by side. */
const WIDE = 640

const FIRST_INPUT = 'input:not([type="hidden"]):not([type="file"]), textarea'

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** The segments of `p` below `base`, list indexes as numbers, for `setIn`. */
const segmentsOf = (base: string, p: string): (string | number)[] =>
  p === base
    ? []
    : p
        .slice(base.length + 1)
        .split('.')
        .map((s) => (/^\d+$/.test(s) ? Number(s) : s))

const getAt = (value: unknown, segments: (string | number)[]): unknown =>
  segments.reduce<unknown>(
    (v, s) => (typeof s === 'number' ? asArray(v)[s] : asObject(v)[s]),
    value,
  )

const itemPathOf = (l: ChainLevel) => `${l.listPath}.${l.index}`

/**
 * A list of objects or blocks: an index of compact rows next to the selected item's form.
 * Lists inside the selected item drill down in the same pane; the selected path is kept in
 * the `item` search param.
 */
export function ListEditor({
  field,
  value,
  path,
  onChange,
}: {
  field: FieldDef
  value: unknown[]
  path: string
  onChange: (v: unknown) => void
}) {
  const { t } = useTranslation()
  const label = useLabel()
  const { readOnly } = useEditor()
  const ids = useListIds(path, value.length)
  const idsFor = useListIdsFor()
  const labeler = useItemLabeler()
  const navigate = useNavigate()
  const { item: urlItem } = useSearch({ strict: false })
  const root = useRef<HTMLDivElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const wide = useContainerWidth(root) >= WIDE
  const [search, setSearch] = useState('')
  const [removed, setRemoved] = useState<{
    item: unknown
    listPath: string
    index: number
    title: string
    seq: number
  } | null>(null)
  const removals = useRef(0)
  /** The item whose first input to focus once its form shows (a just-added item). */
  const focusNew = useRef<string | null>(null)

  // The URL holds one selection for the whole form. While it points into this list it wins;
  // while it points into another list, this one keeps what was last selected here.
  const ours = typeof urlItem === 'string' && urlItem.startsWith(`${path}.`) ? urlItem : null
  const [local, setLocal] = useState<string | null>(ours)
  if (ours !== null && ours !== local) setLocal(ours)
  const selected = ours ?? (typeof urlItem === 'string' ? local : null)

  // Replace for selecting, previous/next, reorder and delete; push for drilling and crumbs,
  // so Back steps out one level instead of through every click.
  const select = (next: string | null, mode: Mode, options?: { focus?: boolean }) => {
    if (options?.focus) focusNew.current = next
    setLocal(next)
    if (next === null && ours === null) return
    void navigate({
      to: '.',
      search: (s) => ({ ...s, item: next ?? undefined }),
      replace: mode === 'replace',
      // Stay where the editor is on the page; the router scrolls to the top by default.
      resetScroll: false,
    })
  }

  // A stale or invalid path shows its deepest valid level; wide screens default to the first.
  const explicit = resolveChain(field, path, value, selected)
  const chain =
    explicit.length || !wide || !value.length
      ? explicit
      : resolveChain(field, path, value, `${path}.0`)
  const level = chain.at(-1) ?? null
  const top = chain[0]?.index ?? null
  const listLabel = label(field.label, field.name)
  const full = field.maxItems !== undefined && value.length >= field.maxItems

  /** The items of the list a chain level sits in. */
  const siblingsOf = (n: number): unknown[] =>
    asArray(getAt(value, segmentsOf(path, (chain[n] as ChainLevel).listPath)))
  const setList = (listPath: string, next: unknown[]) =>
    onChange(setIn(value, segmentsOf(path, listPath), next))
  /** A pending Undo for a list inside the item that changes position would land elsewhere. */
  const dropUndoUnder = (listPath: string) => {
    if (removed && insideItemOf(removed.listPath, listPath)) setRemoved(null)
  }
  const nav = { select, moved: dropUndoUnder }

  // Wait until the new item's form shows (the URL catches up a render later), then focus.
  const shown = level ? itemPathOf(level) : null
  useEffect(() => {
    if (!focusNew.current || focusNew.current !== shown) return
    focusNew.current = null
    pane.current?.querySelector<HTMLElement>(FIRST_INPUT)?.focus()
  })

  const { add, picker } = useAddItem(field, (item) => {
    ids.insert(value.length)
    onChange([...value, item])
    select(`${path}.${value.length}`, 'replace', { focus: true })
  })

  const moveIn = (listPath: string, items: unknown[], from: number, to: number) => {
    if (from === to || to < 0 || to >= items.length) return
    idsFor(listPath, items.length).move(from, to)
    setList(listPath, move(items, from, to))
    dropUndoUnder(listPath)
    // Follow the shown item if it is (or sits inside) one of the list's items.
    const current = level ? itemPathOf(level) : null
    if (!current?.startsWith(`${listPath}.`)) return
    const [k, ...rest] = current.slice(listPath.length + 1).split('.')
    select([`${listPath}.${movedIndex(from, to)(Number(k))}`, ...rest].join('.'), 'replace')
  }

  const removeAt = (n: number) => {
    const l = chain[n] as ChainLevel
    const items = siblingsOf(n)
    const i = l.index
    setRemoved({
      item: items[i],
      listPath: l.listPath,
      index: i,
      title: labeler(l.field, items[i], i),
      seq: ++removals.current,
    })
    idsFor(l.listPath, items.length).remove(i)
    setList(
      l.listPath,
      items.filter((_, j) => j !== i),
    )
    const left = items.length - 1
    const parent = n > 0 ? itemPathOf(chain[n - 1] as ChainLevel) : null
    select(left > 0 ? `${l.listPath}.${Math.min(i, left - 1)}` : parent, 'replace')
  }
  const undo = () => {
    if (!removed) return
    const items = asArray(getAt(value, segmentsOf(path, removed.listPath)))
    const at = Math.min(removed.index, items.length)
    idsFor(removed.listPath, items.length).insert(at)
    setList(removed.listPath, [...items.slice(0, at), removed.item, ...items.slice(at)])
    select(`${removed.listPath}.${at}`, 'replace')
  }

  const addButton = !readOnly && !full && (
    <Button size="sm" onClick={add}>
      <Plus className="size-4" /> {field.type === 'blocks' ? t('editor.addBlock') : t('editor.add')}
    </Button>
  )

  const indexPane = (
    <ItemIndex
      field={field}
      value={value}
      listPath={path}
      ids={ids.ids}
      selectedIndex={top}
      onSelect={(i) => select(`${path}.${i}`, 'replace')}
      onMove={(from, to) => moveIn(path, value, from, to)}
      search={search}
      size="md"
    />
  )

  const up = chain.length > 1 ? (chain[chain.length - 2] as ChainLevel) : null

  return (
    <div ref={root} className="rounded-xl border border-stone-200 bg-white">
      <div className="sticky top-16 z-[5] flex flex-wrap items-center gap-2 rounded-t-xl border-b border-stone-200 bg-white/95 px-3 py-2 backdrop-blur">
        <span className="flex items-center gap-2 text-sm font-medium text-stone-800">
          {listLabel}
          {field.required && (
            <span className="text-xs font-normal text-stone-400">{t('editor.required')}</span>
          )}
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
            {value.length}
          </span>
        </span>
        {/* Narrow with an item open, the index it filters is hidden. */}
        {value.length > 0 && (wide || level === null) && (
          <Input
            type="search"
            className="h-9 min-w-32 flex-1"
            value={search}
            placeholder={t('editor.searchItems')}
            aria-label={t('editor.searchItems')}
            onChange={(e) => setSearch(e.target.value)}
            // On a new entry the editor is a form; Enter here must not submit it.
            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          />
        )}
        <div className="ml-auto">{addButton}</div>
      </div>

      {value.length === 0 ? (
        <div className="space-y-3 px-4 py-10 text-center">
          <p className="text-sm text-stone-500">{t('editor.noItems')}</p>
          {addButton}
        </div>
      ) : wide ? (
        <div className="flex">
          <div className="max-h-[75vh] w-2/5 shrink-0 overflow-y-auto border-r border-stone-200 p-2">
            {indexPane}
          </div>
          <div className="min-w-0 flex-1">{renderPane()}</div>
        </div>
      ) : level === null ? (
        <div className="p-2">{indexPane}</div>
      ) : (
        <div>
          {/* Up one level: to the item this list sits in, or to the index. */}
          <button
            type="button"
            onClick={() => (up ? select(itemPathOf(up), 'push') : select(null, 'replace'))}
            className="flex items-center gap-1 px-3 pt-3 text-sm font-medium text-brand-700 hover:underline"
          >
            <ChevronLeft className="size-4" />{' '}
            {t('editor.backToList', {
              label: up ? labeler(up.field, up.item, up.index) : listLabel,
            })}
          </button>
          {renderPane()}
        </div>
      )}

      {picker}
      {removed && (
        <Toast
          key={removed.seq}
          message={t('editor.removed', { title: removed.title })}
          actionLabel={t('editor.undo')}
          onAction={undo}
          onClose={() => setRemoved(null)}
        />
      )}
    </div>
  )

  /** The form of the deepest selected item; only one level of forms is ever visible. */
  function renderPane() {
    if (!level) return null
    const n = chain.length - 1
    const items = siblingsOf(n)
    const i = level.index
    const levelIds = idsFor(level.listPath, items.length)
    const itemPath = itemPathOf(level)
    const block =
      level.field.type === 'blocks'
        ? level.field.blocks?.find((b) => b.name === level.item[level.field.typeKey])
        : null
    const navButton =
      'rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-30'
    const crumb = 'min-w-0 truncate hover:text-stone-900 hover:underline'
    return (
      <div ref={pane} key={levelIds.ids[i]}>
        {chain.length > 1 && (
          <nav
            aria-label={t('editor.breadcrumb')}
            className="flex flex-wrap items-center gap-1 px-4 pt-3 text-xs text-stone-500"
          >
            {wide ? (
              <span>{listLabel}</span>
            ) : (
              <button type="button" className={crumb} onClick={() => select(null, 'push')}>
                {listLabel}
              </button>
            )}
            {chain.map((c, k) => (
              <Fragment key={c.listPath}>
                <ChevronRight className="size-3 shrink-0" aria-hidden />
                {k === n ? (
                  <span aria-current="page" className="min-w-0 truncate text-stone-700">
                    {labeler(c.field, c.item, c.index)}
                  </span>
                ) : (
                  <button
                    type="button"
                    className={crumb}
                    onClick={() => select(itemPathOf(c), 'push')}
                  >
                    {labeler(c.field, c.item, c.index)}
                  </button>
                )}
              </Fragment>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-1 border-b border-stone-100 py-2 pr-2 pl-4">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-800">
            {labeler(level.field, items[i], i)}
          </h3>
          {!readOnly && items.length > 1 && (
            <MoveMenu
              index={i}
              count={items.length}
              onMove={(to) => moveIn(level.listPath, items, i, to)}
            />
          )}
          {!readOnly && (
            <button
              type="button"
              className={cn(navButton, 'hover:text-red-700')}
              onClick={() => removeAt(n)}
              title={t('editor.remove')}
              aria-label={t('editor.remove')}
            >
              <Trash2 className="size-4" />
            </button>
          )}
          <button
            type="button"
            className={navButton}
            disabled={i === 0}
            onClick={() => select(`${level.listPath}.${i - 1}`, 'replace')}
            title={t('editor.previous')}
            aria-label={t('editor.previous')}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            className={navButton}
            disabled={i === items.length - 1}
            onClick={() => select(`${level.listPath}.${i + 1}`, 'replace')}
            title={t('editor.next')}
            aria-label={t('editor.next')}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="p-4">
          {level.fields ? (
            <ListNavContext.Provider value={nav}>
              {block?.hint && <p className="mb-4 text-sm text-stone-500">{label(block.hint)}</p>}
              <FieldList
                fields={level.fields}
                value={level.item}
                path={itemPath}
                onChange={(v) => onChange(setIn(value, segmentsOf(path, itemPath), v))}
              />
            </ListNavContext.Provider>
          ) : (
            <p className="text-sm text-stone-500">{t('errors.invalid_input')}</p>
          )}
        </div>
      </div>
    )
  }
}

/** Move the item without dragging: up, down, to the top or to the bottom. */
function MoveMenu({
  index,
  count,
  onMove,
}: {
  index: number
  count: number
  onMove: (to: number) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const last = count - 1
  const options = [
    { label: t('editor.moveUp'), to: index - 1, disabled: index === 0 },
    { label: t('editor.moveDown'), to: index + 1, disabled: index === last },
    { label: t('editor.moveTop'), to: 0, disabled: index === 0 },
    { label: t('editor.moveBottom'), to: last, disabled: index === last },
  ]
  const title = `${t('editor.moveUp')} / ${t('editor.moveDown')}`
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900"
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        aria-label={title}
        onClick={() => setOpen((o) => !o)}
      >
        <ArrowUpDown className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 z-[6] mt-1 w-48 rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
        >
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              role="menuitem"
              disabled={o.disabled}
              onClick={() => {
                onMove(o.to)
                setOpen(false)
              }}
              className="block w-full px-3 py-2 text-left text-sm text-stone-700 hover:bg-stone-100 disabled:text-stone-300 disabled:hover:bg-transparent"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
