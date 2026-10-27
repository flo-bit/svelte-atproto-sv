---
"@svelte-atproto/sv": minor
---

Support sv 1.1.1 and sv-utils 1.0.2, replacing the previous sv 0.15 peer range. Update scaffolded atcute dependencies, Playwright, build tooling, and transitive dependencies. Declare lexicons directly for browser demos, import server auth types through the OAuth entry point, and use the known repository DID rather than assuming parsed AT URI authorities are always DIDs. Keep Vitest 4 and Changesets 2; integration tests now exercise the built addon and use context-bound Vitest assertions in concurrent tests.

Support SvelteKit 3 alongside Kit 2: generate explicit `#lib` subpath imports, declare private environment variables in `src/env.*`, and use Kit 3's named environment imports. Enable remote functions in both legacy `svelte.config.*` files and inline `sveltekit({...})` Vite configuration, preserving existing options. Test 9 option combinations across both Kit majors and JS/TS with type checks, production builds, and HTTP preview smoke tests, plus config regression tests.

Use pnpm as the canonical dependency manager and remove the stale npm lockfile. Publish the accompanying OAuth 0.4.1 update before this addon release.
