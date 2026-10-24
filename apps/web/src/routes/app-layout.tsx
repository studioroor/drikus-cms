import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { LogOut, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Logo } from '@/components/logo'
import { api, unwrap } from '@/lib/api'
import { useMe } from '@/lib/queries'

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="rounded-lg px-3 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900"
      activeProps={{ className: 'bg-stone-100 !text-stone-900' }}
    >
      {children}
    </Link>
  )
}

export function AppLayout() {
  const { t } = useTranslation()
  const me = useMe()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const logout = useMutation({
    mutationFn: () => unwrap(api.auth.logout.$post()),
    onSettled: async () => {
      queryClient.clear()
      await navigate({ to: '/login', search: { redirect: undefined } })
    },
  })
  const isAdmin = me.role === 'superadmin'

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="mr-2 flex items-center gap-2">
            <Logo className="size-7" />
            <span className="hidden font-semibold tracking-tight sm:inline">Drikus CMS</span>
          </Link>
          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            <NavLink to="/">{t('nav.websites')}</NavLink>
            {isAdmin && (
              <>
                <NavLink to="/admin/users">{t('nav.users')}</NavLink>
                <NavLink to="/admin/sites">{t('nav.sites')}</NavLink>
                <NavLink to="/admin/activity">{t('nav.activity')}</NavLink>
              </>
            )}
          </nav>
          <Link
            to="/account"
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-stone-700 hover:bg-stone-100"
            title={t('nav.account')}
          >
            <UserRound className="size-4" />
            <span className="hidden max-w-40 truncate md:inline">{me.name}</span>
          </Link>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-900"
            title={t('nav.logout')}
            aria-label={t('nav.logout')}
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-stone-600">{subtitle}</p>}
      </div>
      {actions}
    </div>
  )
}
