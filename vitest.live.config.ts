import { defineConfig } from 'vitest/config'

// The live suite: real, simultaneous requests against the hosted project (database and Edge
// Functions). Run with `npm run test:live`. It is kept out of `npm test` because it needs the
// network and writes to the project's database (test accounts only).
export default defineConfig({
  test: {
    include: ['supabase/tests-live/**/*.live.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
    // One file at a time, one test at a time: the tests themselves create the concurrency.
    fileParallelism: false,
  },
})
