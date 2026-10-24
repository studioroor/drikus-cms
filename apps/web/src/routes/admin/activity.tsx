import { useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { api, unwrap } from '@/lib/api'
import { PageHeader } from '../app-layout'

export const auditQuery = {
  queryKey: ['admin', 'audit'],
  queryFn: () => unwrap(api.admin.audit.$get({ query: { limit: '200' } })).then((r) => r.entries),
}

export function ActivityPage() {
  const { t, i18n } = useTranslation()
  const { data: entries } = useSuspenseQuery(auditQuery)
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <>
      <PageHeader title={t('admin.activity.title')} subtitle={t('admin.activity.subtitle')} />
      <Card className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 text-stone-500">
            <tr>
              <th className="px-5 py-3 font-medium">{t('admin.activity.when')}</th>
              <th className="px-5 py-3 font-medium">{t('admin.activity.who')}</th>
              <th className="px-5 py-3 font-medium">{t('admin.activity.action')}</th>
              <th className="px-5 py-3 font-medium">{t('admin.activity.ip')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-5 py-2.5 text-stone-600">{fmt.format(e.at)}</td>
                <td className="px-5 py-2.5">
                  {e.actor?.name ?? (
                    <span className="text-stone-400">{t('admin.activity.system')}</span>
                  )}
                </td>
                <td className="px-5 py-2.5 font-mono text-xs">{e.action}</td>
                <td className="px-5 py-2.5 font-mono text-xs text-stone-500">{e.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  )
}
