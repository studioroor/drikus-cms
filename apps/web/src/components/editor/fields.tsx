import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { lazy, type ReactNode, Suspense, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { cn } from '@/lib/cn'
import { type Data, entriesQuery, type FieldDef, useLabel } from '@/lib/content'
import { asObject, isInlineList, itemTitle, move, usesListEditor } from '@/lib/list'
import { useEditor } from './context'
import { ListEditor } from './list-editor'
import { useListIds, useListMode } from './list-ids'
import { MediaField } from './media'

// Tiptap is large: load it only when a rich text field is on screen.
const RichTextEditor = lazy(() =>
  import('./rich-text').then((m) => ({ default: m.RichTextEditor })),
)

type Block = NonNullable<FieldDef['blocks']>[number]

const textarea =
  'block w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:bg-stone-100'

const asString = (v: unknown) =>
  typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** All fields of an object (entry, group, list item or block). */
export function FieldList({
  fields,
  value,
  onChange,
  path = '',
}: {
  fields: FieldDef[]
  value: Data
  onChange: (value: Data) => void
  path?: string
}) {
  return (
    <div className="space-y-6">
      {fields
        .filter((f) => f.type !== 'hidden')
        .map((field) => (
          <FieldRow
            key={field.name}
            field={field}
            value={value[field.name]}
            path={path ? `${path}.${field.name}` : field.name}
            onChange={(v) => onChange({ ...value, [field.name]: v })}
          />
        ))}
    </div>
  )
}

function FieldRow({
  field,
  value,
  path,
  onChange,
}: {
  field: FieldDef
  value: unknown
  path: string
  onChange: (value: unknown) => void
}) {
  const id = useId()
  const { t } = useTranslation()
  const label = useLabel()
  const { missing } = useEditor()
  const isGroup = field.type === 'object' || field.type === 'list' || field.type === 'blocks'
  const isMissing = missing.has(path)
  // The list editor's toolbar carries the label itself.
  const inListEditor = useListMode(path, initialMode(field, value)) === 'editor'

  const heading = (
    <span className="flex items-baseline gap-2">
      <span className="text-sm font-medium text-stone-800">{label(field.label, field.name)}</span>
      {field.required && <span className="text-xs text-stone-400">{t('editor.required')}</span>}
    </span>
  )
  return (
    <div className="space-y-1.5" data-field={path}>
      {field.type === 'boolean' || inListEditor ? null : isGroup ? (
        <div>{heading}</div>
      ) : (
        <label htmlFor={id} className="block">
          {heading}
        </label>
      )}
      {field.hint && <p className="text-sm text-stone-500">{label(field.hint)}</p>}
      <FieldInput id={id} field={field} value={value} path={path} onChange={onChange} />
      {isMissing && <p className="text-sm text-amber-700">{t('editor.missing')}</p>}
    </div>
  )
}

export function FieldInput({
  id,
  field,
  value,
  path,
  onChange,
}: {
  id: string
  field: FieldDef
  value: unknown
  path: string
  onChange: (value: unknown) => void
}) {
  const label = useLabel()
  const { readOnly, siteId } = useEditor()
  const text = asString(value)
  const setText = (v: string) => onChange(v === '' && !field.required ? undefined : v)

  switch (field.type) {
    case 'string':
    case 'url':
      return (
        <Input
          id={id}
          type={field.type === 'url' ? 'url' : 'text'}
          value={text}
          maxLength={field.maxLength}
          disabled={readOnly}
          onChange={(e) => setText(e.target.value)}
        />
      )
    case 'text':
    case 'markdown':
      return (
        <textarea
          id={id}
          value={text}
          rows={field.type === 'markdown' ? 14 : 4}
          maxLength={field.maxLength}
          disabled={readOnly}
          onChange={(e) => setText(e.target.value)}
          className={cn(textarea, field.type === 'markdown' && 'font-mono text-sm')}
        />
      )
    case 'richtext':
      return (
        <Suspense
          fallback={
            <div className="h-48 animate-pulse rounded-lg border border-stone-200 bg-stone-50" />
          }
        >
          <RichTextEditor
            id={id}
            value={text}
            onChange={setText}
            readOnly={readOnly}
            siteId={siteId}
            imageStyles={(field.imageStyles ?? []).map((s) =>
              typeof s === 'string'
                ? { value: s, label: s }
                : { value: s.value, label: label(s.label, s.value) },
            )}
          />
        </Suspense>
      )
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          className="max-w-48"
          value={typeof value === 'number' ? value : ''}
          min={field.min}
          max={field.max}
          step={field.step ?? 'any'}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )
    case 'boolean':
      return (
        <label className="inline-flex cursor-pointer items-center gap-3">
          <input
            id={id}
            type="checkbox"
            role="switch"
            aria-checked={value === true}
            checked={value === true}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.checked)}
            className="peer sr-only"
          />
          <span className="relative h-6 w-11 rounded-full bg-stone-300 transition-colors peer-checked:bg-brand-700 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-600 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
          <span className="text-sm font-medium text-stone-800">
            {label(field.label, field.name)}
          </span>
        </label>
      )
    case 'date':
      return (
        <Input
          id={id}
          type="date"
          className="max-w-56"
          value={text}
          disabled={readOnly}
          onChange={(e) => setText(e.target.value)}
        />
      )
    case 'datetime':
      return (
        <Input
          id={id}
          type="datetime-local"
          className="max-w-64"
          value={text.slice(0, 16)}
          disabled={readOnly}
          onChange={(e) => setText(e.target.value)}
        />
      )
    case 'color':
      return (
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={label(field.label, field.name)}
            value={/^#[0-9a-f]{6}$/i.test(text) ? text : '#000000'}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.value)}
            className="h-11 w-14 cursor-pointer rounded-lg border border-stone-300 bg-white p-1"
          />
          <Input
            id={id}
            className="max-w-40 font-mono"
            value={text}
            placeholder="#"
            disabled={readOnly}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      )
    case 'select':
      return <SelectInput id={id} field={field} value={value} onChange={onChange} />
    case 'reference':
      return <ReferenceInput id={id} field={field} value={value} onChange={onChange} />
    case 'image':
    case 'file':
      return (
        <MediaField
          id={id}
          siteId={siteId}
          kind={field.type}
          value={text}
          readOnly={readOnly}
          onChange={setText}
        />
      )
    case 'object':
      return (
        <Group>
          <FieldList
            fields={field.fields ?? []}
            value={asObject(value)}
            path={path}
            onChange={onChange}
          />
        </Group>
      )
    case 'list':
    case 'blocks':
      return <ListField field={field} value={asArray(value)} path={path} onChange={onChange} />
    case 'hidden':
      return null
  }
}

const initialMode = (field: FieldDef, value: unknown) =>
  usesListEditor(field) && !isInlineList(field, asArray(value)) ? 'editor' : 'inline'

function ListField({
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
  return useListMode(path, initialMode(field, value)) === 'editor' ? (
    <ListEditor field={field} value={value} path={path} onChange={onChange} />
  ) : (
    <ListInput field={field} value={value} path={path} onChange={onChange} />
  )
}

function Group({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">{children}</div>
}

function optionList(field: FieldDef) {
  return (field.options ?? []).map((o) =>
    typeof o === 'object' ? { value: o.value, label: o.label } : { value: o, label: String(o) },
  )
}

function SelectInput({
  id,
  field,
  value,
  onChange,
}: {
  id: string
  field: FieldDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  const { t } = useTranslation()
  const label = useLabel()
  const { readOnly } = useEditor()
  const options = optionList(field)
  if (field.multiple) {
    const selected = asArray(value)
    return (
      <div id={id} className="flex flex-wrap gap-x-5 gap-y-2">
        {options.map((o) => (
          <label
            key={String(o.value)}
            className="inline-flex cursor-pointer items-center gap-2 text-sm"
          >
            <input
              type="checkbox"
              className="size-4 accent-brand-700"
              disabled={readOnly}
              checked={selected.includes(o.value)}
              onChange={(e) =>
                onChange(
                  e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value),
                )
              }
            />
            {label(o.label)}
          </label>
        ))}
      </div>
    )
  }
  const index = options.findIndex((o) => o.value === value)
  return (
    <Select
      id={id}
      className="max-w-md"
      value={index === -1 ? '' : String(index)}
      disabled={readOnly}
      onChange={(e) =>
        onChange(e.target.value === '' ? undefined : options[Number(e.target.value)]?.value)
      }
    >
      <option value="">{t('editor.choose')}</option>
      {options.map((o, i) => (
        <option key={String(o.value)} value={i}>
          {label(o.label)}
        </option>
      ))}
    </Select>
  )
}

function ReferenceInput({
  id,
  field,
  value,
  onChange,
}: {
  id: string
  field: FieldDef
  value: unknown
  onChange: (v: unknown) => void
}) {
  const { t } = useTranslation()
  const { siteId, readOnly } = useEditor()
  const entries = useQuery({
    ...entriesQuery(siteId, field.collection ?? ''),
    enabled: !!field.collection,
  })
  const options = (entries.data ?? []).filter((e) => e.status !== 'deleted')
  if (field.multiple) {
    const selected = asArray(value)
    return (
      <div
        id={id}
        className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-stone-200 bg-white p-2"
      >
        {options.map((e) => (
          <label
            key={e.slug}
            className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-stone-50"
          >
            <input
              type="checkbox"
              className="size-4 accent-brand-700"
              disabled={readOnly}
              checked={selected.includes(e.slug)}
              onChange={(ev) =>
                onChange(
                  ev.target.checked ? [...selected, e.slug] : selected.filter((s) => s !== e.slug),
                )
              }
            />
            {e.title ?? e.slug}
          </label>
        ))}
      </div>
    )
  }
  return (
    <Select
      id={id}
      className="max-w-md"
      value={asString(value)}
      disabled={readOnly || entries.isPending}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{t('editor.choose')}</option>
      {options.map((e) => (
        <option key={e.slug} value={e.slug}>
          {e.title ?? e.slug}
        </option>
      ))}
    </Select>
  )
}

function ItemControls({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number
  count: number
  onMove: (to: number) => void
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const { readOnly } = useEditor()
  if (readOnly) return null
  const btn =
    'rounded-md p-1.5 text-stone-500 hover:bg-stone-200 hover:text-stone-900 disabled:opacity-30'
  return (
    <div className="flex items-center">
      <button
        type="button"
        className={btn}
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
        title={t('editor.moveUp')}
        aria-label={t('editor.moveUp')}
      >
        <ChevronUp className="size-4" />
      </button>
      <button
        type="button"
        className={btn}
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
        title={t('editor.moveDown')}
        aria-label={t('editor.moveDown')}
      >
        <ChevronDown className="size-4" />
      </button>
      <button
        type="button"
        className={cn(btn, 'hover:text-red-700')}
        onClick={onRemove}
        title={t('editor.remove')}
        aria-label={t('editor.remove')}
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  )
}

/** A list of single values, or a short list of simple objects, edited in place. */
function ListInput({
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
  const { readOnly } = useEditor()
  const ids = useListIds(path, value.length)
  const full = field.maxItems !== undefined && value.length >= field.maxItems
  const update = (i: number, item: unknown) => onChange(value.map((v, j) => (j === i ? item : v)))
  const add = (item: unknown) => {
    ids.insert(value.length)
    onChange([...value, item])
  }
  const controls = (i: number) => (
    <ItemControls
      index={i}
      count={value.length}
      onMove={(to) => {
        ids.move(i, to)
        onChange(move(value, i, to))
      }}
      onRemove={() => {
        ids.remove(i)
        onChange(value.filter((_, j) => j !== i))
      }}
    />
  )

  if (field.field) {
    // A list of single values.
    const inner = field.field
    return (
      <div className="space-y-2">
        {value.map((item, i) => (
          <div key={ids.ids[i]} className="flex items-start gap-2">
            <div className="flex-1">
              <FieldInput
                id={`${path}.${i}`}
                field={inner}
                value={item}
                path={`${path}.${i}`}
                onChange={(v) => update(i, v)}
              />
            </div>
            {controls(i)}
          </div>
        ))}
        {!readOnly && !full && (
          <Button variant="secondary" size="sm" onClick={() => add(inner.default ?? undefined)}>
            <Plus className="size-4" /> {t('editor.add')}
          </Button>
        )}
      </div>
    )
  }

  const fields = field.fields ?? []
  return (
    <div className="space-y-3">
      {value.map((item, i) => (
        <div key={ids.ids[i]} className="rounded-xl border border-stone-200 bg-white">
          <div className="flex items-center justify-between gap-2 border-b border-stone-100 py-1.5 pr-1.5 pl-4">
            <span className="truncate text-sm font-medium text-stone-700">
              {itemTitle(fields, asObject(item)) ?? t('editor.item', { n: i + 1 })}
            </span>
            {controls(i)}
          </div>
          <div className="p-4">
            <FieldList
              fields={fields}
              value={asObject(item)}
              path={`${path}.${i}`}
              onChange={(v) => update(i, v)}
            />
          </div>
        </div>
      ))}
      {!readOnly && !full && (
        <Button variant="secondary" size="sm" onClick={() => add({})}>
          <Plus className="size-4" /> {t('editor.add')}
        </Button>
      )}
    </div>
  )
}

/** The block types to choose from when adding a block. */
export function BlockPicker({
  blocks,
  onPick,
  onCancel,
}: {
  blocks: Block[]
  onPick: (block: Block) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const label = useLabel()
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {blocks.map((b) => (
        <button
          key={b.name}
          type="button"
          onClick={() => onPick(b)}
          className="rounded-lg border border-stone-200 px-3 py-2.5 text-left hover:border-brand-600 hover:bg-brand-50"
        >
          <span className="block text-sm font-medium">{label(b.label, b.name)}</span>
          {b.hint && <span className="block text-xs text-stone-500">{label(b.hint)}</span>}
        </button>
      ))}
      <Button variant="ghost" size="sm" className="sm:col-span-2" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    </div>
  )
}
