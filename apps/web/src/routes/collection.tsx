import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { ChevronRight, Layers, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Breadcrumbs, LocaleDots, StatusBadge } from '@/components/editor/status'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import { Input } from '@/components/ui/field'
import { cn } from '@/lib/cn'
import { entriesQuery, useLabel } from '@/lib/content'
import { PageHeader } from './app-layout'
import { MissingCollection, siteQuery, useSiteCollection } from './site'

export function CollectionPage() {
  const { t } = useTranslation()
  const label = useLabel()
  const { siteId, collection: name } = useParams({ from: '/app/sites/$siteId/$collection' })
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { collection } = useSiteCollection(siteId, name)
  const { data: entries } = useSuspenseQuery(entriesQuery(siteId, name))
  const [search, setSearch] = useState('')
  if (!collection) return <MissingCollection />

  const term = search.trim().toLowerCase()
  const shown = term
    ? entries.filter((e) => `${e.title ?? ''} ${e.slug}`.toLowerCase().includes(term))
    : entries
  const title = label(collection.label, collection.name)

  return (
    <>
      <Breadcrumbs
        items={[
          { label: t('nav.websites'), to: '/' },
          { label: site.name, to: '/sites/$siteId', params: { siteId } },
          { label: title },
        ]}
      />
      <PageHeader
        title={title}
        subtitle={collection.description ? label(collection.description) : undefined}
        actions={
          collection.create && (
            <Link
              to="/sites/$siteId/$collection/new"
              params={{ siteId, collection: name }}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-800"
            >
              <Plus className="size-4" />
              {t('editor.newEntry')}
            </Link>
          )
        }
      />
      <Card>
        {entries.length > 6 && (
          <div className="border-b border-stone-200 p-3">
            <div className="relative">
              <Search className="absolute top-3.5 left-3 size-4 text-stone-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('editor.search')}
                aria-label={t('editor.search')}
                className="pl-9"
              />
            </div>
          </div>
        )}
        {shown.length === 0 ? (
          <EmptyState
            icon={<Layers className="size-6" />}
            title={entries.length ? t('editor.noResults') : t('editor.empty')}
          />
        ) : (
          <ul className="divide-y divide-stone-200">
            {shown.map((e) => (
              <li key={e.slug}>
                <Link
                  to="/sites/$siteId/$collection/edit/$slug"
                  params={{ siteId, collection: name, slug: e.slug }}
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-stone-50"
                >
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate font-medium',
                      e.status === 'deleted' && 'text-stone-400 line-through',
                      !e.title && 'text-stone-500 italic',
                    )}
                  >
                    {e.title ?? (e.invalid ? t('editor.unreadable') : t('editor.untitled'))}
                  </span>
                  {e.locales ? (
                    <LocaleDots locales={e.locales} />
                  ) : (
                    <StatusBadge status={e.status} />
                  )}
                  <ChevronRight className="size-4 shrink-0 text-stone-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
