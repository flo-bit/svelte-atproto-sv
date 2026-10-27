import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import addon from '../dist/index.mjs';
import { js, svelteConfig } from '../dist/sv-utils.mjs';
import { prepareKit2, verifyApp } from './setup/compatibility.js';
import { setupTest } from './setup/suite.js';

const browser = false;

// Tests inject @svelte-atproto/oauth via pnpm.overrides so we test against
// the local lib checkout (or, in CI, against npm via no override).
// - If ATPROTO_OAUTH_LIB_PATH is set, use that (cross-repo dev).
// - Else if a sibling ../../svelte-atproto-oauth dir exists, use that.
// - Else, leave it unoverridden — tests will resolve from npm.
const LIB_PATH = (() => {
	if (process.env.ATPROTO_OAUTH_LIB_PATH) {
		return path.resolve(process.env.ATPROTO_OAUTH_LIB_PATH);
	}
	const sibling = path.resolve(
		fileURLToPath(new URL('.', import.meta.url)),
		'../../svelte-atproto-oauth'
	);
	return fs.existsSync(sibling) ? sibling : null;
})();

let workspacePatched = false;

const { test, testCases } = setupTest(
	{ addon },
	{
		preAdd: ({ cwd: testCaseCwd, addonTestCase }) => {
			if (addonTestCase.kind.kitMajor === 2) prepareKit2(testCaseCwd);
			// If a local lib checkout is available, override the scaffolded
			// dep at the workspace root to point at it. Otherwise, let pnpm
			// resolve `@svelte-atproto/oauth` from the npm registry.
			if (workspacePatched || !LIB_PATH) return;
			const root = path.dirname(testCaseCwd);
			const pkgPath = path.join(root, 'package.json');
			const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
			pkg.pnpm = { overrides: { '@svelte-atproto/oauth': `file:${LIB_PATH}` } };
			fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
			workspacePatched = true;
		},
		kinds: [
			{
				type: 'server-cloudflare-statusphere-form',
				options: {
					[addon.id]: {
						mode: 'server',
						storage: 'cloudflare',
						demo: 'statusphere',
						demoStyle: 'form'
					}
				}
			},
			{
				type: 'server-memory-login-remote',
				options: {
					[addon.id]: {
						mode: 'server',
						storage: 'memory',
						demo: 'login',
						demoStyle: 'remote'
					}
				}
			},
			{
				type: 'server-memory-statusphere-remote',
				options: {
					[addon.id]: {
						mode: 'server', storage: 'memory', demo: 'statusphere', demoStyle: 'remote'
					}
				}
			},
			{
				type: 'server-upstash-no-demo',
				options: {
					[addon.id]: { mode: 'server', storage: 'upstash', demo: 'none' }
				}
			},
			{
				type: 'browser-statusphere',
				options: {
					[addon.id]: { mode: 'browser', demo: 'statusphere' }
				}
			},
			{
				type: 'server-memory-login-form',
				options: {
					[addon.id]: { mode: 'server', storage: 'memory', demo: 'login', demoStyle: 'form' }
				}
			},
			{
				type: 'server-none-no-demo',
				options: {
					[addon.id]: { mode: 'server', storage: 'none', demo: 'none' }
				}
			},
			{
				type: 'browser-login',
				options: {
					[addon.id]: { mode: 'browser', demo: 'login' }
				}
			},
			{
				type: 'browser-no-demo',
				options: {
					[addon.id]: { mode: 'browser', demo: 'none' }
				}
			}
		].flatMap((kind) => [2, 3].map((kitMajor) => ({
			...kind,
			type: `kit${kitMajor}-${kind.type}`,
			kitMajor
		}))),
		filter: (testCase) => testCase.variant.includes('kit'),
		browser
	}
);

test.concurrent.for(testCases)(
	'@svelte-atproto/sv $kind.type $variant',
	// Concurrent tests must use the context-bound expect so assertions are attributed correctly.
	async (testCase, { expect, ...ctx }) => {
		const cwd = ctx.cwd(testCase);
		const opts = testCase.kind.options[addon.id];
		const kitMajor = testCase.kind.kitMajor;
		const remoteImport = kitMajor === 3 ? '#lib/atproto/oauth.remote.js' : '$lib/atproto/oauth.remote';
		// Assertions alone missed broken Kit 3 imports. Check and build every
		// scaffold (including JS variants, forms, remote functions and browser mode).
		await verifyApp(cwd, opts);

		const atproto = read(cwd, 'src/lib/atproto/index.ts');
		const pkg = JSON.parse(read(cwd, 'package.json'));

		// Vite config (.ts or .js depending on variant) is patched to bind 127.0.0.1 — both modes
		const viteTs = path.resolve(cwd, 'vite.config.ts');
		const viteJs = path.resolve(cwd, 'vite.config.js');
		const vitePath = fs.existsSync(viteTs) ? viteTs : viteJs;
		const vite = fs.readFileSync(vitePath, 'utf8');
		expect(vite).toContain("host: '127.0.0.1'");

		expect(pkg.dependencies?.['@svelte-atproto/oauth']).toBe('^0.4.1');
		expect(pkg.devDependencies['@sveltejs/kit']).toMatch(new RegExp(`^\\^${kitMajor}\\.`));
		expect(pkg.dependencies?.['@atcute/atproto']).toBe('^4.0.4');
		expect(pkg.dependencies?.['@atcute/lexicons']).toBe('^2.1.1');

		// =================================================================
		// Browser mode
		// =================================================================
		if (opts.mode === 'browser') {
			expect(atproto).toContain('createAtprotoBrowserAuth');
			expect(atproto).not.toContain('createAtprotoAuth(');
			if (opts.demo === 'statusphere') {
				expect(atproto).toContain("scope: 'atproto repo:xyz.statusphere.status'");
			} else {
				expect(atproto).toContain("scope: 'atproto'");
			}

			// Browser mode: no hooks.server.ts, no app.d.ts changes, no .env.example
			expect(fs.existsSync(path.resolve(cwd, 'src/hooks.server.ts'))).toBe(false);
			expect(pkg.scripts?.['atproto:setup']).toBeUndefined();

			// Metadata route IS scaffolded
			const metadata = read(cwd, 'src/routes/oauth-client-metadata.json/+server.ts');
			expect(metadata).toContain('atproto.metadata');
			expect(metadata).toContain('prerender = true');

			// +layout.svelte is patched with onMount(init)
			const layout = read(cwd, 'src/routes/+layout.svelte');
			expect(layout).toContain('atproto.init');

			const demoDir = path.resolve(cwd, 'src/routes/demo/atproto');
			if (opts.demo === 'none') {
				expect(fs.existsSync(demoDir)).toBe(false);
				return;
			}

			expect(fs.existsSync(demoDir)).toBe(true);
			// Browser demo: no +page.server.ts files (everything client-side)
			expect(fs.existsSync(path.resolve(demoDir, '+page.server.ts'))).toBe(false);
			expect(fs.existsSync(path.resolve(demoDir, 'login/+page.server.ts'))).toBe(false);

			const indexPage = read(cwd, 'src/routes/demo/atproto/+page.svelte');
			expect(indexPage).toContain('atproto.logout');
			expect(indexPage).toContain('$user');

			const loginPage = read(cwd, 'src/routes/demo/atproto/login/+page.svelte');
			expect(loginPage).toContain('atproto.login');
			expect(loginPage).toContain('$user');

			if (opts.demo === 'statusphere') {
				expect(indexPage).toContain('com.atproto.repo.putRecord');
				expect(indexPage).toContain('recentRecords');
				expect(indexPage).toContain('loadHandles');
			}
			return;
		}

		// =================================================================
		// Server mode
		// =================================================================
		expect(atproto).toContain('createAtprotoAuth');
		expect(atproto).toContain(kitMajor === 3 ? "from '$app/env/private'" : "from '$env/dynamic/private'");
		if (kitMajor === 3) {
			expect(atproto).not.toContain('env.ORIGIN');
			const envFile = read(cwd, `src/env.${testCase.variant === 'kit-ts' ? 'ts' : 'js'}`);
			for (const name of ['ORIGIN', 'COOKIE_SECRET', 'CLIENT_ASSERTION_KEY',
				...(opts.storage === 'upstash' ? ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] : [])]) {
				expect(envFile).toContain(`${name}:`);
			}
		} else {
			expect(atproto).toContain('env.ORIGIN');
		}
		expect(atproto).not.toContain('OAUTH_PUBLIC_URL');
		// no real signupPDS field (the file does have an "// add signupPDS: …" hint comment)
		expect(atproto).not.toMatch(/^\s*signupPDS:/m);

		// Statusphere upgrades the scope to include repo write access
		if (opts.demo === 'statusphere') {
			expect(atproto).toContain("scope: 'atproto repo:xyz.statusphere.status'");
		} else {
			expect(atproto).toContain("scope: 'atproto'");
		}

		if (opts.storage === 'cloudflare') {
			expect(atproto).toContain('cloudflareKV');
			expect(atproto).toContain("'OAUTH_SESSIONS'");
		}
		if (opts.storage === 'upstash') {
			expect(atproto).toContain('upstashRedis');
			expect(atproto).toContain('UPSTASH_REDIS_REST_URL');
		}

		const hooks = read(cwd, 'src/hooks.server.ts');
		expect(hooks).toContain('export const handle = atproto.handle');

		// No global +layout.server.ts — auth state flows per-page via load functions.
		expect(fs.existsSync(path.resolve(cwd, 'src/routes/+layout.server.ts'))).toBe(false);

		const appDts = read(cwd, 'src/app.d.ts');
		expect(appDts).toContain('Locals');
		expect(appDts).toContain("from '@svelte-atproto/oauth/server'");
		expect(appDts).not.toContain("from '@atcute/oauth-node-client'");
		// No PageData augmentation — auth lives on event.locals, not page.data.
		expect(appDts).not.toContain('AtprotoPageData');
		expect(appDts).not.toContain('BskyProfile');

		const env = read(cwd, '.env.example');
		expect(env).toContain('ORIGIN=');
		expect(env).toContain('COOKIE_SECRET=');
		if (opts.storage === 'upstash') expect(env).toContain('UPSTASH_REDIS_REST_URL=');

		expect(pkg.scripts?.['atproto:setup']).toContain('atproto-oauth setup');

		// Demo files
		const demoDir = path.resolve(cwd, 'src/routes/demo/atproto');
		const remoteFile = path.resolve(cwd, 'src/lib/atproto/oauth.remote.ts');

		if (opts.demo === 'none') {
			expect(fs.existsSync(demoDir)).toBe(false);
			expect(fs.existsSync(remoteFile)).toBe(false);
			return;
		}

		expect(fs.existsSync(demoDir)).toBe(true);
		const indexServer = read(cwd, 'src/routes/demo/atproto/+page.server.ts');
		expect(indexServer).toContain('returnTo');
		expect(indexServer).toContain('/demo/atproto/login');
		// Per-page load reads locals.did + returns it to data
		expect(indexServer).toContain('locals.did');
		if (opts.demo === 'statusphere') {
			expect(indexServer).toContain('const ownDid = locals.did');
			expect(indexServer).toContain('did: ownDid');
			expect(indexServer).not.toContain('did: parts?.repo');
		}

		const loginServer = read(cwd, 'src/routes/demo/atproto/login/+page.server.ts');
		expect(loginServer).toContain(
			"import { safeReturnTo as safeLocalPath } from '@svelte-atproto/oauth/permissions';"
		);
		expect(loginServer).toContain('return safeLocalPath(value) ?? DEFAULT_RETURN_TO;');
		expect(loginServer).not.toContain('decodeURIComponent');

		// Always uses loadHandle (lightweight). loadBskyProfile is shown commented out.
		expect(indexServer).toContain('loadHandle');
		expect(indexServer).toMatch(/\/\/.*loadBskyProfile/);
		const indexPage = read(cwd, 'src/routes/demo/atproto/+page.svelte');
		expect(indexPage).toContain('data.handle ?? data.did');

		if (opts.demoStyle === 'form') {
			expect(indexPage).toContain('action="?/signOut"');
			const loginPage = read(cwd, 'src/routes/demo/atproto/login/+page.svelte');
			expect(loginPage).toContain('action="?/signIn"');
			const loginServer = read(cwd, 'src/routes/demo/atproto/login/+page.server.ts');
			expect(loginServer).toContain('atproto.api.startLogin');
			expect(fs.existsSync(remoteFile)).toBe(false);

			if (opts.demo === 'statusphere') {
				expect(indexPage).toContain('?/setStatus');
				expect(indexServer).toContain('setStatus:');
				expect(indexServer).toContain('com.atproto.repo.putRecord');
				expect(indexServer).toContain('xyz.statusphere.status');
				expect(indexServer).toContain('recentRecords');
				expect(indexServer).toContain('loadHandles');
			}
		}

		if (opts.demoStyle === 'remote') {
			expect(pkg.dependencies?.valibot).toBeDefined();

			const remote = read(cwd, 'src/lib/atproto/oauth.remote.ts');
			expect(remote).toContain("from '$app/server'");
			expect(remote).toContain('command(');
			expect(remote).toContain('atproto.api.startLogin');
			expect(remote).toContain('atproto.api.logout');

			expect(indexPage).toContain(`from '${remoteImport}'`);
			expect(indexPage).toContain('oauthLogout');

			const loginPage = read(cwd, 'src/routes/demo/atproto/login/+page.svelte');
			expect(loginPage).toContain(`from '${remoteImport}'`);
			expect(loginPage).toContain('oauthLogin');

			// The flag belongs under kit in svelte.config.*, or directly in
			// sveltekit({...}) in newer Vite-based templates.
			const config = svelteConfig.read(cwd);
			expect(config).not.toBeNull();
			const experimental = js.object.findProperty(config.kit, { name: 'experimental' });
			const remoteFunctions = js.object.findProperty(experimental.value, {
				name: 'remoteFunctions'
			});
			expect(remoteFunctions.value).toMatchObject({ type: 'Literal', value: true });

			if (opts.demo === 'statusphere') {
				expect(remote).toContain('setStatus');
				expect(remote).toContain('com.atproto.repo.putRecord');
				expect(remote).toContain('xyz.statusphere.status');
				expect(indexPage).toContain('setStatus');
				expect(indexServer).toContain('recentRecords');
				expect(indexServer).toContain('loadHandles');
			}
		}
	}
);

function read(cwd, rel) {
	return fs.readFileSync(path.resolve(cwd, rel), 'utf8');
}
