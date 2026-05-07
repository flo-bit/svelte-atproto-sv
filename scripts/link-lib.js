#!/usr/bin/env node
// Patches demo/package.json to resolve `@svelte-atproto/oauth` to a local
// checkout instead of the published npm version. Useful when iterating on
// both packages at once.
//
// Default path: ../../svelte-atproto-oauth (sibling clone)
// Override:    ATPROTO_OAUTH_LIB_PATH=/abs/or/relative/path pnpm demo:link-lib
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const demoPkgPath = resolve(here, '..', 'demo', 'package.json');
const libPath = process.env.ATPROTO_OAUTH_LIB_PATH
	? resolve(process.env.ATPROTO_OAUTH_LIB_PATH)
	: resolve(here, '..', '..', 'svelte-atproto-oauth');

if (!existsSync(demoPkgPath)) {
	console.error('demo/package.json not found — run `pnpm demo:reset && pnpm demo:add` first.');
	process.exit(1);
}

if (!existsSync(libPath)) {
	console.error(`lib not found at ${libPath}`);
	console.error('clone https://github.com/flo-bit/svelte-atproto-oauth as a sibling, or set ATPROTO_OAUTH_LIB_PATH.');
	process.exit(1);
}

const pkg = JSON.parse(readFileSync(demoPkgPath, 'utf8'));
pkg.dependencies ??= {};
pkg.dependencies['@svelte-atproto/oauth'] = `file:${libPath}`;
pkg.pnpm ??= {};
pkg.pnpm.overrides = { ...pkg.pnpm.overrides, '@svelte-atproto/oauth': `file:${libPath}` };

writeFileSync(demoPkgPath, JSON.stringify(pkg, null, '\t') + '\n');
console.log(`linked @svelte-atproto/oauth → ${libPath}`);
