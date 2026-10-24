import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, GitCommitHorizontal, Webhook } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Alert, Spinner } from '@/components/ui/feedback'
import { api, unwrap } from '@/lib/api'
import { type AdminSite, type GithubStatus, useErrorMessage } from '@/lib/queries'

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

export function GitHubPanel({ status }: { status: GithubStatus }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const relative = useRelativeTime()

  if (!status.configured) {
    return (
      <Alert tone="info">
        <p className="font-medium">{t('admin.github.notConfigured')}</p>
        <p className="mt-0.5">{t('admin.github.notConfiguredHint')}</p>
      </Alert>
    )
  }
  if (status.error || !status.app) {
    return (
      <Alert>
        <p className="font-medium">{t('admin.github.problem')}</p>
        <p className="mt-0.5">
          {errorMessage({ code: status.error })}{' '}
          {status.message && <span className="opacity-75">({status.message})</span>}
        </p>
      </Alert>
    )
  }

  const { webhook } = status
  const webhookText = !webhook.configured
    ? t('admin.github.webhooksOff')
    : webhook.lastReceivedAt
      ? t('admin.github.webhooksOk', { time: relative(webhook.lastReceivedAt) })
      : t('admin.github.webhooksWaiting')

  return (
    <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3.5 text-sm">
      <span className="flex items-center gap-2 font-medium text-stone-800">
        <CheckCircle2 className="size-4 text-emerald-600" />
        {t('admin.github.connected', { app: status.app.name, org: status.org })}
      </span>
      <span className="text-stone-600">
        {t('admin.github.repoCount', { count: status.repoCount ?? 0 })}
      </span>
      <span className="flex items-center gap-1.5 text-stone-600">
        <Webhook className="size-4 text-stone-400" />
        {webhookText}
      </span>
      <a
        href={status.app.htmlUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto inline-flex items-center gap-1 text-stone-500 hover:text-brand-700"
      >
        {t('admin.github.openOnGitHub')} <ExternalLink className="size-3" />
      </a>
    </Card>
  )
}

export function ConnectionCheckDialog({
  site,
  onClose,
}: {
  site: AdminSite | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const check = useQuery({
    queryKey: ['admin', 'sites', site?.id, 'check'],
    queryFn: () => unwrap(api.admin.sites[':id'].check.$get({ param: { id: site?.id ?? '' } })),
    enabled: !!site,
    retry: false,
    gcTime: 0,
  })

  return (
    <Dialog
      open={!!site}
      onClose={onClose}
      title={t('admin.sites.checkTitle', { name: site?.name })}
    >
      {check.isPending ? (
        <div className="flex justify-center py-6">
          <Spinner className="size-6" />
        </div>
      ) : check.error ? (
        <Alert>{errorMessage(check.error)}</Alert>
      ) : (
        <div className="space-y-4">
          <Alert tone="success">{t('admin.sites.checkOk')}</Alert>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-stone-500">{t('admin.sites.repo')}</dt>
            <dd className="font-mono text-xs leading-5">
              {check.data.repoFullName}@{check.data.branch}
            </dd>
            <dt className="text-stone-500">{t('admin.sites.latestCommit')}</dt>
            <dd className="flex items-center gap-1 font-mono text-xs leading-5">
              <GitCommitHorizontal className="size-4 text-stone-400" />
              {check.data.commitSha.slice(0, 7)}
            </dd>
            <dt className="text-stone-500">{t('admin.sites.files')}</dt>
            <dd>{check.data.fileCount}</dd>
          </dl>
          {check.data.configPath ? (
            <Alert tone="success">
              {t('admin.sites.configFound', { path: check.data.configPath })}
            </Alert>
          ) : (
            <Alert tone="info">{t('admin.sites.configMissing')}</Alert>
          )}
        </div>
      )}
    </Dialog>
  )
}
