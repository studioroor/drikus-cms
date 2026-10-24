import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, GripVertical, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Alert, Spinner } from '@/components/ui/feedback'
import { cn } from '@/lib/cn'
import { type FieldDef, previewUrl, useLabel } from '@/lib/content'
import { appendUpTo, move } from '@/lib/list'
import { useErrorMessage } from '@/lib/queries'
import { useEditor } from './context'
import { useListIds, useListIdsFor } from './list-ids'
import { DropZone, MediaPicker, useMounted, useUpload } from './media'

const tileBox = 'relative aspect-square overflow-hidden rounded-lg'

/** A list of single images as a sortable grid of square thumbnails. */
export function ImageGrid({
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
  const errorMessage = useErrorMessage()
  const { siteId, readOnly } = useEditor()
  const ids = useListIds(path, value.length)
  const idsFor = useListIdsFor()
  const upload = useUpload(siteId)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  /** 'add' or the index being replaced. */
  const [picking, setPicking] = useState<'add' | number | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [pending, setPending] = useState(0)
  const [errors, setErrors] = useState<{ id: string; text: string }[]>([])

  // Uploads finish one by one after renders; they append to the latest list through the
  // latest change handler (an old one would write back the entry as it was at drop time).
  const latest = useRef(value)
  latest.current = value
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // Once the grid is gone (another item selected, the item deleted) that handler is stale and
  // would revert later edits or bring a deleted item back: stop, and leave the rest of the batch
  // unuploaded. Files already uploaded stay in the library.
  const mounted = useMounted()

  const max = field.maxItems
  const full = max !== undefined && value.length >= max
  const canAdd = !readOnly && !full
  const srcs = value.filter((v): v is string => typeof v === 'string')

  const append = (items: string[]) => {
    const before = latest.current
    const { list, added } = appendUpTo<unknown>(before, items, max)
    if (!added || !mounted.current) return
    for (let i = 0; i < added; i++) idsFor(path, before.length + i).insert(before.length + i)
    latest.current = list
    onChangeRef.current(list)
  }
  const uploadFiles = async (files: File[]) => {
    setErrors([])
    for (const [n, file] of files.entries()) {
      if (!mounted.current) return
      if (max !== undefined && latest.current.length >= max) break
      setPending(files.length - n)
      try {
        const item = await upload.mutateAsync(file)
        append([item.src])
      } catch (error) {
        setErrors((e) => [
          ...e,
          { id: crypto.randomUUID(), text: `${file.name}: ${errorMessage(error)}` },
        ])
      }
    }
    setPending(0)
  }
  const removeAt = (i: number) => {
    ids.remove(i)
    onChange(value.filter((_, j) => j !== i))
  }
  const moveTo = (from: number, to: number) => {
    if (from === to) return
    ids.move(from, to)
    onChange(move(value, from, to))
  }
  const removeChecked = () => {
    const at = ids.ids.flatMap((id, i) => (checked.has(id) ? [i] : []))
    // Highest index first, so the indexes still to remove don't shift.
    for (const [n, i] of [...at].reverse().entries()) idsFor(path, value.length - n).remove(i)
    const gone = new Set(at)
    onChange(value.filter((_, i) => !gone.has(i)))
    setChecked(new Set())
    setSelecting(false)
  }
  const toggle = (id: string) =>
    setChecked((s) => {
      const next = new Set(s)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const dragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const from = ids.ids.indexOf(String(active.id))
    const to = ids.ids.indexOf(String(over.id))
    if (from >= 0 && to >= 0) moveTo(from, to)
  }

  // The pickers stay outside the drop zone: a drop inside their dialog must not bubble to it.
  return (
    <>
      <DropZone
        kind="image"
        multiple
        disabled={!canAdd || pending > 0}
        onFiles={(files) => void uploadFiles(files)}
        className="@container rounded-xl border border-stone-200 bg-white"
      >
        {() => (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-medium text-stone-800">
                {label(field.label, field.name)}
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                  {max !== undefined ? `${value.length} / ${max}` : value.length}
                </span>
              </span>
              {!readOnly && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {selecting ? (
                    <>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={!checked.size}
                        onClick={removeChecked}
                      >
                        {t('media.removeN', { count: checked.size })}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelecting(false)
                          setChecked(new Set())
                        }}
                      >
                        {t('common.cancel')}
                      </Button>
                    </>
                  ) : (
                    value.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => setSelecting(true)}>
                        {t('media.select')}
                      </Button>
                    )
                  )}
                  <Button
                    size="sm"
                    disabled={!canAdd}
                    title={full ? t('media.full', { max }) : undefined}
                    onClick={() => setPicking('add')}
                  >
                    <Plus className="size-4" /> {t('media.addPhotos')}
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-3 p-3">
              {errors.map((e) => (
                <Alert key={e.id}>{e.text}</Alert>
              ))}
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
                <SortableContext items={ids.ids} strategy={rectSortingStrategy}>
                  <ul className="grid grid-cols-3 gap-2 @lg:grid-cols-6">
                    {value.map((src, i) => {
                      const id = ids.ids[i] as string
                      return (
                        <Tile
                          key={id}
                          id={id}
                          index={i}
                          src={typeof src === 'string' ? src : ''}
                          readOnly={readOnly}
                          selecting={selecting}
                          checked={checked.has(id)}
                          menuOpen={menu === id}
                          isFirst={i === 0}
                          isLast={i === value.length - 1}
                          onClick={() =>
                            selecting ? toggle(id) : setMenu(menu === id ? null : id)
                          }
                          onCloseMenu={() => setMenu(null)}
                          onReplace={() => setPicking(i)}
                          onRemove={() => removeAt(i)}
                          onMoveStart={() => moveTo(i, 0)}
                          onMoveEnd={() => moveTo(i, value.length - 1)}
                        />
                      )
                    })}
                    {pending > 0 && (
                      <li
                        className={cn(
                          tileBox,
                          'flex flex-col items-center justify-center gap-1 bg-stone-50 text-xs text-stone-600',
                        )}
                      >
                        <Spinner className="size-5" />
                        {t('media.uploading')}
                      </li>
                    )}
                    {!readOnly && !selecting && (
                      <li className={tileBox}>
                        <button
                          type="button"
                          disabled={!canAdd}
                          onClick={() => setPicking('add')}
                          className="flex size-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-stone-300 text-sm text-stone-600 hover:border-brand-600 hover:bg-brand-50 hover:text-brand-800 disabled:pointer-events-none disabled:opacity-60"
                        >
                          {full ? (
                            <span className="px-2 text-center text-xs">
                              {t('media.full', { max })}
                            </span>
                          ) : (
                            <>
                              <Plus className="size-5" />
                              {t('media.add')}
                            </>
                          )}
                        </button>
                      </li>
                    )}
                  </ul>
                </SortableContext>
              </DndContext>
            </div>
          </>
        )}
      </DropZone>
      <MediaPicker
        siteId={siteId}
        kind="image"
        multiple
        current={srcs}
        open={picking === 'add'}
        onClose={() => setPicking(null)}
        onSelectMany={append}
      />
      <MediaPicker
        siteId={siteId}
        kind="image"
        open={typeof picking === 'number'}
        onClose={() => setPicking(null)}
        onSelect={(src) => {
          const at = picking
          if (typeof at === 'number') onChange(value.map((v, j) => (j === at ? src : v)))
        }}
      />
    </>
  )
}

function Tile({
  id,
  index,
  src,
  readOnly,
  selecting,
  checked,
  menuOpen,
  isFirst,
  isLast,
  onClick,
  onCloseMenu,
  onReplace,
  onRemove,
  onMoveStart,
  onMoveEnd,
}: {
  id: string
  index: number
  src: string
  readOnly: boolean
  selecting: boolean
  checked: boolean
  menuOpen: boolean
  isFirst: boolean
  isLast: boolean
  onClick: () => void
  onCloseMenu: () => void
  onReplace: () => void
  onRemove: () => void
  onMoveStart: () => void
  onMoveEnd: () => void
}) {
  const { t } = useTranslation()
  const { siteId } = useEditor()
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: readOnly || selecting || menuOpen })
  const preview = src ? previewUrl(src, siteId, 400) : null
  const name = src.split(/[?#]/)[0]?.split('/').pop() || t('media.photo', { n: index + 1 })
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (menuOpen) menuRef.current?.querySelector('button')?.focus()
  }, [menuOpen])

  const image = preview ? (
    <img src={preview} alt="" loading="lazy" className="size-full object-cover" />
  ) : (
    <span className="block size-full bg-stone-200" />
  )
  const item = (action: () => void) => () => {
    onCloseMenu()
    action()
  }
  const menuItem = 'block w-full px-3 py-1.5 text-left text-sm hover:bg-stone-100'

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group relative', isDragging && 'z-10 opacity-80 shadow-lg')}
      {...listeners}
    >
      {readOnly ? (
        <div className={cn(tileBox, 'bg-stone-100')} title={name}>
          {image}
        </div>
      ) : (
        <button
          type="button"
          onClick={onClick}
          title={name}
          aria-label={name}
          aria-pressed={selecting ? checked : undefined}
          aria-haspopup={selecting ? undefined : 'menu'}
          aria-expanded={selecting ? undefined : menuOpen}
          className={cn(
            tileBox,
            'block w-full bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
            checked && 'ring-2 ring-brand-600 ring-offset-2',
          )}
        >
          {image}
        </button>
      )}
      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-xs font-medium text-white">
        {index + 1}
      </span>
      {selecting && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1 left-1 flex size-5 items-center justify-center rounded border shadow',
            checked ? 'border-brand-700 bg-brand-700 text-white' : 'border-stone-300 bg-white/90',
          )}
        >
          {checked && <Check className="size-3.5" />}
        </span>
      )}
      {!readOnly && !selecting && (
        <>
          <button
            type="button"
            ref={setActivatorNodeRef}
            className="absolute top-1 left-1 cursor-grab touch-none rounded-md bg-white/90 p-0.5 text-stone-600 opacity-0 shadow group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
            title={t('media.reorder')}
            {...attributes}
            aria-label={t('media.reorder')}
          >
            <GripVertical className="size-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="absolute top-1 right-1 rounded-md bg-white/90 p-0.5 text-stone-600 opacity-0 shadow group-hover:opacity-100 hover:text-red-700 focus-visible:opacity-100"
            title={t('media.remove')}
            aria-label={t('media.remove')}
          >
            <X className="size-4" />
          </button>
        </>
      )}
      {menuOpen && (
        <>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            className="fixed inset-0 z-20 cursor-default"
            onClick={onCloseMenu}
          />
          <div
            ref={menuRef}
            role="menu"
            aria-label={t('media.actions')}
            tabIndex={-1}
            onKeyDown={(e) => e.key === 'Escape' && onCloseMenu()}
            className="absolute top-full left-0 z-30 mt-1 min-w-40 rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
          >
            <button type="button" role="menuitem" className={menuItem} onClick={item(onReplace)}>
              {t('media.replace')}
            </button>
            <button
              type="button"
              role="menuitem"
              className={cn(menuItem, 'text-red-700')}
              onClick={item(onRemove)}
            >
              {t('media.remove')}
            </button>
            {!isFirst && (
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                onClick={item(onMoveStart)}
              >
                {t('media.moveStart')}
              </button>
            )}
            {!isLast && (
              <button type="button" role="menuitem" className={menuItem} onClick={item(onMoveEnd)}>
                {t('media.moveEnd')}
              </button>
            )}
          </div>
        </>
      )}
    </li>
  )
}
