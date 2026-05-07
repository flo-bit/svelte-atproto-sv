# [sv](https://svelte.dev/docs/cli/overview) community add-on: `@svelte-atproto/sv`

> [!IMPORTANT]
> Svelte maintainers have not reviewed community add-ons for malicious code. Use at your discretion.

Scaffolds [`@svelte-atproto/oauth`](https://www.npmjs.com/package/@svelte-atproto/oauth) into a SvelteKit project — atproto OAuth with one config file and a hook.

## Usage

```shell
npx sv add @svelte-atproto
```

(The full name `npx sv add @svelte-atproto/sv` works too — the `@scope/sv` shortcut applies.)

## Options

### `storage`

Where to keep OAuth sessions and states. Configure on your config: `cloudflare`, `upstash`, `memory`, or `none` (you wire it yourself).

### `bsky` (boolean)

If `yes`, scaffolds the layout to load Bluesky profiles via `bskyProfile()` and types `App.PageData['profile']` as `BskyProfile`. If `no`, profiles stay `null` until you wire your own `loadProfile`.

### `demo`

- `form` — scaffolds `/demo/atproto/{login,}` using SvelteKit form actions. Stable, recommended.
- `remote` — uses experimental SvelteKit remote functions. Adds `kit.experimental.remoteFunctions: true` to `svelte.config.js` and a `valibot` dep.
- `none` — no demo files.

## Pass options non-interactively

```shell
npx sv add @svelte-atproto=storage:cloudflare+bsky:yes+demo:form
```

## Local development of this add-on

The repo ships scripts to test combinations against a fresh sv-create demo project that links to the sibling `@svelte-atproto/oauth` library:

```shell
pnpm demo:reset                # delete + recreate the `demo/` SvelteKit project
pnpm demo:add:cf-form          # invoke this addon with cloudflare + form-actions demo
pnpm demo:add:cf-remote        # cloudflare + remote-functions demo
pnpm demo:add:upstash-form     # upstash + form-actions demo
pnpm demo:add:memory-bare      # memory store, no bsky, no demo
pnpm demo:add                  # interactive prompts

pnpm demo:link-lib             # patch demo/package.json to use the local sibling lib
pnpm demo:run                  # cd demo && pnpm install && pnpm atproto:setup && pnpm dev
```

A typical loop after editing the addon:

```shell
pnpm demo:reset && pnpm demo:add:cf-remote && pnpm demo:link-lib && pnpm demo:run
```

Run the test suite with `pnpm test` (covers cloudflare-form / memory-remote / upstash-no-demo across kit-ts and kit-js variants).
