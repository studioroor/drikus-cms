import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { ExternalLink, GitBranch, Globe, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Alert, Badge, EmptyState } from '@/components/ui/feedback'
import { Checkbox, Field, Input } from '@/components/ui/field'
import { api, unwrap } from '@/lib/api'
import {
  type AdminSite,
  type AdminUser,
  adminSitesQuery,
  adminUsersQuery,
  useErrorMessage,
} from '@/lib/queries'
import { PageHeader } from '../app-layout'

interface SiteForm {
  name: string
  siteUrl: string
  repoFullName: string
  branch: string
}

const emptyForm: SiteForm = { name: '', siteUrl: '', repoFullName: '', branch: 'main' }

function SiteDialog({
  site,
  open,
  onClose,
}: {
  site: AdminSite | null
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<SiteForm>(emptyForm)
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined)
  const key = open ? (site?.id ?? null) : undefined
  if (key !== loadedFor) {
    setLoadedFor(key)
    setForm(
      site
        ? {
            name: site.name,
            siteUrl: site.siteUrl ?? '',
            repoFullName: site.repoFullName ?? '',
            branch: site.branch,
          }
        : emptyForm,
    )
  }

  const save = useMutation({
    mutationFn: async () => {
      const json = {
        name: form.name,
        siteUrl: form.siteUrl.trim() || null,
        repoFullName: form.repoFullName.trim() || null,
        branch: form.branch.trim() || 'main',
      }
      if (site) await unwrap(api.admin.sites[':id'].$patch({ param: { id: site.id }, json }))
      else await unwrap(api.admin.sites.$post({ json }))
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin'] })
      await queryClient.invalidateQueries({ queryKey: ['sites'] })
      save.reset()
      onClose()
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={site ? t('admin.sites.edit') : t('admin.sites.add')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="site-form" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form id="site-form" onSubmit={submit} className="space-y-4">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <Field label={t('admin.sites.name')}>
          {(id) => (
            <Input
              id={id}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              maxLength={100}
            />
          )}
        </Field>
        <Field label={t('admin.sites.url')}>
          {(id) => (
            <Input
              id={id}
              type="url"
              placeholder="https://"
              value={form.siteUrl}
              onChange={(e) => setForm({ ...form, siteUrl: e.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <Field label={t('admin.sites.repo')}>
            {(id) => (
              <Input
                id={id}
                placeholder="studioroor/my-site"
                pattern="[A-Za-z0-9\-]+/[A-Za-z0-9._\-]+"
                value={form.repoFullName}
                onChange={(e) => setForm({ ...form, repoFullName: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('admin.sites.branch')}>
            {(id) => (
              <Input
                id={id}
                value={form.branch}
                onChange={(e) => setForm({ ...form, branch: e.target.value })}
              />
            )}
          </Field>
        </div>
        <p className="-mt-2 text-sm text-stone-500">{t('admin.sites.repoHint')}</p>
      </form>
    </Dialog>
  )
}

function MembersDialog({
  site,
  users,
  onClose,
}: {
  site: AdminSite | null
  users: AdminUser[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const queryClient = useQueryClient()
  const [userIds, setUserIds] = useState<string[]>([])
  const [forSite, setForSite] = useState<string>()
  if (site && forSite !== site.id) {
    setForSite(site.id)
    setUserIds(site.memberIds)
  }
  const editors = users.filter((u) => u.role === 'editor')

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.admin.sites[':id'].members.$put({ param: { id: site?.id ?? '' }, json: { userIds } }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin'] })
      onClose()
    },
  })

  return (
    <Dialog
      open={!!site}
      onClose={onClose}
      title={t('admin.sites.editorsFor', { name: site?.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        {editors.length === 0 ? (
          <p className="text-sm text-stone-500">{t('common.none')}</p>
        ) : (
          <div className="space-y-0.5">
            {editors.map((u) => (
              <Checkbox
                key={u.id}
                label={u.name}
                description={u.email}
                checked={userIds.includes(u.id)}
                onChange={(e) =>
                  setUserIds(
                    e.target.checked ? [...userIds, u.id] : userIds.filter((id) => id !== u.id),
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </Dialog>
  )
}

export function SitesPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const { data: sites } = useSuspenseQuery(adminSitesQuery)
  const { data: users } = useSuspenseQuery(adminUsersQuery)
  const [dialog, setDialog] = useState<{ open: boolean; site: AdminSite | null }>({
    open: false,
    site: null,
  })
  const [members, setMembers] = useState<AdminSite | null>(null)

  const remove = useMutation({
    mutationFn: (site: AdminSite) =>
      unwrap(api.admin.sites[':id'].$delete({ param: { id: site.id } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
    onError: (err) => alert(errorMessage(err)),
  })

  return (
    <>
      <PageHeader
        title={t('admin.sites.title')}
        subtitle={t('admin.sites.subtitle')}
        actions={
          <Button onClick={() => setDialog({ open: true, site: null })}>
            <Plus className="size-4" />
            {t('admin.sites.add')}
          </Button>
        }
      />
      <Card>
        {sites.length === 0 ? (
          <EmptyState icon={<Globe className="size-6" />} title={t('admin.sites.empty')} />
        ) : (
          <ul className="divide-y divide-stone-200">
            {sites.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <div className="min-w-0 flex-1 basis-60">
                  <p className="truncate font-medium">{s.name}</p>
                  {s.siteUrl && (
                    <a
                      href={s.siteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-brand-700"
                    >
                      {new URL(s.siteUrl).host} <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
                <div className="flex flex-1 basis-60 items-center gap-1.5 text-sm text-stone-600">
                  {s.repoFullName ? (
                    <>
                      <GitBranch className="size-4 text-stone-400" />
                      <span className="truncate font-mono text-xs">
                        {s.repoFullName}@{s.branch}
                      </span>
                    </>
                  ) : (
                    <Badge tone="amber">{t('admin.sites.noRepo')}</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setMembers(s)}>
                    <Users className="size-4" />
                    {s.memberIds.length}
                    <span className="sr-only">{t('admin.sites.editors')}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDialog({ open: true, site: s })}
                    aria-label={t('common.edit')}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-700"
                    aria-label={t('common.delete')}
                    onClick={() =>
                      confirm(t('admin.sites.confirmDelete', { name: s.name })) && remove.mutate(s)
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <SiteDialog
        open={dialog.open}
        site={dialog.site}
        onClose={() => setDialog({ open: false, site: null })}
      />
      <MembersDialog site={members} users={users} onClose={() => setMembers(null)} />
    </>
  )
}
