import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

const RETRY_MS = 3000

/**
 * Debounced, ordered autosave: at most one request in flight, the latest value
 * always wins, failures retry, and pending changes are flushed on unmount.
 */
export function useAutosave<T, R>(
  save: (value: T) => Promise<R>,
  { delay = 800, onSaved }: { delay?: number; onSaved?: (result: R) => void } = {},
) {
  const [state, setState] = useState<SaveState>('idle')
  const pending = useRef<{ value: T } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inFlight = useRef(false)
  const saveRef = useRef(save)
  const onSavedRef = useRef(onSaved)
  saveRef.current = save
  onSavedRef.current = onSaved

  const run = useCallback(async () => {
    clearTimeout(timer.current)
    if (inFlight.current || !pending.current) return
    const { value } = pending.current
    pending.current = null
    inFlight.current = true
    setState('saving')
    try {
      const result = await saveRef.current(value)
      onSavedRef.current?.(result)
      setState(pending.current ? 'pending' : 'saved')
    } catch {
      // Keep the newest value: either something typed meanwhile, or this one.
      pending.current ??= { value }
      setState('error')
      timer.current = setTimeout(() => {
        timer.current = undefined
        void run()
      }, RETRY_MS)
    } finally {
      inFlight.current = false
    }
    if (pending.current && timer.current === undefined) void run()
  }, [])

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value }
      setState('pending')
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = undefined
        void run()
      }, delay)
    },
    [delay, run],
  )

  /** Drops unsaved changes (e.g. before discarding the draft). */
  const cancel = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = undefined
    pending.current = null
    setState('idle')
  }, [])

  const flush = useCallback(() => {
    timer.current = undefined
    return run()
  }, [run])

  // Save what's left when leaving the page, and warn when closing the tab mid-save.
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current || inFlight.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      if (pending.current) void flush()
    }
  }, [flush])

  return { state, schedule, cancel, flush }
}
