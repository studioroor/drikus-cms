import { createContext, type ReactNode, useContext, useRef } from 'react'
import { insertId, moveIds, reconcileIds, removeId } from '@/lib/list'

/**
 * Stable ids for the items of every list in a form, by list path. They are React keys,
 * selection and drag handles; they never end up in the content.
 */
type ListMode = 'inline' | 'editor'
type Store = { ids: Map<string, string[]>; modes: Map<string, ListMode> }

const newStore = (): Store => ({ ids: new Map(), modes: new Map() })
const ListIdsContext = createContext<Store | null>(null)

export function ListIdsProvider({ children }: { children: ReactNode }) {
  const store = useRef<Store>(newStore())
  return <ListIdsContext.Provider value={store.current}>{children}</ListIdsContext.Provider>
}

function useStore(): Store {
  const shared = useContext(ListIdsContext)
  const local = useRef<Store | null>(null)
  if (shared) return shared
  local.current ??= newStore()
  return local.current
}

/** Call `insert`/`remove`/`move` in the same handler as the list's matching `onChange`. */
export function useListIds(path: string, length: number) {
  const store = useStore().ids
  const ids = reconcileIds(store.get(path) ?? [], length)
  store.set(path, ids)
  return {
    ids,
    insert: (at: number) => void store.set(path, insertId(ids, at)),
    remove: (at: number) => void store.set(path, removeId(ids, at)),
    move: (from: number, to: number) => void store.set(path, moveIds(ids, from, to)),
  }
}

/**
 * Whether a list renders inline or in the list editor, decided the first time the path
 * renders and kept for the form's lifetime, so adding or removing items never swaps the
 * layout (and its selection or Undo) out from under the editor.
 */
export function useListMode(path: string, initial: ListMode): ListMode {
  const store = useStore().modes
  const mode = store.get(path)
  if (mode) return mode
  store.set(path, initial)
  return initial
}
