import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import {
  Globe,
  KeyRound,
  Link2,
  MoreHorizontal,
  ShieldOff,
  Trash2,
  UserPlus,
  UserX,
} from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CopyField } from '@/components/ui/copy-field'
import { Dialog } from '@/components/ui/dialog'
import { Alert, Badge } from '@/components/ui/feedback'
import { Checkbox, Field, Input, Select } from '@/components/ui/field'
import { api, unwrap } from '@/lib/api'
import type { Locale } from '@/lib/i18n'
import {
  type AdminSite,
  type AdminUser,
  adminSitesQuery,
  adminUsersQuery,
  useErrorMessage,
  useMe,
} from '@/lib/queries'
import { PageHeader } from '../app-layout'

type Role = AdminUser['role']

function SiteChecklist({
  sites,
  value,
  onChange,
}: {
  sites: AdminSite[]
  value: string[]
  onChange: (ids: string[]) => void
}) {
  const { t } = useTranslation()
  if (sites.length === 0) return <p className="text-sm text-stone-500">{t('admin.sites.empty')}</p>
  return (
    <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-stone-200 p-1">
      {sites.map((s) => (
        <Checkbox
          key={s.id}
          label={s.name}
          description={s.siteUrl ?? undefined}
          checked={value.includes(s.id)}
          onChange={(e) =>
            onChange(e.target.checked ? [...value, s.id] : value.filter((id) => id !== s.id))
          }
        />
      ))}
    </div>
  )
}

function LinkDialog({
  link,
  onClose,
}: {
  link: { name: string; url: string; type: 'invite' | 'reset' } | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog
      open={!!link}
      onClose={onClose}
      title={t('admin.users.linkTitle', { name: link?.name })}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
    >
      {link && (
        <div className="space-y-3">
          <p className="text-sm text-stone-600">
            {t(link.type === 'invite' ? 'admin.users.inviteBody' : 'admin.users.resetBody', {
              name: link.name,
            })}
          </p>
          <CopyField value={link.url} />
        </div>
      )}
    </Dialog>
  )
}

function CreateUserDialog({
  open,
  onClose,
  onCreated,
  sites,
}: {
  open: boolean
  onClose: () => void
  onCreated: (name: string, url: string) => void
  sites: AdminSite[]
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    email: '',
    name: '',
    role: 'editor' as Role,
    locale: 'nl' as Locale,
    siteIds: [] as string[],
  })

  const create = useMutation({
    mutationFn: () => unwrap(api.admin.users.$post({ json: form })),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: ['admin'] })
      onCreated(form.name, res.link)
      setForm({ email: '', name: '', role: 'editor', locale: 'nl', siteIds: [] })
      create.reset()
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('admin.users.add')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="create-user" loading={create.isPending}>
            {t('admin.users.add')}
          </Button>
        </>
      }
    >
      <form id="create-user" onSubmit={submit} className="space-y-4">
        {create.error && <Alert>{errorMessage(create.error)}</Alert>}
        <Field label={t('admin.users.name')}>
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
        <Field label={t('admin.users.email')}>
          {(id) => (
            <Input
              id={id}
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('admin.users.role')}>
            {(id) => (
              <Select
                id={id}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                <option value="editor">{t('admin.users.roles.editor')}</option>
                <option value="superadmin">{t('admin.users.roles.superadmin')}</option>
              </Select>
            )}
          </Field>
          <Field label={t('admin.users.language')}>
            {(id) => (
              <Select
                id={id}
                value={form.locale}
                onChange={(e) => setForm({ ...form, locale: e.target.value as Locale })}
              >
                <option value="nl">{t('language.nl')}</option>
                <option value="en">{t('language.en')}</option>
              </Select>
            )}
          </Field>
        </div>
        {form.role === 'editor' && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-stone-800">{t('admin.users.sites')}</p>
            <p className="text-sm text-stone-500">{t('admin.users.roleHint')}</p>
            <SiteChecklist
              sites={sites}
              value={form.siteIds}
              onChange={(siteIds) => setForm({ ...form, siteIds })}
            />
          </div>
        )}
      </form>
    </Dialog>
  )
}

function UserSitesDialog({
  user,
  sites,
  onClose,
}: {
  user: AdminUser | null
  sites: AdminSite[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const queryClient = useQueryClient()
  const [siteIds, setSiteIds] = useState<string[]>([])
  const [forUser, setForUser] = useState<string>()
  if (user && forUser !== user.id) {
    setForUser(user.id)
    setSiteIds(user.siteIds)
  }

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.admin.users[':id'].sites.$put({ param: { id: user?.id ?? '' }, json: { siteIds } }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin'] })
      onClose()
    },
  })

  return (
    <Dialog
      open={!!user}
      onClose={onClose}
      title={t('admin.users.sitesFor', { name: user?.name })}
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
        <SiteChecklist sites={sites} value={siteIds} onChange={setSiteIds} />
      </div>
    </Dialog>
  )
}

function statusTone(status: AdminUser['status']) {
  return status === 'active' ? 'green' : status === 'invited' ? 'amber' : 'red'
}

function UserActions({
  user,
  isSelf,
  onLink,
  onSites,
}: {
  user: AdminUser
  isSelf: boolean
  onLink: (type: 'invite' | 'reset', url: string) => void
  onSites: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin'] })
  const param = { id: user.id }

  const action = useMutation({
    mutationFn: async (kind: 'link' | 'toggle' | 'totp' | 'delete') => {
      switch (kind) {
        case 'link': {
          const res = await unwrap(api.admin.users[':id'].link.$post({ param }))
          onLink(res.type, res.link)
          return
        }
        case 'toggle':
          await unwrap(
            api.admin.users[':id'].$patch({
              param,
              json: { disabled: user.status !== 'disabled' },
            }),
          )
          return
        case 'totp':
          if (!confirm(t('admin.users.confirmResetTotp', { name: user.name }))) return
          await unwrap(api.admin.users[':id']['reset-totp'].$post({ param }))
          return
        case 'delete':
          if (!confirm(t('admin.users.confirmDelete', { name: user.name }))) return
          await unwrap(api.admin.users[':id'].$delete({ param }))
          return
      }
    },
    onSuccess: invalidate,
    onError: (err) => alert(errorMessage(err)),
  })

  const item =
    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-stone-100 disabled:opacity-50'
  const menu = useRef<HTMLDetailsElement>(null)
  // Closes the menu, then runs the chosen action.
  const run = (fn: () => void) => () => {
    menu.current?.removeAttribute('open')
    fn()
  }

  return (
    <details ref={menu} className="relative">
      <summary className="flex cursor-pointer list-none items-center justify-center rounded-lg p-2 text-stone-500 hover:bg-stone-100 [&::-webkit-details-marker]:hidden">
        <MoreHorizontal className="size-4" />
        <span className="sr-only">{t('common.edit')}</span>
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-52 rounded-xl border border-stone-200 bg-white p-1 shadow-lg">
        <button
          type="button"
          className={item}
          disabled={user.status === 'disabled'}
          onClick={run(() => action.mutate('link'))}
        >
          <Link2 className="size-4" /> {t('admin.users.newLink')}
        </button>
        {user.role === 'editor' && (
          <button type="button" className={item} onClick={run(onSites)}>
            <Globe className="size-4" /> {t('admin.users.editSites')}
          </button>
        )}
        {!isSelf && (
          <>
            {user.totpEnabled && (
              <button type="button" className={item} onClick={run(() => action.mutate('totp'))}>
                <ShieldOff className="size-4" /> {t('admin.users.resetTotp')}
              </button>
            )}
            <button type="button" className={item} onClick={run(() => action.mutate('toggle'))}>
              {user.status === 'disabled' ? (
                <KeyRound className="size-4" />
              ) : (
                <UserX className="size-4" />
              )}
              {user.status === 'disabled' ? t('admin.users.enable') : t('admin.users.disable')}
            </button>
            <button
              type="button"
              className={`${item} text-red-700`}
              onClick={run(() => action.mutate('delete'))}
            >
              <Trash2 className="size-4" /> {t('common.delete')}
            </button>
          </>
        )}
      </div>
    </details>
  )
}

export function UsersPage() {
  const { t } = useTranslation()
  const me = useMe()
  const { data: users } = useSuspenseQuery(adminUsersQuery)
  const { data: sites } = useSuspenseQuery(adminSitesQuery)
  const [creating, setCreating] = useState(false)
  const [link, setLink] = useState<{ name: string; url: string; type: 'invite' | 'reset' } | null>(
    null,
  )
  const [editingSites, setEditingSites] = useState<AdminUser | null>(null)
  const siteName = new Map(sites.map((s) => [s.id, s.name]))

  return (
    <>
      <PageHeader
        title={t('admin.users.title')}
        subtitle={t('admin.users.subtitle')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <UserPlus className="size-4" />
            {t('admin.users.add')}
          </Button>
        }
      />
      <Card className="overflow-visible">
        <ul className="divide-y divide-stone-200">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
              <div className="min-w-0 flex-1 basis-56">
                <p className="truncate font-medium">
                  {u.name}{' '}
                  {u.id === me.id && (
                    <span className="text-sm font-normal text-stone-500">
                      ({t('admin.users.you')})
                    </span>
                  )}
                </p>
                <p className="truncate text-sm text-stone-500">{u.email}</p>
              </div>
              <div className="flex flex-1 basis-56 flex-wrap gap-1.5">
                {u.role === 'superadmin' ? (
                  <Badge tone="brand">{t('admin.users.roles.superadmin')}</Badge>
                ) : u.siteIds.length === 0 ? (
                  <span className="text-sm text-stone-400">{t('admin.users.noSites')}</span>
                ) : (
                  u.siteIds.map((id) => <Badge key={id}>{siteName.get(id) ?? id}</Badge>)
                )}
              </div>
              <div className="flex items-center gap-2">
                {u.totpEnabled && <Badge tone="neutral">2FA</Badge>}
                <Badge tone={statusTone(u.status)}>{t(`admin.users.statuses.${u.status}`)}</Badge>
                <UserActions
                  user={u}
                  isSelf={u.id === me.id}
                  onLink={(type, url) => setLink({ name: u.name, url, type })}
                  onSites={() => setEditingSites(u)}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <CreateUserDialog
        open={creating}
        onClose={() => setCreating(false)}
        sites={sites}
        onCreated={(name, url) => {
          setCreating(false)
          setLink({ name, url, type: 'invite' })
        }}
      />
      <LinkDialog link={link} onClose={() => setLink(null)} />
      <UserSitesDialog user={editingSites} sites={sites} onClose={() => setEditingSites(null)} />
    </>
  )
}
