import { createContext } from 'react'

/**
 * Provided around a list editor's pane: lists inside the selected item render as rows that
 * drill in through `select` instead of opening a second list editor.
 */
export const ListNavContext = createContext<{
  /** With `focus`, the item's first input is focused once its form shows. */
  select(path: string | null, mode: 'push' | 'replace', options?: { focus?: boolean }): void
  /** Call after reordering the list at `listPath`, so state that points into its items is dropped. */
  moved(listPath: string): void
} | null>(null)
