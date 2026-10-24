import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/feedback'
import type { EntryStatus } from '@/lib/content'

export function StatusBadge({ status }: { status: EntryStatus }) {
  const { t } = useTranslation()
  if (status === 'published') return null
  const tone = status === 'deleted' ? 'red' : status === 'new' ? 'brand' : 'amber'
  return <Badge tone={tone}>{t(`editor.status.${status}`)}</Badge>
}

export interface Crumb {
  label: string
  to?: string
  params?: Record<string, string>
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1 text-sm text-stone-500">
      {items.map((item, i) => (
        <Fragment key={`${item.to ?? ''}:${item.label}`}>
          {i > 0 && <ChevronRight className="size-3.5 text-stone-400" />}
          {item.to ? (
            <Link to={item.to} params={item.params} className="hover:text-stone-900">
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
