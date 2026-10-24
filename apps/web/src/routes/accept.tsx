import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Alert, FullPageSpinner } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/field'
import { api, unwrap } from '@/lib/api'
import { setLocale } from '@/lib/i18n'
import { meQuery, useErrorMessage } from '@/lib/queries'
import { AuthShell } from './auth-shell'

type Kind = 'invite' | 'reset' | 'setup'

/**
 * Handles invite, password-reset and first-run setup links. The token lives in
 * the URL fragment so it never reaches server logs or Referer headers.
 */
export function AcceptPage({ kind }: { kind: Kind }) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [token] = useState(() => window.location.hash.slice(1))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)

  const info = useQuery({
    queryKey: ['token', token],
    queryFn: () => unwrap(api.auth.token.inspect.$post({ json: { token } })),
    enabled: token.length > 0,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const accept = useMutation({
    mutationFn: () =>
      unwrap(
        api.auth.token.accept.$post({
          json: {
            token,
            password,
            ...(name.trim() ? { name: name.trim() } : {}),
            ...(kind === 'setup' ? { email } : {}),
          },
        }),
      ),
    onSuccess: async (res) => {
      // Drop the token from the address bar and history.
      history.replaceState(null, '', window.location.pathname)
      if (res.status === 'ok') {
        setLocale(res.user.locale)
        queryClient.setQueryData(meQuery.queryKey, res.user)
        await navigate({ to: '/' })
      }
    },
  })

  if (token && info.isPending) return <FullPageSpinner />

  const title = t(`accept.${kind}.title`)
  if (!token || info.isError || (info.data && info.data.type !== kind)) {
    return (
      <AuthShell title={t('accept.invalidTitle')} subtitle={t('accept.invalidBody')}>
        <Link to="/login" className="text-sm font-medium text-brand-700 hover:underline">
          {t('login.title')} →
        </Link>
      </AuthShell>
    )
  }

  if (accept.data?.status === 'login_required') {
    return (
      <AuthShell title={title}>
        <Alert tone="success">{t('accept.loginRequired')}</Alert>
        <Button size="lg" className="mt-4 w-full" onClick={() => navigate({ to: '/login' })}>
          {t('login.submit')}
        </Button>
      </AuthShell>
    )
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    accept.mutate()
  }

  return (
    <AuthShell title={title} subtitle={t(`accept.${kind}.subtitle`)}>
      <form onSubmit={submit} className="space-y-4">
        {accept.error && <Alert>{errorMessage(accept.error)}</Alert>}
        {kind === 'setup' ? (
          <Field label={t('accept.email')}>
            {(id) => (
              <Input
                id={id}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            )}
          </Field>
        ) : (
          <input
            type="email"
            autoComplete="username"
            value={info.data?.email ?? ''}
            readOnly
            hidden
          />
        )}
        {kind !== 'reset' && (
          <Field label={t('accept.name')}>
            {(id) => (
              <Input
                id={id}
                autoComplete="name"
                defaultValue={info.data?.name ?? ''}
                onChange={(e) => setName(e.target.value)}
                required={kind === 'setup'}
              />
            )}
          </Field>
        )}
        {kind !== 'setup' && info.data?.email && (
          <p className="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">
            {info.data.email}
          </p>
        )}
        <Field label={t('accept.password')} hint={t('accept.passwordHint')}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label={t('accept.confirm')} error={mismatch ? t('accept.mismatch') : undefined}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={accept.isPending}>
          {t('accept.submit')}
        </Button>
      </form>
    </AuthShell>
  )
}
