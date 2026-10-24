import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import {
  AlertCircle,
  Check,
  CloudUpload,
  History,
  Loader2,
  Rocket,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EditorContext } from '@/components/editor/context'
import { FieldList } from '@/components/editor/fields'
import { ListIdsProvider } from '@/components/editor/list-ids'
import { Breadcrumbs, StatusBadge } from '@/components/editor/status'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Alert } from '@/components/ui/feedback'
import { type SaveState, useAutosave } from '@/lib/autosave'
import { cn } from '@/lib/cn'
import {
  type CollectionInfo,
  createEntry,
  type Data,
  defaultData,
  deleteEntry,
  discardEntry,
  type Entry,
  entryQuery,
  SINGLETON_SLUG,
  saveEntry,
  useLabel,
} from '@/lib/content'
import { hasListEditor } from '@/lib/list'
import { useErrorMessage, useMe } from '@/lib/queries'
import { PageHeader } from './app-layout'
import { MissingCollection, siteQuery, useSiteCollection } from './site'

type Issue = Entry['issues'][number]

function SaveIndicator({ state, status }: { state: SaveState; status: Entry['status'] }) {
  const { t } = useTranslation()
  const map = {
    pending: { icon: Loader2, text: t('editor.saving'), spin: true, tone: 'text-stone-500' },
    saving: { icon: Loader2, text: t('editor.saving'), spin: true, tone: 'text-stone-500' },
    saved: {
      icon: Check,
      text: status === 'published' ? t('editor.upToDate') : t('editor.saved'),
      spin: false,
      tone: 'text-emerald-700',
    },
    error: { icon: AlertCircle, text: t('editor.saveError'), spin: false, tone: 'text-red-700' },
    idle: null,
  }[state]
  if (!map) return null
  const Icon = map.icon
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm ${map.tone}`}
      role="status"
      aria-live="polite"
    >
      <Icon className={`size-4 ${map.spin ? 'animate-spin' : ''}`} />
      {map.text}
    </span>
  )
}

function useRelativeTime() {
  const { i18n } = useTranslation()
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
  return (ms: number) => {
    const minutes = Math.round((ms - Date.now()) / 60_000)
    if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute')
    const hours = Math.round(minutes / 60)
    return Math.abs(hours) < 48
      ? rtf.format(hours, 'hour')
      : rtf.format(Math.round(hours / 24), 'day')
  }
}

function MissingSummary({ collection, issues }: { collection: CollectionInfo; issues: Issue[] }) {
  const { t } = useTranslation()
  const label = useLabel()
  const names = [
    ...new Set(
      issues.filter((i) => i.code === 'required').map((i) => i.path.split('.')[0] as string),
    ),
  ]
  if (!names.length) return null
  const labels = names.map((n) => {
    const field = collection.fields.find((f) => f.name === n)
    return label(field?.label, n)
  })
  return <Alert tone="info">{t('editor.stillRequired', { fields: labels.join(', ') })}</Alert>
}

function EntryForm({
  siteId,
  site,
  collection,
  slug,
  entry,
  onReset,
}: {
  siteId: string
  site: { name: string; siteUrl: string | null }
  collection: CollectionInfo
  slug: string
  entry: Entry
  onReset: () => void
}) {
  const { t } = useTranslation()
  const label = useLabel()
  const siteUrl = site.siteUrl
  const me = useMe()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const relative = useRelativeTime()
  const [data, setData] = useState<Data>(entry.data)
  const [status, setStatus] = useState(entry.status)
  const [issues, setIssues] = useState(entry.issues)

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['sites', siteId, 'entries'] })
    void queryClient.invalidateQueries({ queryKey: ['sites', siteId, 'content'] })
    void queryClient.invalidateQueries({ queryKey: ['sites', siteId, 'changes'] })
  }

  const autosave = useAutosave((value: Data) => saveEntry(siteId, collection.name, slug, value), {
    onSaved: (res) => {
      setStatus(res.status)
      setIssues(res.issues)
      refreshLists()
    },
  })

  const discard = useMutation({
    mutationFn: () => discardEntry(siteId, collection.name, slug),
    onSuccess: () => {
      refreshLists()
      if (entry.published || collection.kind === 'file') onReset()
      else
        void navigate({
          to: '/sites/$siteId/$collection',
          params: { siteId, collection: collection.name },
        })
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteEntry(siteId, collection.name, slug),
    onSuccess: (res) => {
      refreshLists()
      if (res.status === 'removed') {
        void navigate({
          to: '/sites/$siteId/$collection',
          params: { siteId, collection: collection.name },
        })
      } else onReset()
    },
  })

  // Save what's typed before opening the publish dialog, so it's included.
  const goPublish = useMutation({
    mutationFn: async () => {
      await autosave.flush()
      await navigate({ to: '/sites/$siteId', params: { siteId }, search: { publish: true } })
    },
  })

  // Same for history: the latest typing should show up as the draft there.
  const goHistory = useMutation({
    mutationFn: async () => {
      await autosave.flush()
      await navigate({
        to: '/sites/$siteId/$collection/history/$slug',
        params: { siteId, collection: collection.name, slug },
      })
    },
  })

  const missing = useMemo(
    () => new Set(issues.filter((i) => i.code === 'required').map((i) => i.path)),
    [issues],
  )
  const deleted = status === 'deleted'
  const otherEditor =
    entry.draft?.updatedBy && entry.draft.updatedBy.id !== me.id ? entry.draft : null
  const error = discard.error ?? remove.error
  // Title and breadcrumbs follow the form as you type.
  const collectionLabel = label(collection.label, collection.name)
  const title =
    slug === SINGLETON_SLUG
      ? collectionLabel
      : (typeof data.title === 'string' && data.title.trim()) || t('editor.untitled')

  return (
    <EditorContext.Provider value={{ siteId, siteUrl, missing, readOnly: deleted }}>
      <Breadcrumbs
        items={[
          { label: t('nav.websites'), to: '/' },
          { label: site.name, to: '/sites/$siteId', params: { siteId } },
          ...(collection.kind === 'folder'
            ? [
                {
                  label: collectionLabel,
                  to: '/sites/$siteId/$collection',
                  params: { siteId, collection: collection.name },
                },
              ]
            : []),
          { label: title },
        ]}
      />
      <PageHeader title={title} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusBadge status={status} />
        {!deleted && <SaveIndicator state={autosave.state} status={status} />}
        <div className="ml-auto flex flex-wrap gap-2">
          {status !== 'published' && (
            <Button size="sm" loading={goPublish.isPending} onClick={() => goPublish.mutate()}>
              <Rocket className="size-4" /> {t('publish.button')}
            </Button>
          )}
          {status !== 'published' && !deleted && (
            <Button
              variant="secondary"
              size="sm"
              loading={discard.isPending}
              onClick={() => {
                if (!confirm(t('editor.confirmDiscard'))) return
                autosave.cancel()
                discard.mutate()
              }}
            >
              <RotateCcw className="size-4" /> {t('editor.discard')}
            </Button>
          )}
          {entry.published && (
            <Button
              variant="secondary"
              size="sm"
              loading={goHistory.isPending}
              onClick={() => goHistory.mutate()}
            >
              <History className="size-4" /> {t('history.button')}
            </Button>
          )}
          {collection.kind === 'folder' && collection.delete && !deleted && (
            <Button
              variant="secondary"
              size="sm"
              className="text-red-700"
              loading={remove.isPending}
              onClick={() => {
                if (!confirm(t('editor.confirmDelete'))) return
                autosave.cancel()
                remove.mutate()
              }}
            >
              <Trash2 className="size-4" /> {t('editor.delete')}
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-3">
        {error && <Alert>{errorMessage(error)}</Alert>}
        {otherEditor?.updatedBy && (
          <Alert tone="info">
            {t('editor.editedBy', {
              name: otherEditor.updatedBy.name,
              time: relative(otherEditor.updatedAt),
            })}
          </Alert>
        )}
        {deleted && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {t('editor.deletedBanner')}
            <Button
              variant="secondary"
              size="sm"
              loading={discard.isPending}
              onClick={() => discard.mutate()}
            >
              <RotateCcw className="size-4" /> {t('editor.restore')}
            </Button>
          </div>
        )}
        {!deleted && <MissingSummary collection={collection} issues={issues} />}
      </div>
      <Card className="mt-4 p-5 sm:p-6">
        <ListIdsProvider>
          <FieldList
            fields={collection.fields}
            value={data}
            onChange={(next) => {
              setData(next)
              autosave.schedule(next)
            }}
          />
        </ListIdsProvider>
      </Card>
    </EditorContext.Provider>
  )
}

export function EntryPage() {
  const {
    siteId,
    collection: name,
    slug,
  } = useParams({ from: '/app/sites/$siteId/$collection/edit/$slug' })
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { collection } = useSiteCollection(siteId, name)
  const { data: entry, refetch } = useSuspenseQuery(entryQuery(siteId, name, slug))
  const [version, setVersion] = useState(0)
  if (!collection) return <MissingCollection />

  return (
    <div className={cn('mx-auto', hasListEditor(collection.fields) ? 'max-w-6xl' : 'max-w-3xl')}>
      <EntryForm
        key={`${slug}:${version}`}
        siteId={siteId}
        site={site}
        collection={collection}
        slug={slug}
        entry={entry}
        onReset={() => {
          void refetch().then(() => setVersion((v) => v + 1))
        }}
      />
    </div>
  )
}

export function NewEntryPage() {
  const { t } = useTranslation()
  const label = useLabel()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const { siteId, collection: name } = useParams({ from: '/app/sites/$siteId/$collection/new' })
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { collection } = useSiteCollection(siteId, name)
  const [data, setData] = useState<Data>(() => (collection ? defaultData(collection.fields) : {}))
  const create = useMutation({
    mutationFn: () => createEntry(siteId, name, data),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['sites', siteId] })
      await navigate({
        to: '/sites/$siteId/$collection/edit/$slug',
        params: { siteId, collection: name, slug: res.slug },
        replace: true,
      })
    },
  })
  if (collection?.kind !== 'folder') return <MissingCollection />
  const collectionLabel = label(collection.label, collection.name)

  return (
    <div className={cn('mx-auto', hasListEditor(collection.fields) ? 'max-w-6xl' : 'max-w-3xl')}>
      <Breadcrumbs
        items={[
          { label: t('nav.websites'), to: '/' },
          { label: site.name, to: '/sites/$siteId', params: { siteId } },
          {
            label: collectionLabel,
            to: '/sites/$siteId/$collection',
            params: { siteId, collection: name },
          },
          { label: t('editor.newEntry') },
        ]}
      />
      <PageHeader
        title={t('editor.newEntryTitle', { collection: collectionLabel })}
        subtitle={t('editor.createHint')}
      />
      <EditorContext.Provider
        value={{ siteId, siteUrl: site.siteUrl, missing: new Set(), readOnly: false }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate()
          }}
        >
          {create.error && (
            <div className="mb-4">
              <Alert>{errorMessage(create.error)}</Alert>
            </div>
          )}
          <Card className="p-5 sm:p-6">
            <ListIdsProvider>
              <FieldList fields={collection.fields} value={data} onChange={setData} />
            </ListIdsProvider>
          </Card>
          <div className="mt-4 flex justify-end">
            <Button type="submit" size="lg" loading={create.isPending}>
              <CloudUpload className="size-4" /> {t('editor.create')}
            </Button>
          </div>
        </form>
      </EditorContext.Provider>
    </div>
  )
}
