import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { ChevronRight, ExternalLink, FileText, Layers, PencilLine, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Breadcrumbs, StatusBadge } from '@/components/editor/status'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import { api, unwrap } from '@/lib/api'
import {
  changesQuery,
  SINGLETON_SLUG,
  type SiteContent,
  siteContentQuery,
  useLabel,
} from '@/lib/content'
import { useMe } from '@/lib/queries'
import { PageHeader } from './app-layout'

export const siteQuery = (siteId: string) => ({
  queryKey: ['sites', siteId],
  queryFn: () => unwrap(api.sites[':siteId'].$get({ param: { siteId } })).then((r) => r.site),
})

function NotReady({ content }: { content: SiteContent }) {
  const { t } = useTranslation()
  const me = useMe()
  const admin = me.role === 'superadmin'
  const adminHint = {
    not_linked: t('editor.notLinkedAdmin'),
    github_not_configured: t('editor.githubAdmin'),
    no_config: t('editor.noConfigAdmin'),
    invalid_config: t('editor.invalidConfigAdmin'),
    ok: '',
  }[content.status]
  return (
    <Card>
      <EmptyState icon={<Wrench className="size-6" />} title={t('editor.notReadyTitle')}>
        {admin ? adminHint : t('editor.notReadyEditor')}
      </EmptyState>
      {admin && content.issues && (
        <ul className="mx-5 mb-5 space-y-1 rounded-lg bg-red-50 p-4 font-mono text-xs text-red-800">
          {content.issues.map((issue) => (
            <li key={`${issue.path}:${issue.message}`}>
              {issue.path && <span className="font-semibold">{issue.path}: </span>}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function PendingChanges({ siteId, count }: { siteId: string; count: number }) {
  const { t, i18n } = useTranslation()
  const label = useLabel()
  const content = useSuspenseQuery(siteContentQuery(siteId)).data
  const changes = useQuery({ ...changesQuery(siteId), enabled: count > 0 })
  if (count === 0) return null
  const collectionLabel = (name: string) => {
    const c = content.collections.find((x) => x.name === name)
    return c ? label(c.label, c.name) : name
  }
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })
  return (
    <Card className="mb-6 border-amber-200 bg-amber-50/50">
      <div className="px-5 py-4">
        <p className="font-medium text-amber-900">{t('editor.changes', { count })}</p>
        <p className="mt-0.5 text-sm text-amber-800">{t('editor.publishSoon')}</p>
      </div>
      {changes.data && (
        <ul className="divide-y divide-amber-100 border-t border-amber-100 text-sm">
          {changes.data.map((c) => (
            <li
              key={`${c.collection}/${c.slug}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5"
            >
              <Link
                to="/sites/$siteId/$collection/edit/$slug"
                params={{ siteId, collection: c.collection, slug: c.slug }}
                className="font-medium text-stone-800 hover:text-brand-700"
              >
                {c.title ?? (c.slug === SINGLETON_SLUG ? collectionLabel(c.collection) : c.slug)}
              </Link>
              <span className="text-stone-500">{collectionLabel(c.collection)}</span>
              <StatusBadge status={c.status} />
              <span className="ml-auto text-xs text-stone-500">
                {c.updatedBy?.name} · {fmt.format(c.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export function SitePage() {
  const { t } = useTranslation()
  const label = useLabel()
  const { siteId } = useParams({ from: '/app/sites/$siteId' })
  const { data: site } = useSuspenseQuery(siteQuery(siteId))
  const { data: content } = useSuspenseQuery(siteContentQuery(siteId))

  return (
    <>
      <Breadcrumbs items={[{ label: t('nav.websites'), to: '/' }, { label: site.name }]} />
      <PageHeader
        title={site.name}
        subtitle={content.status === 'ok' ? t('editor.sections') : undefined}
        actions={
          site.siteUrl && (
            <a
              href={site.siteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 text-sm font-medium text-stone-800 hover:bg-stone-100"
            >
              <ExternalLink className="size-4" />
              {t('home.visit')}
            </a>
          )
        }
      />
      {content.status !== 'ok' ? (
        <NotReady content={content} />
      ) : (
        <>
          <PendingChanges siteId={siteId} count={content.changes} />
          <div className="grid gap-3 sm:grid-cols-2">
            {content.collections.map((c) => {
              const Icon = c.kind === 'file' ? FileText : Layers
              const link =
                c.kind === 'file'
                  ? ({
                      to: '/sites/$siteId/$collection/edit/$slug',
                      params: { siteId, collection: c.name, slug: SINGLETON_SLUG },
                    } as const)
                  : ({
                      to: '/sites/$siteId/$collection',
                      params: { siteId, collection: c.name },
                    } as const)
              return (
                <Link
                  key={c.name}
                  {...link}
                  className="group flex items-center gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-brand-600/40 hover:shadow-md"
                >
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{label(c.label, c.name)}</p>
                    {c.description && (
                      <p className="truncate text-sm text-stone-500">{label(c.description)}</p>
                    )}
                  </div>
                  {c.kind === 'file' ? (
                    <PencilLine className="size-4 text-stone-400 group-hover:text-brand-700" />
                  ) : (
                    <ChevronRight className="size-5 text-stone-400 group-hover:text-brand-700" />
                  )}
                </Link>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

export function useSiteCollection(siteId: string, name: string) {
  const { data: content } = useSuspenseQuery(siteContentQuery(siteId))
  const collection = content.collections.find((c) => c.name === name)
  return { content, collection }
}

export function MissingCollection() {
  const { t } = useTranslation()
  return (
    <Card>
      <EmptyState title={t('errors.not_found')} />
    </Card>
  )
}
