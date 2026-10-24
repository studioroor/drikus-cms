import { useSuspenseQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import { ArrowLeft, ExternalLink, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import { api, unwrap } from '@/lib/api'
import { PageHeader } from './app-layout'

export const siteQuery = (siteId: string) => ({
  queryKey: ['sites', siteId],
  queryFn: () => unwrap(api.sites[':siteId'].$get({ param: { siteId } })).then((r) => r.site),
})

export function SitePage() {
  const { t } = useTranslation()
  const { siteId } = useParams({ from: '/app/sites/$siteId' })
  const { data: site } = useSuspenseQuery(siteQuery(siteId))

  return (
    <>
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900"
      >
        <ArrowLeft className="size-4" />
        {t('nav.websites')}
      </Link>
      <PageHeader
        title={site.name}
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
      <Card>
        <EmptyState icon={<Sparkles className="size-6" />} title={t('site.soonTitle')}>
          {t('site.soonBody')}
        </EmptyState>
      </Card>
    </>
  )
}
