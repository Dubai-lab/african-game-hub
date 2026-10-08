import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { QueryCache, QueryClient } from '@tanstack/react-query'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import i18n from '@/core/i18n'
import { toast } from '@/core/ui/toast'

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: {
      /** i18n key shown as a toast when the query fails after its retries. */
      errorKey?: string
      /** Never toast for this query; the screen handles its own missing data. */
      silent?: boolean
    }
  }
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (_error, query) => {
      // Only toast when there is nothing cached to show; background refetch failures stay quiet.
      if (query.state.data === undefined && !query.meta?.silent) {
        toast.error(i18n.t(query.meta?.errorKey ?? 'errors.loadFailed'))
      }
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: 30_000,
      // Kept for a day so the copy saved on the phone (below) is still usable when it is read back.
      // (Browser only: at build time, when the landing page is rendered to HTML, a day-long timer
      // would keep the build process from ever exiting.)
      gcTime: typeof window === 'undefined' ? Infinity : ONE_DAY_MS,
      retry: 2,
    },
    mutations: { retry: 0 },
  },
})

// Offline: what the player last saw of their own account is kept on the phone, so the app opens
// with their profile, wallet and history even with no connection, and refreshes when it is back.
// Only read-only views are kept. Nothing here is ever sent to the server or trusted by it, and
// it is wiped on logout (the cache is cleared, and the saved copy with it).
const KEPT_OFFLINE = new Set([
  'wallet', 'ledger', 'profile', 'ratings', 'rating', 'match-history', 'leaderboard',
  'game_types', 'countries', 'platform_settings',
])

if (typeof window !== 'undefined') {
  try {
    persistQueryClient({
      queryClient,
      persister: createSyncStoragePersister({ storage: window.localStorage, key: 'agh.cache', throttleTime: 1000 }),
      maxAge: ONE_DAY_MS,
      // Change this when the shape of cached data changes, so old copies are discarded.
      buster: 'v1',
      dehydrateOptions: {
        shouldDehydrateQuery: (query) => query.state.status === 'success' && KEPT_OFFLINE.has(String(query.queryKey[0])),
      },
    })
  } catch {
    // Storage blocked (private mode): the app simply works without the offline copy.
  }
}
