import { useMutation, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { type FormEvent, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Alert, Badge } from '@/components/ui/feedback'
import { Field, Input, Select } from '@/components/ui/field'
import { api, unwrap } from '@/lib/api'
import { type Locale, setLocale } from '@/lib/i18n'
import { meQuery, useErrorMessage, useMe } from '@/lib/queries'
import { PageHeader } from './app-layout'

function ProfileCard() {
  const { t } = useTranslation()
  const me = useMe()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const [name, setName] = useState(me.name)
  const [locale, setLocaleValue] = useState<Locale>(me.locale)

  const save = useMutation({
    mutationFn: () => unwrap(api.auth.me.$patch({ json: { name, locale } })),
    onSuccess: (res) => {
      queryClient.setQueryData(meQuery.queryKey, res.user)
      setLocale(res.user.locale)
    },
  })

  return (
    <Card>
      <CardHeader title={t('account.profile')} description={t('account.profileHint')} />
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        {save.isSuccess && <Alert tone="success">{t('common.saved')}</Alert>}
        <Field label={t('account.email')}>
          {(id) => <Input id={id} value={me.email} disabled />}
        </Field>
        <Field label={t('account.name')}>
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={100}
            />
          )}
        </Field>
        <Field label={t('account.language')}>
          {(id) => (
            <Select
              id={id}
              value={locale}
              onChange={(e) => setLocaleValue(e.target.value as Locale)}
            >
              <option value="nl">{t('language.nl')}</option>
              <option value="en">{t('language.en')}</option>
            </Select>
          )}
        </Field>
        <Button type="submit" loading={save.isPending}>
          {t('common.save')}
        </Button>
      </form>
    </Card>
  )
}

function PasswordCard() {
  const { t } = useTranslation()
  const me = useMe()
  const errorMessage = useErrorMessage()
  const [currentPassword, setCurrent] = useState('')
  const [newPassword, setNew] = useState('')

  const change = useMutation({
    mutationFn: () => unwrap(api.auth.password.$post({ json: { currentPassword, newPassword } })),
    onSuccess: () => {
      setCurrent('')
      setNew('')
    },
  })

  return (
    <Card>
      <CardHeader title={t('account.password')} description={t('account.passwordHint')} />
      <form
        className="space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault()
          change.mutate()
        }}
      >
        {change.error && <Alert>{errorMessage(change.error)}</Alert>}
        {change.isSuccess && <Alert tone="success">{t('account.changed')}</Alert>}
        <input type="email" autoComplete="username" value={me.email} readOnly hidden />
        <Field label={t('account.current')}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label={t('account.new')} hint={t('accept.passwordHint')}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
              required
            />
          )}
        </Field>
        <Button type="submit" loading={change.isPending}>
          {t('account.change')}
        </Button>
      </form>
    </Card>
  )
}

function TotpCard() {
  const { t } = useTranslation()
  const me = useMe()
  const queryClient = useQueryClient()
  const errorMessage = useErrorMessage()
  const [step, setStep] = useState<'idle' | 'password' | 'scan'>('idle')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [qr, setQr] = useState<string>()

  const setup = useMutation({
    mutationFn: () => unwrap(api.auth.totp.setup.$post({ json: { password } })),
    onSuccess: () => {
      setPassword('')
      setStep('scan')
    },
  })
  const enable = useMutation({
    mutationFn: () => unwrap(api.auth.totp.enable.$post({ json: { code } })),
    onSuccess: (res) => {
      queryClient.setQueryData(meQuery.queryKey, res.user)
      setStep('idle')
      setCode('')
    },
  })
  const disable = useMutation({
    mutationFn: () => unwrap(api.auth.totp.disable.$post({ json: { password, code } })),
    onSuccess: (res) => {
      queryClient.setQueryData(meQuery.queryKey, res.user)
      setPassword('')
      setCode('')
      setStep('idle')
    },
  })

  const uri = setup.data?.uri
  useEffect(() => {
    if (uri) QRCode.toDataURL(uri, { margin: 1, width: 200 }).then(setQr)
  }, [uri])

  const submit = (e: FormEvent, action: () => void) => {
    e.preventDefault()
    action()
  }
  const error = setup.error ?? enable.error ?? disable.error
  const canDisable = me.totpEnabled && me.role !== 'superadmin'

  return (
    <Card>
      <CardHeader
        title={t('account.totp.title')}
        description={t('account.totp.hint')}
        actions={
          <Badge tone={me.totpEnabled ? 'green' : 'neutral'}>
            {me.totpEnabled ? t('account.totp.enabled') : t('account.totp.disabled')}
          </Badge>
        }
      />
      <div className="space-y-4 p-5">
        {me.mustEnableTotp && <Alert tone="info">{t('account.totp.mustEnable')}</Alert>}
        {error && <Alert>{errorMessage(error)}</Alert>}
        {enable.isSuccess && me.totpEnabled && (
          <Alert tone="success">{t('account.totp.enabledNow')}</Alert>
        )}

        {!me.totpEnabled && step === 'idle' && (
          <Button onClick={() => setStep('password')}>{t('account.totp.start')}</Button>
        )}

        {!me.totpEnabled && step === 'password' && (
          <form className="space-y-4" onSubmit={(e) => submit(e, () => setup.mutate())}>
            <input type="email" autoComplete="username" value={me.email} readOnly hidden />
            <Field label={t('account.totp.confirmPassword')}>
              {(id) => (
                <Input
                  id={id}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                />
              )}
            </Field>
            <div className="flex gap-2">
              <Button type="submit" loading={setup.isPending}>
                {t('account.totp.continue')}
              </Button>
              <Button variant="ghost" onClick={() => setStep('idle')}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        )}

        {!me.totpEnabled && step === 'scan' && setup.data && (
          <form className="space-y-4" onSubmit={(e) => submit(e, () => enable.mutate())}>
            <p className="text-sm text-stone-700">{t('account.totp.scan')}</p>
            {qr && (
              <img
                src={qr}
                alt=""
                width={200}
                height={200}
                className="rounded-lg border border-stone-200"
              />
            )}
            <div>
              <p className="text-sm text-stone-500">{t('account.totp.manual')}</p>
              <code className="mt-1 block break-all rounded-lg bg-stone-100 px-3 py-2 font-mono text-sm">
                {setup.data.secret}
              </code>
            </div>
            <Field label={t('account.totp.code')}>
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  className="max-w-40 font-mono tracking-widest"
                />
              )}
            </Field>
            <Button type="submit" loading={enable.isPending}>
              {t('account.totp.enable')}
            </Button>
          </form>
        )}

        {canDisable && step === 'idle' && (
          <Button variant="secondary" onClick={() => setStep('password')}>
            {t('account.totp.turnOff')}
          </Button>
        )}
        {canDisable && step === 'password' && (
          <form className="space-y-4" onSubmit={(e) => submit(e, () => disable.mutate())}>
            <p className="text-sm text-stone-600">{t('account.totp.turnOffHint')}</p>
            <input type="email" autoComplete="username" value={me.email} readOnly hidden />
            <Field label={t('account.current')}>
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
            <Field label={t('account.totp.code')}>
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  className="max-w-40 font-mono tracking-widest"
                />
              )}
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="danger" loading={disable.isPending}>
                {t('account.totp.turnOff')}
              </Button>
              <Button variant="ghost" onClick={() => setStep('idle')}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Card>
  )
}

export function AccountPage() {
  const { t } = useTranslation()
  const me = useMe()
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={t('account.title')} />
      <div className="space-y-6">
        {/* Fixed slots keep TotpCard mounted (and its success state) once 2FA gets enabled. */}
        {!me.mustEnableTotp && <ProfileCard />}
        {!me.mustEnableTotp && <PasswordCard />}
        <TotpCard />
      </div>
    </div>
  )
}
