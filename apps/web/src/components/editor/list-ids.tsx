import { createContext, type ReactNode, useContext, useRef } from 'react'
import { insertId, moveIds, reconcileIds, removeId } from '@/lib/list'

/**
 * Stable ids for the items of every list in a form, by list path. They are React keys,
 * selection and drag handles; they never end up in the content.
 */
const ListIdsContext = createContext<Map<string, string[]> | null>(null)

export function ListIdsProvider({ children }: { children: ReactNode }) {
  const ids = useRef(new Map<string, string[]>())
  return <ListIdsContext.Provider value={ids.current}>{children}</ListIdsContext.Provider>
}

/** Call `insert`/`remove`/`move` in the same handler as the list's matching `onChange`. */
export function useListIds(path: string, length: number) {
  const shared = useContext(ListIdsContext)
  const local = useRef(new Map<string, string[]>())
  const store = shared ?? local.current
  const ids = reconcileIds(store.get(path) ?? [], length)
  store.set(path, ids)
  return {
    ids,
    insert: (at: number) => void store.set(path, insertId(ids, at)),
    remove: (at: number) => void store.set(path, removeId(ids, at)),
    move: (from: number, to: number) => void store.set(path, moveIds(ids, from, to)),
  }
}
