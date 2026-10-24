import { createContext, useContext } from 'react'

export interface EditorContextValue {
  siteId: string
  siteUrl: string | null
  /** Paths of required fields that are still empty, e.g. "sections.0.heading". */
  missing: Set<string>
  readOnly: boolean
}

export const EditorContext = createContext<EditorContextValue>({
  siteId: '',
  siteUrl: null,
  missing: new Set(),
  readOnly: false,
})

export const useEditor = () => useContext(EditorContext)
