import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/field'
import { api, unwrap } from '@/lib/api'
import { setLocale } from '@/lib/i18n'
import { meQuery, useErrorMessage } from '@/lib/queries'
import { AuthShell } from './auth-shell'

export function LoginPage() {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { redirect } = useSearch({ from: '/login' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [needsCode, setNeedsCode] = useState(false)

  const login = useMutation({
    mutationFn: () =>
      unwrap(api.auth.login.$post({ json: { email, password, ...(needsCode ? { code } : {}) } })),
    onSuccess: async (res) => {
      if (res.status === 'totp_required') {
        setNeedsCode(true)
        return
      }
      setLocale(res.user.locale)
      queryClient.setQueryData(meQuery.queryKey, res.user)
      // Only follow same-app relative redirects.
      const target = redirect?.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
      await navigate({ to: target })
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate()
  }

  if (needsCode) {
    return (
      <AuthShell title={t('login.codeTitle')} subtitle={t('login.codeHint')}>
        <form onSubmit={submit} className="space-y-4">
          {login.error && <Alert>{errorMessage(login.error)}</Alert>}
          <Field label={t('login.code')}>
            {(id) => (
              <Input
                id={id}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                autoFocus
                required
                className="text-center font-mono text-xl tracking-[0.4em]"
              />
            )}
          </Field>
          <Button type="submit" size="lg" className="w-full" loading={login.isPending}>
            {t('login.verify')}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              setNeedsCode(false)
              setCode('')
              login.reset()
            }}
          >
            {t('common.back')}
          </Button>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={t('login.title')} subtitle={t('login.subtitle')}>
      <form onSubmit={submit} className="space-y-4">
        {login.error && <Alert>{errorMessage(login.error)}</Alert>}
        <Field label={t('login.email')}>
          {(id) => (
            <Input
              id={id}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          )}
        </Field>
        <Field label={t('login.password')}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full" loading={login.isPending}>
          {t('login.submit')}
        </Button>
        <p className="text-center text-sm text-stone-500">{t('login.forgot')}</p>
      </form>
    </AuthShell>
  )
}
