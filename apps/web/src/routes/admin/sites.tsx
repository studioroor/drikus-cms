import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import {
  ExternalLink,
  GitBranch,
  Globe,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Alert, Badge, EmptyState } from '@/components/ui/feedback'
import { Checkbox, Field, Input, Select } from '@/components/ui/field'
import { api, unwrap } from '@/lib/api'
import {
  type AdminSite,
  type AdminUser,
  adminSitesQuery,
  adminUsersQuery,
  fetchGithubRepos,
  githubReposQuery,
  githubStatusQuery,
  useErrorMessage,
} from '@/lib/queries'
import { PageHeader } from '../app-layout'
import { ConnectionCheckDialog, GitHubPanel } from './github'

interface SiteForm {
  name: string
  siteUrl: string
  repoId: number | null
  branch: string
}

const emptyForm: SiteForm = { name: '', siteUrl: '', repoId: null, branch: '' }

function RepoPicker({
  value,
  onChange,
  site,
  sites,
}: {
  value: number | null
  onChange: (repoId: number | null) => void
  site: AdminSite | null
  sites: AdminSite[]
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const status = useQuery(githubStatusQuery)
  const ready = status.data?.configured && !status.data.error
  const repos = useQuery({ ...githubReposQuery, enabled: !!ready })
  const siteName = new Map(sites.map((s) => [s.id, s.name]))
  const refresh = useMutation({
    mutationFn: () => fetchGithubRepos(true),
    onSuccess: (list) => queryClient.setQueryData(githubReposQuery.queryKey, list),
  })

  return (
    <Field
      label={t('admin.sites.repo')}
      hint={ready ? t('admin.sites.repoHint') : t('admin.sites.repoHintNoGithub')}
    >
      {(id) => (
        <div className="flex gap-2">
          <Select
            id={id}
            value={value ?? ''}
            disabled={!ready || repos.isPending}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">{t('admin.sites.noRepoOption')}</option>
            {/* Keep showing the current link even if the repo list can't be loaded. */}
            {site?.repoId && !repos.data?.some((r) => r.id === site.repoId) && (
              <option value={site.repoId}>{site.repoFullName}</option>
            )}
            {repos.data?.map((r) => {
              const takenBy = r.siteId && r.siteId !== site?.id ? siteName.get(r.siteId) : null
              return (
                <option key={r.id} value={r.id} disabled={!!takenBy}>
                  {r.fullName}
                  {takenBy ? ` (${t('admin.sites.inUse', { name: takenBy })})` : ''}
                </option>
              )
            })}
          </Select>
          <Button
            variant="secondary"
            disabled={!ready}
            loading={refresh.isPending}
            onClick={() => refresh.mutate()}
            aria-label={t('admin.sites.refresh')}
            title={t('admin.sites.refresh')}
          >
            {!refresh.isPending && <RefreshCw className="size-4" />}
          </Button>
        </div>
      )}
    </Field>
  )
}

function SiteDialog({
  site,
  sites,
  open,
  onClose,
}: {
  site: AdminSite | null
  sites: AdminSite[]
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const queryClient = useQueryClient()
  const repos = useQuery({ ...githubReposQuery, enabled: false })
  const [form, setForm] = useState<SiteForm>(emptyForm)
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined)
  const key = open ? (site?.id ?? null) : undefined
  if (key !== loadedFor) {
    setLoadedFor(key)
    setForm(
      site
        ? { name: site.name, siteUrl: site.siteUrl ?? '', repoId: site.repoId, branch: site.branch }
        : emptyForm,
    )
  }
  const defaultBranch = repos.data?.find((r) => r.id === form.repoId)?.defaultBranch ?? 'main'

  const save = useMutation({
    mutationFn: async () => {
      const branch = form.branch.trim()
      const base = { name: form.name, siteUrl: form.siteUrl.trim() || null }
      if (site) {
        // Only send link changes, so editing a name never depends on GitHub being reachable.
        const json = {
          ...base,
          ...(form.repoId !== site.repoId ? { repoId: form.repoId } : {}),
          ...(form.repoId && branch && branch !== site.branch ? { branch } : {}),
        }
        await unwrap(api.admin.sites[':id'].$patch({ param: { id: site.id }, json }))
      } else {
        await unwrap(
          api.admin.sites.$post({
            json: {
              ...base,
              ...(form.repoId ? { repoId: form.repoId, ...(branch ? { branch } : {}) } : {}),
            },
          }),
        )
      }
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
        <RepoPicker
          value={form.repoId}
          site={site}
          sites={sites}
          onChange={(repoId) => setForm({ ...form, repoId, branch: '' })}
        />
        {form.repoId && (
          <Field
            label={t('admin.sites.branch')}
            hint={t('admin.sites.branchHint', { branch: defaultBranch })}
          >
            {(id) => (
              <Input
                id={id}
                placeholder={defaultBranch}
                value={form.branch}
                onChange={(e) => setForm({ ...form, branch: e.target.value })}
              />
            )}
          </Field>
        )}
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
  const { data: github } = useSuspenseQuery(githubStatusQuery)
  const [checking, setChecking] = useState<AdminSite | null>(null)
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
      <div className="mb-4">
        <GitHubPanel status={github} />
      </div>
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
                  {s.repoId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setChecking(s)}
                      aria-label={t('admin.sites.check')}
                      title={t('admin.sites.check')}
                    >
                      <Plug className="size-4" />
                    </Button>
                  )}
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
        sites={sites}
        onClose={() => setDialog({ open: false, site: null })}
      />
      <MembersDialog site={members} users={users} onClose={() => setMembers(null)} />
      <ConnectionCheckDialog site={checking} onClose={() => setChecking(null)} />
    </>
  )
}
