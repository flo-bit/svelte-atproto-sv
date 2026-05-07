# `@svelte-atproto/sv`

[`sv`](https://svelte.dev/docs/cli/overview) community add-on that scaffolds [`@svelte-atproto/oauth`](https://www.npmjs.com/package/@svelte-atproto/oauth) into a SvelteKit project — atproto OAuth in one prompt-driven step.

```sh
npx sv add @svelte-atproto
```

(The full form `npx sv add @svelte-atproto/sv` works too — the `@scope/sv` shortcut applies.)

> [!IMPORTANT]
> Svelte maintainers have not reviewed community add-ons for malicious code. Use at your discretion.

## What you get

After `pnpm install` + `pnpm atproto:setup`, you have:

```
src/
├── hooks.server.ts                        # 2 lines: mounts atproto.handle
├── app.d.ts                               # App.Locals augmented with did/session/client
├── lib/atproto/
│   ├── index.ts                           # createAtprotoAuth config (≈ 12 lines)
│   └── oauth.remote.ts                    # only when demo style = remote
└── routes/demo/atproto/                   # only when demo != none
    ├── +page.svelte
    ├── +page.server.ts
    └── login/{+page.svelte,+page.server.ts}
```

Plus three npm scripts (`atproto:setup`, `atproto:keygen`, `atproto:secret`) that wrap the lib's CLI for `.env` generation.

## Prompts

### `storage` — where OAuth sessions live

| Value | Notes |
|---|---|
| `memory` | dev-only — sessions lost on restart |
| `cloudflare` | use with `@sveltejs/adapter-cloudflare` (KV bindings) |
| `upstash` | edge-compatible (Vercel/Netlify/CF), HTTP-based |
| `none` | wire your own `Store` |

### `demo` — what to scaffold at `/demo/atproto`

| Value | Notes |
|---|---|
| `none` | no demo (default) |
| `login` | minimal sign-in / sign-out flow |
| `statusphere` | publishes `xyz.statusphere.status` records, lists recent statuses globally via UFO. Auto-upgrades the OAuth scope. |

### `demoStyle` — how the demo wires its actions (asked iff `demo != none`)

| Value | Notes |
|---|---|
| `form` | SvelteKit form actions (stable, recommended) |
| `remote` | experimental SvelteKit remote functions; adds `kit.experimental.remoteFunctions: true` to `svelte.config.js` and a `valibot` dep |

## Pass options non-interactively

```sh
npx sv add @svelte-atproto=storage:cloudflare+demo:statusphere+demoStyle:form
```

Booleans use `yes`/`no`. Selects use the value directly.

## What happens after scaffolding

```sh
pnpm install            # pulls @svelte-atproto/oauth + valibot (if remote demo)
pnpm atproto:setup      # writes COOKIE_SECRET + CLIENT_ASSERTION_KEY into .env
pnpm dev                # OAuth metadata + jwks + callback all served by atproto.handle
```

Visit `/demo/atproto` if you scaffolded a demo; sign in with any handle on a real PDS.

`atproto-oauth setup` is idempotent — re-running won't clobber existing values. For production, pipe the same generators into your secrets manager:

```sh
pnpm atproto:secret | wrangler secret put COOKIE_SECRET
pnpm atproto:keygen | wrangler secret put CLIENT_ASSERTION_KEY
```

## What it doesn't scaffold

- A global `+layout.server.ts` — auth state lives on `event.locals.{ did, session, client }`. Per-route loads pass it forward as needed (see the demo's `+page.server.ts`).
- A login UI component — `import { login, logout } from '@svelte-atproto/oauth/client'` and call them from your own buttons / forms.
- A `wrangler.jsonc` patch for KV bindings (yet) — if you picked `storage: cloudflare`, you still need to add the bindings yourself. Coming in a future release.

## Vite host pin

The addon adds `server: { host: '127.0.0.1' }` to `vite.config.ts/.js`. OAuth loopback (RFC 8252 §7.3) requires the literal IPv4 loopback, not the hostname `localhost` — without this pin the PDS callback to `127.0.0.1:5173` gets `ECONNREFUSED` on systems where `localhost` resolves to `::1`.

## Local development of this add-on

```sh
pnpm demo:reset                          # rm -rf demo && fresh sv create
pnpm demo:add:statusphere-form           # cloudflare + statusphere + form actions
pnpm demo:add:statusphere-remote         # cloudflare + statusphere + remote functions
pnpm demo:add:login-form                 # memory + login demo + form actions
pnpm demo:add:login-remote               # memory + login demo + remote functions
pnpm demo:add:bare                       # memory + no demo
pnpm demo:add                            # interactive prompts
pnpm demo:link-lib                       # link demo to a local @svelte-atproto/oauth checkout
pnpm demo:run                            # cd demo && pnpm install && pnpm atproto:setup && pnpm dev
```

`demo:link-lib` defaults to a sibling clone at `../../svelte-atproto-oauth`. Override with `ATPROTO_OAUTH_LIB_PATH=/abs/path pnpm demo:link-lib` if your checkouts live elsewhere.

```sh
pnpm test                # vitest — covers 3 option combos × kit-ts & kit-js
```

The test suite injects `pnpm.overrides` to point at a local lib checkout when one exists (sibling dir or `ATPROTO_OAUTH_LIB_PATH`); otherwise it resolves `@svelte-atproto/oauth` from npm — which is what CI does, so CI exercises the real published version end-to-end.

## Status

Pre-1.0. The `sv` add-on API itself is also still experimental — see [Svelte's add-on docs](https://svelte.dev/docs/cli/community).

Issues + PRs welcome at <https://github.com/flo-bit/svelte-atproto-sv>.

## License

MIT
