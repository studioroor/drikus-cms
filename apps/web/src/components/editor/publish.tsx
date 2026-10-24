import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  GitCommitHorizontal,
  Loader2,
  Rocket,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Alert, Badge, Spinner } from '@/components/ui/feedback'
import { ApiError } from '@/lib/api'
import {
  type DeployState,
  deployStatusQuery,
  discardEntry,
  type PublishProblem,
  publishesQuery,
  publishPreviewQuery,
  publishSite,
  resolveConflict,
  SINGLETON_SLUG,
  type SiteContent,
  useLabel,
} from '@/lib/content'
import { useErrorMessage } from '@/lib/queries'
import { StatusBadge } from './status'

function useCollectionLabel(content: SiteContent) {
  const label = useLabel()
  return (name: string) => {
    const c = content.collections.find((x) => x.name === name)
    return c ? label(c.label, c.name) : name
  }
}

function useFieldLabels(content: SiteContent) {
  const label = useLabel()
  return (collection: string, paths: string[]) => {
    const fields = content.collections.find((c) => c.name === collection)?.fields ?? []
    const names = [...new Set(paths.map((p) => p.split('.')[0] as string))]
    return names.map((n) => label(fields.find((f) => f.name === n)?.label, n)).join(', ')
  }
}

export function DeployBadge({ state }: { state: DeployState }) {
  const { t } = useTranslation()
  const tone =
    state === 'success'
      ? 'green'
      : state === 'failure'
        ? 'red'
        : state === 'pending'
          ? 'amber'
          : 'neutral'
  return <Badge tone={tone}>{t(`publish.state.${state}`)}</Badge>
}

function DeployProgress({
  siteId,
  publishId,
  siteUrl,
}: {
  siteId: string
  publishId: string
  siteUrl: string | null
}) {
  const { t } = useTranslation()
  const status = useQuery(deployStatusQuery(siteId, publishId))
  const state = status.data?.state ?? 'pending'
  const failedChecks = status.data?.checks.filter((c) => c.state === 'failure') ?? []
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-emerald-700">
        <CheckCircle2 className="size-5" /> {t('publish.savedStep')}
      </p>
      {state === 'pending' && (
        <div>
          <p className="flex items-center gap-2 font-medium">
            <Loader2 className="size-5 animate-spin text-brand-700" /> {t('publish.deploying')}
          </p>
          <p className="mt-1 text-sm text-stone-500">{t('publish.deployHint')}</p>
        </div>
      )}
      {state === 'success' && (
        <p className="flex items-center gap-2 text-lg font-semibold text-emerald-700">
          <Rocket className="size-5" /> {t('publish.live')}
        </p>
      )}
      {(state === 'none' || state === 'unknown') && (
        <Alert tone="success">{t('publish.noChecks')}</Alert>
      )}
      {state === 'failure' && (
        <Alert>
          {t('publish.failed')}
          {failedChecks.map((c) =>
            c.url ? (
              <a
                key={c.name}
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block underline"
              >
                {c.name}
              </a>
            ) : null,
          )}
        </Alert>
      )}
      {siteUrl && state !== 'failure' && (
        <a
          href={siteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
        >
          {t('publish.viewSite')} <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  )
}

function ProblemRow({
  siteId,
  content,
  problem,
}: {
  siteId: string
  content: SiteContent
  problem: PublishProblem
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const collectionLabel = useCollectionLabel(content)
  const fieldLabels = useFieldLabels(content)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sites', siteId] })
  const act = useMutation({
    mutationFn: (action: 'mine' | 'theirs' | 'discard') =>
      action === 'discard'
        ? discardEntry(siteId, problem.collection, problem.slug)
        : resolveConflict(siteId, problem.collection, problem.slug, action),
    onSuccess: refresh,
  })
  const name =
    problem.title ??
    (problem.slug === SINGLETON_SLUG ? collectionLabel(problem.collection) : problem.slug)

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{name}</span>
        <Link
          to="/sites/$siteId/$collection/edit/$slug"
          params={{ siteId, collection: problem.collection, slug: problem.slug }}
          className="text-sm text-brand-700 hover:underline"
        >
          {t('publish.open')}
        </Link>
      </div>
      <p className="text-sm text-stone-600">
        {problem.kind === 'required'
          ? t('publish.required', { fields: fieldLabels(problem.collection, problem.fields) })
          : problem.kind === 'conflict'
            ? t('publish.conflict')
            : t('publish.config')}
      </p>
      {problem.kind === 'conflict' && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={act.isPending && act.variables === 'mine'}
            onClick={() => act.mutate('mine')}
          >
            {t('publish.keepMine')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={act.isPending && act.variables === 'theirs'}
            onClick={() => act.mutate('theirs')}
          >
            {t('publish.keepTheirs')}
          </Button>
        </div>
      )}
      {problem.kind === 'config' && (
        <Button
          size="sm"
          variant="secondary"
          loading={act.isPending}
          onClick={() => act.mutate('discard')}
        >
          {t('publish.discard')}
        </Button>
      )}
      {act.error && <p className="text-sm text-red-700">{errorMessage(act.error)}</p>}
    </li>
  )
}

export function PublishDialog({
  siteId,
  siteUrl,
  content,
  open,
  onClose,
}: {
  siteId: string
  siteUrl: string | null
  content: SiteContent
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const collectionLabel = useCollectionLabel(content)
  const [message, setMessage] = useState('')
  const preview = useQuery({ ...publishPreviewQuery(siteId), enabled: open })
  const publish = useMutation({
    mutationFn: () => publishSite(siteId, message),
    onSuccess: () => {
      setMessage('')
      void queryClient.invalidateQueries({ queryKey: ['sites', siteId] })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'publish_blocked') void preview.refetch()
    },
  })
  const close = () => {
    publish.reset()
    onClose()
  }

  const done = publish.isSuccess
  const problems = preview.data?.problems ?? []
  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('publish.title')}
      footer={
        done ? (
          <Button onClick={close}>{t('common.close')}</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={publish.isPending}
              disabled={!preview.data || problems.length > 0 || preview.data.changes.length === 0}
              onClick={() => publish.mutate()}
            >
              <Rocket className="size-4" /> {t('publish.confirm')}
            </Button>
          </>
        )
      }
    >
      {done ? (
        publish.data.publish ? (
          <DeployProgress siteId={siteId} publishId={publish.data.publish.id} siteUrl={siteUrl} />
        ) : (
          <Alert tone="success">{t('publish.nothing')}</Alert>
        )
      ) : preview.isPending ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-6" />
        </div>
      ) : preview.error ? (
        <Alert>{errorMessage(preview.error)}</Alert>
      ) : (
        <div className="space-y-4">
          {publish.error && <Alert>{errorMessage(publish.error)}</Alert>}
          {problems.length > 0 && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-800">
                <CircleAlert className="size-4" /> {t('publish.problemsTitle')}
              </p>
              <ul className="divide-y divide-amber-100 rounded-lg border border-amber-200 bg-amber-50/60">
                {problems.map((p) => (
                  <ProblemRow
                    key={`${p.collection}/${p.slug}`}
                    siteId={siteId}
                    content={content}
                    problem={p}
                  />
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="mb-2 text-sm text-stone-600">{t('publish.intro')}</p>
            <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 text-sm">
              {preview.data.changes.map((c) => (
                <li key={c.path} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {c.title ??
                      (c.slug === SINGLETON_SLUG ? collectionLabel(c.collection) : c.slug)}
                  </span>
                  <span className="text-stone-500">{collectionLabel(c.collection)}</span>
                  <StatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          </div>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-stone-800">{t('publish.message')}</span>
            <input
              value={message}
              maxLength={200}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('publish.messagePlaceholder')}
              className="block h-11 w-full rounded-lg border border-stone-300 bg-white px-3 shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
            />
          </label>
        </div>
      )}
    </Dialog>
  )
}

/** The latest publishes of a site with their deploy state. */
export function PublishHistory({ siteId }: { siteId: string }) {
  const { t, i18n } = useTranslation()
  const history = useQuery(publishesQuery(siteId))
  const latest = history.data?.[0]
  // Keep the newest publish's state fresh while it's deploying.
  const live = useQuery({
    ...deployStatusQuery(siteId, latest?.id ?? ''),
    enabled: !!latest && latest.deployState === 'pending',
  })
  if (!history.data?.length) return null
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-stone-500 uppercase">
        {t('publish.history')}
      </h2>
      <ul className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white text-sm shadow-sm">
        {history.data.slice(0, 5).map((p, i) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
            <span className="text-stone-700">{fmt.format(p.createdAt)}</span>
            {p.userName && (
              <span className="text-stone-500">{t('publish.by', { name: p.userName })}</span>
            )}
            <span className="text-stone-500">
              {t('publish.changeCount', { count: p.changes.length })}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {p.commitUrl && (
                <a
                  href={p.commitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-brand-700"
                  title={t('publish.commit')}
                >
                  <GitCommitHorizontal className="size-4" />
                </a>
              )}
              <DeployBadge state={i === 0 && live.data ? live.data.state : p.deployState} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
