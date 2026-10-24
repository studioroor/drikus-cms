import { ArrowUpDown, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/field'
import { Toast } from '@/components/ui/toast'
import { cn } from '@/lib/cn'
import { type Data, type FieldDef, useLabel } from '@/lib/content'
import { asObject, move, moveIds, resolveChain, setIn } from '@/lib/list'
import { useContainerWidth } from '@/lib/use-container-width'
import { useEditor } from './context'
import { BlockPicker, FieldList } from './fields'
import { ItemIndex, useItemLabel } from './item-index'
import { useListIds } from './list-ids'

type Block = NonNullable<FieldDef['blocks']>[number]

/** Below this container width the index and the item take turns instead of sitting side by side. */
const WIDE = 640

const FIRST_INPUT = 'input:not([type="hidden"]):not([type="file"]), textarea'

/** A list of objects or blocks: an index of compact rows next to the selected item's form. */
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
  const itemLabel = useItemLabel(field)
  const root = useRef<HTMLDivElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const wide = useContainerWidth(root) >= WIDE
  const [search, setSearch] = useState('')
  const [picking, setPicking] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [removed, setRemoved] = useState<{
    item: unknown
    index: number
    title: string
    seq: number
  } | null>(null)
  const removals = useRef(0)
  const focusNew = useRef(false)

  // Every selection change goes through here, so it can move into the URL later.
  const select = (next: string | null, _mode: 'push' | 'replace') => setSelected(next)
  const selectAt = (i: number | null) => select(i === null ? null : `${path}.${i}`, 'replace')

  const chosen = resolveChain(field, path, value, selected)[0]?.index
  const index = chosen ?? (wide && value.length ? 0 : null)
  const listLabel = label(field.label, field.name)
  const full = field.maxItems !== undefined && value.length >= field.maxItems

  useEffect(() => {
    if (!focusNew.current) return
    focusNew.current = false
    pane.current?.querySelector<HTMLElement>(FIRST_INPUT)?.focus()
  })

  const append = (item: unknown) => {
    ids.insert(value.length)
    onChange([...value, item])
    selectAt(value.length)
    focusNew.current = true
  }
  const add = () => (field.type === 'blocks' ? setPicking(true) : append({}))
  const addBlock = (block: Block) => {
    const initial: Data = { [field.typeKey]: block.name }
    for (const f of block.fields) if (f.default !== undefined) initial[f.name] = f.default
    setPicking(false)
    append(initial)
  }

  const moveItem = (from: number, to: number) => {
    if (from === to || to < 0 || to >= value.length) return
    const selectedId = index === null ? undefined : ids.ids[index]
    const nextIds = moveIds(ids.ids, from, to)
    ids.move(from, to)
    onChange(move(value, from, to))
    if (selectedId === undefined || index === null) return
    // Follow the selected item, keeping anything selected inside it.
    const rest = selected && chosen !== undefined ? selected.slice(`${path}.${chosen}`.length) : ''
    select(`${path}.${nextIds.indexOf(selectedId)}${rest}`, 'replace')
  }

  const removeAt = (i: number) => {
    setRemoved({ item: value[i], index: i, title: itemLabel(value[i], i), seq: ++removals.current })
    ids.remove(i)
    onChange(value.filter((_, j) => j !== i))
    const left = value.length - 1
    selectAt(left === 0 ? null : Math.min(i, left - 1))
  }
  const undo = () => {
    if (!removed) return
    const at = Math.min(removed.index, value.length)
    ids.insert(at)
    onChange([...value.slice(0, at), removed.item, ...value.slice(at)])
    selectAt(at)
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
      selectedIndex={index}
      onSelect={selectAt}
      onMove={moveItem}
      search={search}
      size="md"
    />
  )

  return (
    <div ref={root} className="rounded-xl border border-stone-200 bg-white">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-t-xl border-b border-stone-200 bg-white/95 px-3 py-2 backdrop-blur">
        <span className="flex items-center gap-2 text-sm font-medium text-stone-800">
          {listLabel}
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
            {value.length}
          </span>
        </span>
        {value.length > 0 && (
          <Input
            type="search"
            className="h-9 min-w-32 flex-1"
            value={search}
            placeholder={t('editor.searchItems')}
            aria-label={t('editor.searchItems')}
            onChange={(e) => setSearch(e.target.value)}
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
          <div className="min-w-0 flex-1">{index !== null && renderPane(index)}</div>
        </div>
      ) : index === null ? (
        <div className="p-2">{indexPane}</div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => select(null, 'replace')}
            className="flex items-center gap-1 px-3 pt-3 text-sm font-medium text-brand-700 hover:underline"
          >
            <ChevronLeft className="size-4" /> {t('editor.backToList', { label: listLabel })}
          </button>
          {renderPane(index)}
        </div>
      )}

      {picking && (
        <Dialog open onClose={() => setPicking(false)} title={t('editor.addBlock')}>
          <BlockPicker
            blocks={field.blocks ?? []}
            onPick={addBlock}
            onCancel={() => setPicking(false)}
          />
        </Dialog>
      )}
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

  function renderPane(i: number) {
    const item = asObject(value[i])
    const block =
      field.type === 'blocks' ? field.blocks?.find((b) => b.name === item[field.typeKey]) : null
    const fields = field.type === 'blocks' ? block?.fields : (field.fields ?? [])
    const nav =
      'rounded-md p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-30'
    return (
      <div ref={pane} key={ids.ids[i]}>
        <div className="flex items-center gap-1 border-b border-stone-100 py-2 pr-2 pl-4">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-800">
            {itemLabel(value[i], i)}
          </h3>
          {!readOnly && value.length > 1 && (
            <MoveMenu index={i} count={value.length} onMove={(to) => moveItem(i, to)} />
          )}
          {!readOnly && (
            <button
              type="button"
              className={cn(nav, 'hover:text-red-700')}
              onClick={() => removeAt(i)}
              title={t('editor.remove')}
              aria-label={t('editor.remove')}
            >
              <Trash2 className="size-4" />
            </button>
          )}
          <button
            type="button"
            className={nav}
            disabled={i === 0}
            onClick={() => selectAt(i - 1)}
            title={t('editor.previous')}
            aria-label={t('editor.previous')}
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            className={nav}
            disabled={i === value.length - 1}
            onClick={() => selectAt(i + 1)}
            title={t('editor.next')}
            aria-label={t('editor.next')}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="p-4">
          {fields ? (
            <>
              {block?.hint && <p className="mb-4 text-sm text-stone-500">{label(block.hint)}</p>}
              <FieldList
                fields={fields}
                value={item}
                path={`${path}.${i}`}
                onChange={(v) => onChange(setIn(value, [i], v))}
              />
            </>
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
          className="absolute top-full right-0 z-30 mt-1 w-48 rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
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
