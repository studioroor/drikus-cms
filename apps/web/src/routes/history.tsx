import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeft, History, RotateCcw } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorContext } from '@/components/editor/context'
import { FieldInput } from '@/components/editor/fields'
import { Breadcrumbs, useLanguageName } from '@/components/editor/status'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Alert, Badge, EmptyState, Spinner } from '@/components/ui/feedback'
import { Checkbox, Select } from '@/components/ui/field'
import { cn } from '@/lib/cn'
import {
  type CollectionInfo,
  type Data,
  entryQuery,
  type FieldDef,
  type RevisionList,
  restoreRevision,
  revisionQuery,
  revisionsQuery,
  SINGLETON_SLUG,
  useLabel,
  type VersionId,
} from '@/lib/content'
import { useErrorMessage } from '@/lib/queries'
import { PageHeader } from './app-layout'
import { MissingCollection, siteQuery, useSiteCollection } from './site'

const ROUTE = '/app/sites/$siteId/$collection/history/$slug' as const

/** Drops empty values and key order, so "no value" and "" or a trailing newline don't count as a change. */
function normalize(value: unknown): unknown {
  if (typeof value === 'string') return value.trimEnd() || undefined
  if (value === null || value === undefined) return undefined
  if (Array.isArray(value)) return value.length ? value.map(normalize) : undefined
  if (typeof value === 'object') {
    const out: Data = {}
    for (const key of Object.keys(value).sort()) {
      const v = normalize((value as Data)[key])
      if (v !== undefined) out[key] = v
    }
    return Object.keys(out).length ? out : undefined
  }
  return value
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))

interface Version {
  id: VersionId
  title: string
  byline: string | null
  message: string | null
  badge: { tone: 'amber' | 'green' | 'red'; text: string } | null
  /** Whether "restore" makes sense: an earlier commit that still had the file. */
  restorable: boolean
}

function useVersions(list: RevisionList): Version[] {
  const { t, i18n } = useTranslation()
  const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
  const versions: Version[] = []
  if (list.draft) {
    versions.push({
      id: 'draft',
      title: t('history.draft'),
      byline: list.draft.updatedBy
        ? t('history.by', {
            name: list.draft.updatedBy.name,
            date: date.format(list.draft.updatedAt),
          })
        : date.format(list.draft.updatedAt),
      message: null,
      badge:
        list.draft.action === 'delete'
          ? { tone: 'red', text: t('editor.status.deleted') }
          : { tone: 'amber', text: t('history.notPublished') },
      restorable: false,
    })
  }
  list.revisions.forEach((r, i) => {
    const isLive = i === 0 && list.live
    versions.push({
      id: r.sha,
      title: r.date ? date.format(r.date) : r.sha.slice(0, 7),
      byline: r.authorName ? t('history.byName', { name: r.authorName }) : null,
      message: r.message || null,
      badge: isLive
        ? { tone: 'green', text: t('history.live') }
        : i === 0
          ? { tone: 'red', text: t('history.removed') }
          : null,
      // The live version only needs restoring when there's a draft on top of it.
      restorable: !(i === 0 && !list.live) && !(isLive && !list.draft),
    })
  })
  return versions
}

function Timeline({
  versions,
  selected,
  onSelect,
}: {
  versions: Version[]
  selected: VersionId
  onSelect: (id: VersionId) => void
}) {
  return (
    <ol className="space-y-1">
      {versions.map((v) => (
        <li key={v.id}>
          <button
            type="button"
            onClick={() => onSelect(v.id)}
            aria-current={v.id === selected}
            className={cn(
              'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
              v.id === selected
                ? 'border-brand-300 bg-brand-50'
                : 'border-transparent hover:bg-stone-100',
            )}
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-stone-900">{v.title}</span>
              {v.badge && <Badge tone={v.badge.tone}>{v.badge.text}</Badge>}
            </span>
            {v.byline && <span className="mt-0.5 block text-sm text-stone-500">{v.byline}</span>}
            {v.message && (
              <span className="mt-0.5 block truncate text-xs text-stone-400">{v.message}</span>
            )}
          </button>
        </li>
      ))}
    </ol>
  )
}

/** One side of the comparison: which version, and a way to bring it back. */
function VersionPicker({
  label,
  versions,
  value,
  onChange,
  onRestore,
  restoring,
}: {
  label: string
  versions: Version[]
  value: VersionId
  onChange: (id: VersionId) => void
  onRestore: () => void
  restoring: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const version = versions.find((v) => v.id === value)
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="block text-xs font-medium uppercase tracking-wide text-stone-500"
      >
        {label}
      </label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.badge ? `${v.title} (${v.badge.text})` : v.title}
          </option>
        ))}
      </Select>
      {version?.restorable && (
        <Button variant="secondary" size="sm" loading={restoring} onClick={onRestore}>
          <RotateCcw className="size-4" /> {t('history.restore')}
        </Button>
      )}
    </div>
  )
}

function Side({
  query,
  render,
}: {
  query: { data?: { data: Data | null }; error: unknown; isPending: boolean }
  render: (data: Data) => ReactNode
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  if (query.isPending) return <Spinner className="m-2 size-5" />
  if (query.error) return <Alert>{errorMessage(query.error)}</Alert>
  if (!query.data?.data)
    return <p className="text-sm italic text-stone-500">{t('history.absent')}</p>
  return render(query.data.data)
}

function Comparison({
  siteId,
  siteUrl,
  collection,
  slug,
  left,
  right,
  leftLabel,
  rightLabel,
  locale,
}: {
  siteId: string
  siteUrl: string | null
  collection: CollectionInfo
  slug: string
  locale?: string
  left: VersionId
  right: VersionId
  leftLabel: string
  rightLabel: string
}) {
  const { t } = useTranslation()
  const label = useLabel()
  const [onlyChanges, setOnlyChanges] = useState(true)
  const a = useQuery(revisionQuery(siteId, collection.name, slug, left, locale))
  const b = useQuery(revisionQuery(siteId, collection.name, slug, right, locale))
  const fields = collection.fields.filter((f) => f.type !== 'hidden')
  const loaded = a.data && b.data
  const changed = new Set(
    loaded
      ? fields
          .filter((f) => !same(a.data?.data?.[f.name], b.data?.data?.[f.name]))
          .map((f) => f.name)
      : [],
  )
  // A version without the file differs everywhere it has content.
  const existenceDiffers = loaded && !a.data?.data !== !b.data?.data
  const shown = onlyChanges && loaded ? fields.filter((f) => changed.has(f.name)) : fields

  const cell = (version: VersionId, field: FieldDef, data: Data) => (
    <FieldInput
      // Remount per version: the rich text editor only reads its value once.
      key={`${version}:${field.name}`}
      id={`${version}-${field.name}`}
      field={field}
      value={data[field.name]}
      path={field.name}
      onChange={() => {}}
    />
  )

  return (
    <EditorContext.Provider value={{ siteId, siteUrl, missing: new Set(), readOnly: true }}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-600" role="status">
          {!loaded
            ? null
            : left === right
              ? t('history.sameVersion')
              : existenceDiffers
                ? t('history.existenceDiffers')
                : changed.size === 0
                  ? t('history.noDifferences')
                  : t('history.differences', { count: changed.size })}
        </p>
        <Checkbox
          label={t('history.onlyChanges')}
          checked={onlyChanges}
          onChange={(e) => setOnlyChanges(e.target.checked)}
        />
      </div>
      {existenceDiffers ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[
            { q: a, id: left },
            { q: b, id: right },
          ].map(({ q, id }) => (
            <Card key={id} className="space-y-6 p-4">
              <Side
                query={q}
                render={(data) =>
                  fields.map((f) => (
                    <div key={f.name} className="space-y-1.5">
                      <p className="text-sm font-medium text-stone-800">{label(f.label, f.name)}</p>
                      {cell(id, f, data)}
                    </div>
                  ))
                }
              />
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {shown.map((field) => {
            const isChanged = changed.has(field.name)
            return (
              <Card
                key={field.name}
                className={cn('p-4', isChanged && 'border-amber-300 ring-1 ring-amber-200')}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-sm font-medium text-stone-800">
                    {label(field.label, field.name)}
                  </span>
                  {isChanged && <Badge tone="amber">{t('history.changed')}</Badge>}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {[
                    { q: a, id: left, caption: leftLabel },
                    { q: b, id: right, caption: rightLabel },
                  ].map(({ q, id, caption }) => (
                    <div key={id} className="min-w-0">
                      <p className="mb-1 text-xs text-stone-400 md:hidden">{caption}</p>
                      <Side query={q} render={(data) => cell(id, field, data)} />
                    </div>
                  ))}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </EditorContext.Provider>
  )
}

export function HistoryPage() {
  const { t } = useTranslation()
  const label = useLabel()
  const navigate = useNavigate({ from: '/sites/$siteId/$collection/history/$slug' })
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const { siteId, collection: name, slug } = useParams({ from: ROUTE })
  const search = useSearch({ from: ROUTE })
  const languageName = useLanguageName()
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { collection } = useSiteCollection(siteId, name)
  const locale = search.locale
  const { data: entry } = useSuspenseQuery(entryQuery(siteId, name, slug, locale))
  const { data: list } = useSuspenseQuery(revisionsQuery(siteId, name, slug, locale))
  const back: Record<string, string> = locale ? { locale } : {}
  const versions = useVersions(list)

  const restore = useMutation({
    mutationFn: (rev: string) => restoreRevision(siteId, name, slug, rev, locale),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sites', siteId] })
      await navigate({
        to: '/sites/$siteId/$collection/edit/$slug',
        params: { siteId, collection: name, slug },
        search: back,
      })
    },
  })

  if (!collection) return <MissingCollection />
  const collectionLabel = label(collection.label, collection.name)
  const title =
    slug === SINGLETON_SLUG
      ? collectionLabel
      : (typeof entry.data.title === 'string' && entry.data.title.trim()) || t('editor.untitled')

  const ids = versions.map((v) => v.id)
  const valid = (id: string | undefined) => (id && ids.includes(id) ? id : undefined)
  // By default: what you're working on now, next to the version before it.
  const right = valid(search.b) ?? ids[0] ?? 'draft'
  const left = valid(search.a) ?? ids[ids.indexOf(right) + 1] ?? right
  const select = (side: 'a' | 'b', id: VersionId) =>
    void navigate({ search: (prev) => ({ ...prev, [side]: id }), replace: true })
  const labelOf = (id: VersionId) => versions.find((v) => v.id === id)?.title ?? ''
  const onRestore = (id: VersionId) => {
    if (confirm(t('history.confirmRestore', { version: labelOf(id) }))) restore.mutate(id)
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Breadcrumbs
        items={[
          { label: t('nav.websites'), to: '/' },
          { label: site.name, to: '/sites/$siteId', params: { siteId } },
          ...(collection.kind === 'folder'
            ? [
                {
                  label: collectionLabel,
                  to: '/sites/$siteId/$collection',
                  params: { siteId, collection: name },
                },
              ]
            : []),
          {
            label: title,
            to: '/sites/$siteId/$collection/edit/$slug',
            params: { siteId, collection: name, slug },
            search: back,
          },
          { label: t('history.title') },
        ]}
      />
      <PageHeader
        title={t('history.titleFor', {
          title: entry.locale && entry.locales ? `${title} · ${languageName(entry.locale)}` : title,
        })}
        subtitle={t('history.subtitle')}
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              void navigate({
                to: '/sites/$siteId/$collection/edit/$slug',
                params: { siteId, collection: name, slug },
                search: back,
              })
            }
          >
            <ArrowLeft className="size-4" /> {t('history.backToEditor')}
          </Button>
        }
      />
      {restore.error && (
        <div className="mb-4">
          <Alert>{errorMessage(restore.error)}</Alert>
        </div>
      )}
      {versions.length === 0 ? (
        <Card>
          <EmptyState title={t('history.empty')} />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Card className="h-fit p-2 lg:sticky lg:top-4">
            <h2 className="flex items-center gap-2 px-3 pb-1 pt-2 text-sm font-semibold text-stone-900">
              <History className="size-4" /> {t('history.versions')}
            </h2>
            <Timeline versions={versions} selected={left} onSelect={(id) => select('a', id)} />
            {list.revisions.length >= 50 && (
              <p className="px-3 py-2 text-xs text-stone-500">{t('history.limited')}</p>
            )}
          </Card>
          <div className="min-w-0">
            <Card className="mb-4 grid gap-4 p-4 md:grid-cols-2">
              <VersionPicker
                label={t('history.left')}
                versions={versions}
                value={left}
                onChange={(id) => select('a', id)}
                onRestore={() => onRestore(left)}
                restoring={restore.isPending && restore.variables === left}
              />
              <VersionPicker
                label={t('history.right')}
                versions={versions}
                value={right}
                onChange={(id) => select('b', id)}
                onRestore={() => onRestore(right)}
                restoring={restore.isPending && restore.variables === right}
              />
            </Card>
            <Comparison
              siteId={siteId}
              siteUrl={site.siteUrl}
              collection={collection}
              slug={slug}
              left={left}
              right={right}
              locale={locale}
              leftLabel={labelOf(left)}
              rightLabel={labelOf(right)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
