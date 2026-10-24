import { createContext, type ReactNode, useContext, useRef } from 'react'
import {
  insertedIndex,
  insertId,
  movedIndex,
  moveIds,
  reconcileIds,
  rekeyPaths,
  removedIndex,
  removeId,
} from '@/lib/list'

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

/** Re-keys what's stored for lists inside the items of `path`, so it follows the items. */
function rekey(store: Store, path: string, remap: (i: number) => number | null) {
  for (const map of [store.ids, store.modes] as Map<string, unknown>[]) {
    const next = rekeyPaths(map, path, remap)
    map.clear()
    for (const [k, v] of next) map.set(k, v)
  }
}

function listIds(store: Store, path: string, length: number) {
  const ids = reconcileIds(store.ids.get(path) ?? [], length)
  store.ids.set(path, ids)
  return {
    ids,
    insert: (at: number) => {
      rekey(store, path, insertedIndex(at))
      store.ids.set(path, insertId(ids, at))
    },
    remove: (at: number) => {
      rekey(store, path, removedIndex(at))
      store.ids.set(path, removeId(ids, at))
    },
    move: (from: number, to: number) => {
      rekey(store, path, movedIndex(from, to))
      store.ids.set(path, moveIds(ids, from, to))
    },
  }
}

/**
 * Call `insert`/`remove`/`move` in the same handler as the list's matching `onChange`.
 * They also move the ids and modes of lists nested in the items along with the items.
 */
export function useListIds(path: string, length: number) {
  return listIds(useStore(), path, length)
}

/** Like `useListIds`, for lists whose path is only known in a handler. */
export function useListIdsFor() {
  const store = useStore()
  return (path: string, length: number) => listIds(store, path, length)
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
