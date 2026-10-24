import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Layers, Plus, Search } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Breadcrumbs, StatusBadge } from '@/components/editor/status'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import { Input, Select } from '@/components/ui/field'
import { cn } from '@/lib/cn'
import {
  formatValue,
  PAGE_SIZE,
  paginate,
  type SortDir,
  sortEntries,
  sortOptions,
} from '@/lib/collection-view'
import { entriesQuery, useLabel } from '@/lib/content'
import { PageHeader } from './app-layout'
import { MissingCollection, siteQuery, useSiteCollection } from './site'

const storageKey = (siteId: string, collection: string) => `drikus.sort.${siteId}.${collection}`

function storedSort(siteId: string, collection: string): { sort?: string; dir?: SortDir } {
  try {
    const raw = localStorage.getItem(storageKey(siteId, collection))
    const parsed = raw ? JSON.parse(raw) : null
    return {
      sort: typeof parsed?.sort === 'string' ? parsed.sort : undefined,
      dir: parsed?.dir === 'asc' || parsed?.dir === 'desc' ? parsed.dir : undefined,
    }
  } catch {
    return {}
  }
}

function saveSort(siteId: string, collection: string, sort: string, dir: SortDir) {
  try {
    localStorage.setItem(storageKey(siteId, collection), JSON.stringify({ sort, dir }))
  } catch {
    // Storage is only a convenience; the URL still holds the choice.
  }
}

export function CollectionPage() {
  const { t } = useTranslation()
  const label = useLabel()
  const { siteId, collection: name } = useParams({ from: '/app/sites/$siteId/$collection' })
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { collection } = useSiteCollection(siteId, name)
  const { data: entries } = useSuspenseQuery(entriesQuery(siteId, name))
  const [search, setSearch] = useState('')
  const navigate = useNavigate()
  const urlSearch = useSearch({ from: '/app/sites/$siteId/$collection' })
  if (!collection) return <MissingCollection />

  const options = sortOptions(collection)
  const stored = storedSort(siteId, name)
  const known = (key: string | undefined) => (options.some((o) => o.key === key) ? key : undefined)
  const sortKey =
    known(urlSearch.sort) ?? known(stored.sort) ?? known(collection.sortBy ?? undefined) ?? 'title'
  const sortDir: SortDir =
    urlSearch.dir ??
    (urlSearch.sort || !stored.dir
      ? sortKey === collection.sortBy
        ? collection.sortOrder
        : 'asc'
      : stored.dir)

  const update = (next: { page?: number; sort?: string; dir?: SortDir }, scroll = false) => {
    void navigate({
      to: '.',
      search: (s) => ({ ...s, ...next }),
      replace: true,
      resetScroll: scroll,
    })
  }
  const changeSort = (sort: string, dir: SortDir) => {
    saveSort(siteId, name, sort, dir)
    update({ sort, dir, page: undefined })
  }

  const term = search.trim().toLowerCase()
  const matching = term
    ? entries.filter((e) => `${e.title ?? ''} ${e.slug}`.toLowerCase().includes(term))
    : entries
  const sorted = sortEntries(matching, sortKey, sortDir)
  const paged = paginate(sorted, urlSearch.page ?? 1)
  const shown = paged.items
  const showValue = sortKey !== 'title'
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
          <div className="flex flex-wrap items-center gap-2 border-b border-stone-200 p-3">
            <div className="relative min-w-48 flex-1">
              <Search className="absolute top-3.5 left-3 size-4 text-stone-400" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  if (urlSearch.page) update({ page: undefined })
                }}
                placeholder={t('editor.search')}
                aria-label={t('editor.search')}
                className="pl-9"
              />
            </div>
            <Select
              value={sortKey}
              onChange={(e) => changeSort(e.target.value, sortDir)}
              aria-label={t('collection.sort')}
              className="w-auto max-w-56"
            >
              {options.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.key === 'title' ? t('collection.sortTitle') : label(o.label, o.key)}
                </option>
              ))}
            </Select>
            <button
              type="button"
              onClick={() => changeSort(sortKey, sortDir === 'asc' ? 'desc' : 'asc')}
              aria-label={
                sortDir === 'asc' ? t('collection.ascending') : t('collection.descending')
              }
              title={sortDir === 'asc' ? t('collection.ascending') : t('collection.descending')}
              className="inline-flex size-11 items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-600 shadow-sm hover:bg-stone-50"
            >
              {sortDir === 'asc' ? (
                <ArrowUp className="size-4" />
              ) : (
                <ArrowDown className="size-4" />
              )}
            </button>
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
                  {showValue && (
                    <span className="shrink-0 text-sm text-stone-500">
                      {formatValue(e.values[sortKey])}
                    </span>
                  )}
                  <StatusBadge status={e.status} />
                  <ChevronRight className="size-4 shrink-0 text-stone-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {matching.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 border-t border-stone-200 px-5 py-3 text-sm text-stone-600">
            <span>
              {t('collection.range', { from: paged.from, to: paged.to, total: matching.length })}
            </span>
            <div className="flex gap-2">
              <PageButton
                disabled={paged.page <= 1}
                label={t('collection.previous')}
                onClick={() => update({ page: paged.page - 1 || undefined }, true)}
              >
                <ChevronLeft className="size-4" />
              </PageButton>
              <PageButton
                disabled={paged.page >= paged.pages}
                label={t('collection.next')}
                onClick={() => update({ page: paged.page + 1 }, true)}
              >
                <ChevronRight className="size-4" />
              </PageButton>
            </div>
          </div>
        )}
      </Card>
    </>
  )
}

function PageButton({
  disabled,
  label,
  onClick,
  children,
}: {
  disabled: boolean
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex size-9 items-center justify-center rounded-lg border border-stone-300 bg-white text-stone-600 hover:bg-stone-50 disabled:opacity-40"
    >
      {children}
    </button>
  )
}
