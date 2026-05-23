# @svelte-atproto/sv

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
