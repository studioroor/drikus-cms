import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/i18n'
import { ApiError } from './lib/api'
import { meQuery } from './lib/queries'
import { makeRouter } from './router'

// When the session expires mid-use, drop the cached user and go to the login page.
function onError(error: unknown) {
  if (
    error instanceof ApiError &&
    error.status === 401 &&
    queryClient.getQueryData(meQuery.queryKey)
  ) {
    queryClient.clear()
    router.navigate({ to: '/login', search: { redirect: window.location.pathname } })
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      retry: (count, error) =>
        !(error instanceof ApiError && error.status > 0 && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
})
const router = makeRouter(queryClient)

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
