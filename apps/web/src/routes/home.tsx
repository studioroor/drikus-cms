import { useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ExternalLink, Globe, PencilLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SiteIcon } from '@/components/site-icon'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/feedback'
import { mySitesQuery, useMe } from '@/lib/queries'
import { PageHeader } from './app-layout'

export function HomePage() {
  const { t } = useTranslation()
  const me = useMe()
  const { data: sites } = useSuspenseQuery(mySitesQuery)

  return (
    <>
      <PageHeader
        title={t('home.title')}
        subtitle={sites.length > 0 ? t('home.subtitle') : undefined}
      />
      {sites.length === 0 ? (
        <Card>
          <EmptyState icon={<Globe className="size-6" />} title={t('home.empty')}>
            {me.role === 'superadmin' ? t('home.emptyAdmin') : t('home.emptyHint')}
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            <Card key={site.id} className="flex flex-col p-5 transition-shadow hover:shadow-md">
              <div className="mb-4 flex items-center gap-3">
                <SiteIcon siteId={site.id} />
                <div className="min-w-0">
                  <h2 className="truncate font-semibold">{site.name}</h2>
                  {site.siteUrl && (
                    <p className="truncate text-sm text-stone-500">{new URL(site.siteUrl).host}</p>
                  )}
                </div>
              </div>
              <div className="mt-auto flex gap-2">
                <Link
                  to="/sites/$siteId"
                  params={{ siteId: site.id }}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 text-sm font-medium text-white hover:bg-brand-800"
                >
                  <PencilLine className="size-4" />
                  {t('home.open')}
                </Link>
                {site.siteUrl && (
                  <a
                    href={site.siteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-stone-300 px-3 text-stone-700 hover:bg-stone-100"
                    title={t('home.visit')}
                    aria-label={t('home.visit')}
                  >
                    <ExternalLink className="size-4" />
                  </a>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
