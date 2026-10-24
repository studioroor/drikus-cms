import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  useRouter,
} from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button } from './components/ui/button'
import { Card } from './components/ui/card'
import { EmptyState, FullPageSpinner } from './components/ui/feedback'
import { entriesQuery, entryQuery, revisionsQuery, siteContentQuery } from './lib/content'
import { setLocale } from './lib/i18n'
import {
  adminSitesQuery,
  adminUsersQuery,
  githubStatusQuery,
  meQuery,
  mySitesQuery,
  useErrorMessage,
} from './lib/queries'
import { AcceptPage } from './routes/accept'
import { AccountPage } from './routes/account'
import { ActivityPage, auditQuery } from './routes/admin/activity'
import { SitesPage } from './routes/admin/sites'
import { UsersPage } from './routes/admin/users'
import { AppLayout } from './routes/app-layout'
import { CollectionPage } from './routes/collection'
import { EntryPage, NewEntryPage } from './routes/entry'
import { HistoryPage } from './routes/history'
import { HomePage } from './routes/home'
import { LoginPage } from './routes/login'
import { SitePage, siteQuery } from './routes/site'

interface RouterContext {
  queryClient: QueryClient
}

function NotFound() {
  const { t } = useTranslation()
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState title={t('errors.not_found')}>
        <Link to="/" className="font-medium text-brand-700 hover:underline">
          {t('nav.websites')} →
        </Link>
      </EmptyState>
    </Card>
  )
}

function ErrorView({ error }: { error: unknown }) {
  const errorMessage = useErrorMessage()
  const { t } = useTranslation()
  const router = useRouter()
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState title={errorMessage(error)}>
        <Button variant="secondary" className="mt-3" onClick={() => router.invalidate()}>
          {t('common.back')}
        </Button>
      </EmptyState>
    </Card>
  )
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFound,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.ensureQueryData(meQuery)) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite',
  component: () => <AcceptPage kind="invite" />,
})
const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset',
  component: () => <AcceptPage kind="reset" />,
})
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: () => <AcceptPage kind="setup" />,
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.ensureQueryData(meQuery)
    if (!user) throw redirect({ to: '/login', search: { redirect: location.href } })
    setLocale(user.locale)
    if (user.mustEnableTotp && location.pathname !== '/account') throw redirect({ to: '/account' })
    return { user }
  },
  component: AppLayout,
  errorComponent: ErrorView,
})

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  loader: ({ context }) => context.queryClient.ensureQueryData(mySitesQuery),
  component: HomePage,
})

const siteRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/sites/$siteId',
  validateSearch: (search: Record<string, unknown>): { publish?: boolean } =>
    search.publish === true || search.publish === '1' || search.publish === 1
      ? { publish: true }
      : {},
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(siteQuery(params.siteId)),
      context.queryClient.fetchQuery(siteContentQuery(params.siteId)),
    ]),
  component: SitePage,
  errorComponent: ErrorView,
})

const collectionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/sites/$siteId/$collection',
  validateSearch: (
    search: Record<string, unknown>,
  ): { page?: number; sort?: string; dir?: 'asc' | 'desc' } => {
    const page = Number(search.page)
    return {
      page: Number.isInteger(page) && page > 1 && page < 100000 ? page : undefined,
      sort:
        typeof search.sort === 'string' && search.sort.length <= 100 && search.sort
          ? search.sort
          : undefined,
      dir: search.dir === 'asc' || search.dir === 'desc' ? search.dir : undefined,
    }
  },
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(siteQuery(params.siteId)),
      context.queryClient.ensureQueryData(siteContentQuery(params.siteId)),
      context.queryClient.fetchQuery(entriesQuery(params.siteId, params.collection)),
    ]),
  component: CollectionPage,
  errorComponent: ErrorView,
})

const newEntryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/sites/$siteId/$collection/new',
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(siteQuery(params.siteId)),
      context.queryClient.ensureQueryData(siteContentQuery(params.siteId)),
    ]),
  component: NewEntryPage,
  errorComponent: ErrorView,
})

const ITEM_PATH = /^[\w-]+(\.[\w-]+)*$/

const entryRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/sites/$siteId/$collection/edit/$slug',
  // The list item being edited, e.g. `services.1.packages.0`.
  validateSearch: (search: Record<string, unknown>): { item?: string } =>
    typeof search.item === 'string' && search.item.length <= 300 && ITEM_PATH.test(search.item)
      ? { item: search.item }
      : {},
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(siteQuery(params.siteId)),
      context.queryClient.ensureQueryData(siteContentQuery(params.siteId)),
      context.queryClient.fetchQuery(entryQuery(params.siteId, params.collection, params.slug)),
    ]),
  component: EntryPage,
  errorComponent: ErrorView,
})

const VERSION_ID = /^([0-9a-f]{40}|draft)$/
const versionParam = (v: unknown) => (typeof v === 'string' && VERSION_ID.test(v) ? v : undefined)

const historyRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/sites/$siteId/$collection/history/$slug',
  validateSearch: (search: Record<string, unknown>): { a?: string; b?: string } => ({
    a: versionParam(search.a),
    b: versionParam(search.b),
  }),
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(siteQuery(params.siteId)),
      context.queryClient.ensureQueryData(siteContentQuery(params.siteId)),
      // Always fresh: the editor may have saved since the entry was cached.
      context.queryClient.fetchQuery({
        ...entryQuery(params.siteId, params.collection, params.slug),
        staleTime: 0,
      }),
      context.queryClient.fetchQuery(revisionsQuery(params.siteId, params.collection, params.slug)),
    ]),
  component: HistoryPage,
  errorComponent: ErrorView,
})

const accountRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/account',
  component: AccountPage,
})

const adminRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin',
  beforeLoad: ({ context }) => {
    if (context.user.role !== 'superadmin') throw redirect({ to: '/' })
  },
})

const adminIndexRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/admin/users' })
  },
})

const adminUsersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/users',
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(adminUsersQuery),
      context.queryClient.ensureQueryData(adminSitesQuery),
    ]),
  component: UsersPage,
})

const adminSitesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/sites',
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(adminSitesQuery),
      context.queryClient.ensureQueryData(adminUsersQuery),
      context.queryClient.ensureQueryData(githubStatusQuery),
    ]),
  component: SitesPage,
})

const adminActivityRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/activity',
  loader: ({ context }) => context.queryClient.fetchQuery(auditQuery),
  component: ActivityPage,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  inviteRoute,
  resetRoute,
  setupRoute,
  appRoute.addChildren([
    homeRoute,
    siteRoute,
    collectionRoute,
    newEntryRoute,
    entryRoute,
    historyRoute,
    accountRoute,
    adminRoute.addChildren([adminIndexRoute, adminUsersRoute, adminSitesRoute, adminActivityRoute]),
  ]),
])

export function makeRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultPendingComponent: FullPageSpinner,
    defaultPendingMs: 300,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>
  }
}
