import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronRight, GripVertical } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { type FieldDef, previewUrl, useLabel } from '@/lib/content'
import {
  asObject,
  hasImageField,
  itemFields,
  itemSnippet,
  itemTitle,
  matchesSearch,
  thumbnailOf,
} from '@/lib/list'
import { useEditor } from './context'

/** The title shown for an item in rows and headers; blocks lead with their type. */
export function useItemLabeler() {
  const { t } = useTranslation()
  const label = useLabel()
  return (field: FieldDef, raw: unknown, index: number): string => {
    const item = asObject(raw)
    const fields = itemFields(field, item)
    const title = fields ? itemTitle(fields, item) : null
    if (field.type !== 'blocks') return title ?? t('editor.item', { n: index + 1 })
    const block = field.blocks?.find((b) => b.name === item[field.typeKey])
    const type = block ? label(block.label, block.name) : String(item[field.typeKey] ?? '?')
    return title ? `${type} · ${title}` : type
  }
}

export function useItemLabel(field: FieldDef) {
  const labeler = useItemLabeler()
  return (raw: unknown, index: number): string => labeler(field, raw, index)
}

/** Compact, sortable rows for the items of a list or blocks field. */
export function ItemIndex({
  field,
  value,
  listPath,
  ids,
  selectedIndex,
  onSelect,
  onMove,
  search,
  size,
}: {
  field: FieldDef
  value: unknown[]
  listPath: string
  ids: string[]
  selectedIndex: number | null
  onSelect: (index: number) => void
  onMove: (from: number, to: number) => void
  search: string
  size: 'md' | 'sm'
}) {
  const { readOnly, missing } = useEditor()
  const sensors = useSensors(
    // Mouse and touch apart: a pointer sensor claims touches too, which the page's panning
    // then cancels. Touch drags start after a short press so scrolling still works.
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const itemLabel = useItemLabel(field)

  const visible = value.flatMap((raw, i) => {
    const item = asObject(raw)
    const fields = itemFields(field, item) ?? []
    return i === selectedIndex || matchesSearch(fields, item, search) ? [{ i, item, fields }] : []
  })
  const missingAt = (i: number) => {
    const prefix = `${listPath}.${i}`
    for (const p of missing) if (p === prefix || p.startsWith(`${prefix}.`)) return true
    return false
  }

  const dragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from >= 0 && to >= 0) onMove(from, to)
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
      <SortableContext
        items={visible.map(({ i }) => ids[i] as string)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="space-y-1">
          {visible.map(({ i, item, fields }) => (
            <Row
              key={ids[i]}
              id={ids[i] as string}
              size={size}
              disabled={readOnly}
              selected={i === selectedIndex}
              title={itemLabel(item, i)}
              snippet={itemSnippet(fields, item)}
              thumb={hasImageField(fields) ? (thumbnailOf(fields, item) ?? '') : null}
              warn={missingAt(i)}
              onSelect={() => onSelect(i)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function Row({
  id,
  size,
  disabled,
  selected,
  title,
  snippet,
  thumb,
  warn,
  onSelect,
}: {
  id: string
  size: 'md' | 'sm'
  disabled: boolean
  selected: boolean
  title: string
  snippet: string | null
  /** null: no image field; '': image field without a value. */
  thumb: string | null
  warn: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const { siteId } = useEditor()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  })
  const src = thumb ? previewUrl(thumb, siteId, 160) : null

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'flex items-center gap-1 rounded-lg border',
        selected
          ? 'border-brand-600 bg-brand-50'
          : 'border-transparent bg-white hover:border-stone-200 hover:bg-stone-50',
        isDragging && 'relative z-10 shadow-lg',
      )}
    >
      {!disabled && (
        <button
          type="button"
          className="cursor-grab touch-none self-stretch rounded-l-lg px-1 text-stone-400 hover:text-stone-700 active:cursor-grabbing"
          title={t('media.reorder')}
          {...attributes}
          {...listeners}
          aria-label={t('media.reorder')}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected || undefined}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2.5 py-1.5 pr-2 text-left',
          disabled && 'pl-2',
        )}
      >
        {thumb !== null &&
          (src ? (
            <img
              src={src}
              alt=""
              loading="lazy"
              className={cn(
                'shrink-0 rounded object-cover',
                size === 'sm' ? 'size-6' : 'size-[30px]',
              )}
            />
          ) : (
            <span
              className={cn(
                'shrink-0 rounded bg-stone-200',
                size === 'sm' ? 'size-6' : 'size-[30px]',
              )}
            />
          ))}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-stone-800">{title}</span>
          {snippet && <span className="block truncate text-xs text-stone-500">{snippet}</span>}
        </span>
        {warn && (
          <span
            className="size-2 shrink-0 rounded-full bg-amber-500"
            title={t('editor.missing')}
            role="img"
            aria-label={t('editor.missing')}
          />
        )}
        {size === 'sm' && <ChevronRight className="size-4 shrink-0 text-stone-400" aria-hidden />}
      </button>
    </li>
  )
}
