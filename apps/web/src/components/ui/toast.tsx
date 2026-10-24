import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/** A short notice at the bottom of the screen with an optional action, e.g. Undo. */
export function Toast({
  message,
  actionLabel,
  onAction,
  onClose,
  timeoutMs = 8000,
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
  onClose: () => void
  timeoutMs?: number
}) {
  const { t } = useTranslation()
  // The timer starts once; a new toast is a new mount (give it a key).
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const timer = setTimeout(() => close.current(), timeoutMs)
    return () => clearTimeout(timer)
  }, [timeoutMs])

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-xl bg-stone-900 py-2 pr-2 pl-4 text-sm text-white shadow-lg"
    >
      <span className="min-w-0 flex-1 truncate">{message}</span>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={() => {
            onAction()
            onClose()
          }}
          className="rounded-md px-2.5 py-1.5 font-semibold text-brand-100 hover:bg-white/10"
        >
          {actionLabel}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="rounded-md p-1.5 text-stone-400 hover:bg-white/10 hover:text-white"
        aria-label={t('common.close')}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
