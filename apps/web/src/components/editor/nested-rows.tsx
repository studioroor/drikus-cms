import { Plus } from 'lucide-react'
import { useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import type { Data, FieldDef } from '@/lib/content'
import { move } from '@/lib/list'
import { useEditor } from './context'
import { BlockPicker } from './fields'
import { ItemIndex } from './item-index'
import { useListIds } from './list-ids'
import { ListNavContext } from './list-nav'

type Block = NonNullable<FieldDef['blocks']>[number]

/**
 * A list inside the item open in a list editor's pane: compact rows that drill in, so only
 * one level of forms is ever visible.
 */
export function NestedRows({
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
  const nav = useContext(ListNavContext)
  const ids = useListIds(path, value.length)
  const [picking, setPicking] = useState(false)
  const full = field.maxItems !== undefined && value.length >= field.maxItems

  const open = (i: number) => nav?.select(`${path}.${i}`, 'push')
  const append = (item: unknown) => {
    ids.insert(value.length)
    onChange([...value, item])
    open(value.length)
  }
  const add = () => (field.type === 'blocks' ? setPicking(true) : append({}))
  const addBlock = (block: Block) => {
    const initial: Data = { [field.typeKey]: block.name }
    for (const f of block.fields) if (f.default !== undefined) initial[f.name] = f.default
    setPicking(false)
    append(initial)
  }
  const moveItem = (from: number, to: number) => {
    ids.move(from, to)
    onChange(move(value, from, to))
  }

  return (
    <div className="space-y-2 rounded-xl border border-stone-200 bg-stone-50/60 p-2">
      {value.length === 0 ? (
        <p className="px-2 py-1 text-sm text-stone-500">{t('editor.noItems')}</p>
      ) : (
        <ItemIndex
          field={field}
          value={value}
          listPath={path}
          ids={ids.ids}
          selectedIndex={null}
          onSelect={open}
          onMove={moveItem}
          search=""
          size="sm"
        />
      )}
      {!readOnly && !full && (
        <Button size="sm" variant="ghost" onClick={add}>
          <Plus className="size-4" />{' '}
          {field.type === 'blocks' ? t('editor.addBlock') : t('editor.add')}
        </Button>
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
    </div>
  )
}
