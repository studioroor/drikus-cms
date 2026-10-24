import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/feedback'
import { cn } from '@/lib/cn'
import type { EntryStatus, LocaleState } from '@/lib/content'

export function StatusBadge({ status }: { status: EntryStatus }) {
  const { t } = useTranslation()
  if (status === 'published') return null
  const tone =
    status === 'deleted'
      ? 'red'
      : status === 'new'
        ? 'brand'
        : status === 'missing'
          ? 'neutral'
          : 'amber'
  return <Badge tone={tone}>{t(`editor.status.${status}`)}</Badge>
}

/** "Dutch", "English", … for a content language code, in the UI language. */
export function useLanguageName() {
  const { i18n } = useTranslation()
  let names: Intl.DisplayNames | null = null
  try {
    names = new Intl.DisplayNames([i18n.language], { type: 'language' })
  } catch {}
  return (code: string) => {
    const name = names?.of(code)
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : code.toUpperCase()
  }
}

export const statusDot: Record<EntryStatus, string> = {
  published: 'bg-emerald-500',
  new: 'bg-brand-600',
  modified: 'bg-amber-500',
  deleted: 'bg-red-500',
  missing: 'border border-stone-400 bg-transparent',
}

/** Compact per-language status: "NL ● EN ○". */
export function LocaleDots({ locales }: { locales: LocaleState[] }) {
  const { t } = useTranslation()
  const languageName = useLanguageName()
  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      {locales.map((l) => (
        <span
          key={l.code}
          title={`${languageName(l.code)}: ${t(`editor.status.${l.status}`)}`}
          className={cn(
            'inline-flex items-center gap-1 text-xs font-medium uppercase',
            l.status === 'missing' ? 'text-stone-400' : 'text-stone-600',
          )}
        >
          {l.code}
          <span className={cn('size-2 rounded-full', statusDot[l.status])} />
        </span>
      ))}
    </span>
  )
}

/** A small language code next to a change, for translated content. */
export function LocaleTag({ locale }: { locale: string | null | undefined }) {
  const languageName = useLanguageName()
  if (!locale) return null
  return (
    <span
      title={languageName(locale)}
      className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-600 uppercase"
    >
      {locale}
    </span>
  )
}

export interface Crumb {
  label: string
  to?: string
  params?: Record<string, string>
  search?: Record<string, string>
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-stone-500">
      {items.map((item, i) => (
        <Fragment key={`${item.to ?? ''}:${item.label}`}>
          {i > 0 && <ChevronRight className="size-3.5 text-stone-400" />}
          {item.to ? (
            <Link
              to={item.to}
              params={item.params}
              search={item.search}
              className="hover:text-stone-900"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-stone-700">{item.label}</span>
          )}
        </Fragment>
      ))}
    </nav>
  )
}
