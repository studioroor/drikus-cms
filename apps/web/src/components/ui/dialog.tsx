import { X } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/** Modal built on the native <dialog> element (focus trap and Esc for free). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const { t } = useTranslation()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

  return (
    // Clicking the backdrop closes the dialog; keyboard users get Esc from <dialog> itself.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc is handled natively by <dialog>
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-[calc(100%-2rem)] rounded-2xl bg-white p-0 shadow-xl ${size === 'lg' ? 'max-w-3xl' : 'max-w-lg'}`}
    >
      {open && (
        <div>
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-stone-500 hover:bg-stone-100"
              aria-label={t('common.close')}
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-stone-200 px-5 py-3">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  )
}
