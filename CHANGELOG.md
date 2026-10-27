# @svelte-atproto/sv

## 0.2.0

### Minor Changes

- 96d1716: Support sv 1.1.1 and sv-utils 1.0.2, replacing the previous sv 0.15 peer range. Update scaffolded atcute dependencies, Playwright, build tooling, and transitive dependencies. Declare lexicons directly for browser demos, import server auth types through the OAuth entry point, and use the known repository DID rather than assuming parsed AT URI authorities are always DIDs. Keep Vitest 4 and Changesets 2; integration tests now exercise the built addon and use context-bound Vitest assertions in concurrent tests.

  Support SvelteKit 3 alongside Kit 2: generate explicit `#lib` subpath imports, declare private environment variables in `src/env.*`, and use Kit 3's named environment imports. Enable remote functions in both legacy `svelte.config.*` files and inline `sveltekit({...})` Vite configuration, preserving existing options. Test 9 option combinations across both Kit majors and JS/TS with type checks, production builds, and HTTP preview smoke tests, plus config regression tests.

  Use pnpm as the canonical dependency manager and remove the stale npm lockfile. Publish the accompanying OAuth 0.4.1 update before this addon release.

### Patch Changes

- 96d1716: Require OAuth 0.4.1, including state-bound return paths, corrected cookie delivery from intercepted hook responses, and Kit 3 compatibility. Both generated login pages now validate return paths with OAuth's `safeReturnTo` instead of an inline copy, rejecting backslash/open-redirect tricks, encoded control characters, and malformed escapes while preserving valid path/query encoding. Publish OAuth 0.4.1 before this addon release.

## 0.1.1

### Patch Changes

- 659d9c4: Scaffold against the new atcute majors. Bumps the pinned `@svelte-atproto/oauth` to `^0.3.0` (the version that depends on atcute v4/v5) and the scaffolded `@atcute/atproto` dependency to `^4.0.0`, which keeps the lexicon augmentation aligned with `@atcute/client` v5.

## 0.1.0

### Minor Changes

- 62bbfa8: Add browser-only OAuth mode + bump scaffolded `@svelte-atproto/oauth` to `^0.1.0`.

  **New `mode` prompt** — pick `server` (confidential client, KV/Redis sessions) or `browser` (static-site, localStorage). The `storage` and `demoStyle` prompts are conditional on `server` mode.

  **Browser-mode scaffold:**

  - `src/lib/atproto/index.ts` — `createAtprotoBrowserAuth({ origin, scope, redirectPath, ... })`, with auto-upgraded scope when the statusphere demo is selected
  - `src/routes/oauth-client-metadata.json/+server.ts` — prerendered metadata route (the only thing a static deploy needs to serve)
  - `src/routes/+layout.svelte` — patched with `onMount(() => atproto.init())`
  - No `hooks.server.ts`, no `app.d.ts` augmentation, no `.env.example`, no `atproto:setup` script, no remote functions
  - Demo (`/demo/atproto`, `/demo/atproto/login`) is fully client-side (`$user.client.post(...)` for the statusphere write); `redirectPath` is set to `/demo/atproto` so the round-trip lands users on the demo page

  **Server-mode improvements (also affects existing users on regenerate):**

  - Adds `@atcute/atproto` as a direct user dep + `import '@atcute/atproto';` side-effect import to `src/lib/atproto/index.ts`. Without this, `locals.client` was silently typing as `any` because TS couldn't resolve `Client` from the user's package set, hiding the missing lexicon augmentation. Now `client.post('com.atproto.repo.putRecord', ...)` actually type-checks.

  **Demo polish:**

  - Browser-mode statusphere demo header reads `Hi <handle>` (resolved via slingshot) instead of raw DID — `loadHandles` batch already covered firehose authors, the user's own DID rides along.
  - Login-only browser demo resolves the signed-in DID to a handle.

## 0.0.2

### Patch Changes

- f0a7533: Initial public release. Scaffolds `@svelte-atproto/oauth` into a SvelteKit project with prompt-driven choices for session storage (cloudflare KV / upstash redis / memory / none) and an optional demo flow (`login` or `statusphere`, in either form-actions or remote-functions style).
