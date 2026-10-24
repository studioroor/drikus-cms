import { queryOptions, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError, api, unwrap } from './api'

const fetchMe = () => unwrap(api.auth.me.$get()).then((r) => r.user)
const fetchMySites = () => unwrap(api.sites.$get()).then((r) => r.sites)
const fetchAdminUsers = () => unwrap(api.admin.users.$get()).then((r) => r.users)
const fetchAdminSites = () => unwrap(api.admin.sites.$get()).then((r) => r.sites)
const fetchGithubStatus = () => unwrap(api.admin.github.$get())
const fetchGithubRepos = (refresh = false) =>
  unwrap(api.admin.github.repos.$get({ query: refresh ? { refresh: '1' } : {} })).then(
    (r) => r.repos,
  )

export type Me = NonNullable<Awaited<ReturnType<typeof fetchMe>>>
export type AdminUser = Awaited<ReturnType<typeof fetchAdminUsers>>[number]
export type AdminSite = Awaited<ReturnType<typeof fetchAdminSites>>[number]
export type GithubStatus = Awaited<ReturnType<typeof fetchGithubStatus>>
export type GithubRepo = Awaited<ReturnType<typeof fetchGithubRepos>>[number]

export const meQuery = queryOptions({ queryKey: ['me'], queryFn: fetchMe, staleTime: 60_000 })
export const mySitesQuery = queryOptions({ queryKey: ['sites'], queryFn: fetchMySites })
export const adminUsersQuery = queryOptions({
  queryKey: ['admin', 'users'],
  queryFn: fetchAdminUsers,
})
export const adminSitesQuery = queryOptions({
  queryKey: ['admin', 'sites'],
  queryFn: fetchAdminSites,
})

export const githubStatusQuery = queryOptions({
  queryKey: ['admin', 'github'],
  queryFn: fetchGithubStatus,
})
export const githubReposQuery = queryOptions({
  queryKey: ['admin', 'github', 'repos'],
  queryFn: () => fetchGithubRepos(),
})
export { fetchGithubRepos }

/** The signed-in user; only use below the authenticated layout. */
export function useMe(): Me {
  const { data } = useQuery(meQuery)
  if (!data) throw new Error('useMe used outside the authenticated layout')
  return data
}

export function useErrorMessage() {
  const { t } = useTranslation()
  return (error: unknown) => {
    const code =
      error instanceof ApiError
        ? error.code
        : typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'default'
    const key = `errors.${code}` as 'errors.default'
    return t(key, { defaultValue: t('errors.default') })
  }
}
