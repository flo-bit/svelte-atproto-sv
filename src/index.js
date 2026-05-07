import { defineAddon, defineAddonOptions } from 'sv';
import { transforms } from './sv-utils.js';

// Pin to the latest published lib at scaffold-time. Users can bump in their
// own package.json afterward — the addon doesn't enforce it.
const LIB_VERSION = '^0.0.2';

const options = defineAddonOptions()
	.add('mode', {
		question: 'Where will users authenticate?',
		type: 'select',
		default: 'server',
		options: [
			{
				value: 'server',
				label: 'On the server (SSR, KV/Redis sessions, full SvelteKit stack)'
			},
			{
				value: 'browser',
				label: 'In the browser (static-site compatible — GitHub Pages, etc.)'
			}
		]
	})
	.add('storage', {
		question: 'Session storage:',
		type: 'select',
		default: 'memory',
		options: [
			{ value: 'memory', label: 'In-memory (dev only — sessions lost on restart)' },
			{
				value: 'cloudflare',
				label: 'Cloudflare KV (use with @sveltejs/adapter-cloudflare)'
			},
			{
				value: 'upstash',
				label: 'Upstash Redis (Edge-compatible, works on Vercel/Netlify/CF)'
			},
			{ value: 'none', label: "None — I'll wire it myself" }
		],
		condition: (o) => o.mode === 'server'
	})
	.add('demo', {
		question: 'Scaffold a demo flow at /demo/atproto:',
		type: 'select',
		default: 'none',
		options: [
			{ value: 'none', label: 'No demo' },
			{ value: 'login', label: 'Login (sign in / sign out)' },
			{
				value: 'statusphere',
				label:
					'Statusphere (publishes xyz.statusphere.status records — upgrades the OAuth scope)'
			}
		]
	})
	.add('demoStyle', {
		question: 'How should the demo wire its actions?',
		type: 'select',
		default: 'form',
		options: [
			{ value: 'form', label: 'Form actions (stable, recommended)' },
			{
				value: 'remote',
				label: 'Remote functions (experimental — adds kit.experimental.remoteFunctions)'
			}
		],
		condition: (o) => o.mode === 'server' && o.demo !== 'none'
	})
	.build();

export default defineAddon({
	id: '@svelte-atproto/sv',
	options,

	setup: ({ isKit, unsupported }) => {
		if (!isKit) unsupported('Requires SvelteKit');
	},

	run: ({ directory, sv, options }) => {
		const { mode, storage, demo, demoStyle } = options;

		// Library dependency
		sv.dependency('@svelte-atproto/oauth', LIB_VERSION);
		// `@atcute/atproto` augments the atcute Client with lexicon types for
		// `com.atproto.*` calls (e.g. `client.post('com.atproto.repo.putRecord', …)`
		// type-checks). Required as a direct dep for TS to load the augmentation.
		sv.dependency('@atcute/atproto', '^3.1.10');

		// vite.config — force 127.0.0.1 for OAuth loopback (RFC 8252 §7.3 requires
		// the literal IPv4 loopback, not "localhost" — which resolves to ::1 on
		// macOS/Linux and gives ECONNREFUSED for the OAuth callback).
		sv.file('vite.config.ts', transforms.text(({ content }) => patchViteConfig(content)));
		sv.file('vite.config.js', transforms.text(({ content }) => patchViteConfig(content)));

		if (mode === 'browser') {
			runBrowserMode({ directory, sv, demo });
		} else {
			runServerMode({ directory, sv, storage, demo, demoStyle });
		}
	},

	nextSteps: ({ options }) => {
		if (options.mode === 'browser') {
			const lines = [
				'atproto OAuth (browser-only) scaffolded.',
				'',
				'Edit src/lib/atproto/index.ts and replace the placeholder `origin` with',
				'your deployed URL before publishing. (Dev uses a loopback client_id —',
				'no public URL needed locally.)',
				'',
				'Run `pnpm install && pnpm dev`.'
			];
			if (options.demo !== 'none') {
				const label = options.demo === 'statusphere' ? 'Statusphere' : 'Login';
				lines.push('', `${label} demo scaffolded at /demo/atproto.`);
				if (options.demo === 'statusphere') {
					lines.push(
						'Statusphere upgrades the OAuth scope to write `xyz.statusphere.status` records.'
					);
				}
			}
			lines.push(
				'',
				'Auth state is reactive in any component: `import { atproto } from "$lib/atproto"; const { user } = atproto;` then read `$user.did` / `$user.isLoggedIn`.'
			);
			return lines;
		}

		// Server mode
		const lines = [
			'atproto OAuth (server) scaffolded.',
			'',
			'Generate dev secrets:',
			'  pnpm atproto:setup    # writes COOKIE_SECRET + CLIENT_ASSERTION_KEY into .env',
			'',
			'For production, pipe the same generators into your secrets manager:',
			'  pnpm atproto:secret   → COOKIE_SECRET',
			'  pnpm atproto:keygen   → CLIENT_ASSERTION_KEY',
			'  + set ORIGIN to your deployed origin'
		];
		if (options.storage === 'upstash') {
			lines.push('  + UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN');
		}
		if (options.storage === 'cloudflare') {
			lines.push(
				'',
				'Cloudflare KV: add OAUTH_SESSIONS and OAUTH_STATES bindings to wrangler.jsonc.'
			);
		}
		if (options.demo !== 'none') {
			const label = options.demo === 'statusphere' ? 'Statusphere' : 'Login';
			lines.push('', `${label} demo (${options.demoStyle}) scaffolded at /demo/atproto.`);
			if (options.demoStyle === 'remote') {
				lines.push(
					'Note: SvelteKit remote functions are experimental — the flag has been added to svelte.config.js.'
				);
			}
			if (options.demo === 'statusphere') {
				lines.push(
					'Statusphere upgrades the OAuth scope to write `xyz.statusphere.status` records.'
				);
			}
		}
		lines.push(
			'',
			'Imperative auth actions: `import { login, logout } from "@svelte-atproto/oauth/client"`.',
			'Auth state lives on `event.locals.{ did, session, client }` — pass to pages via per-page `+page.server.ts` loads.'
		);
		return lines;
	}
});

// ---------------------------------------------------------------------------
// Mode dispatchers
// ---------------------------------------------------------------------------

/** @param {{ directory: any; sv: any; storage: string; demo: string; demoStyle?: string }} args */
function runServerMode({ directory, sv, storage, demo, demoStyle }) {
	const useRemote = demo !== 'none' && demoStyle === 'remote';
	if (useRemote) sv.dependency('valibot', '^1.0.0');

	sv.file(
		`${directory.lib}/atproto/index.ts`,
		transforms.text(() => buildAtprotoConfig({ storage, demo }))
	);

	sv.file(`${directory.src}/hooks.server.ts`, transforms.text(() => HOOKS_SERVER));
	sv.file(`${directory.src}/app.d.ts`, transforms.text(() => APP_DTS));

	sv.file(
		'.env.example',
		transforms.text(({ content }) => mergeEnvExample(content, { storage }))
	);

	sv.file(
		'package.json',
		transforms.json((/** @type {{ data: { scripts?: Record<string, string> } }} */ file) => {
			file.data.scripts = {
				'atproto:setup': 'atproto-oauth setup',
				'atproto:keygen': 'atproto-oauth keygen',
				'atproto:secret': 'atproto-oauth secret',
				...file.data.scripts
			};
		})
	);

	if (demo === 'none') return;
	const ctx = { demo };

	if (demoStyle === 'remote') {
		sv.file('svelte.config.js', transforms.text(({ content }) => patchSvelteConfig(content)));
		sv.file('svelte.config.ts', transforms.text(({ content }) => patchSvelteConfig(content)));

		sv.file(
			`${directory.lib}/atproto/oauth.remote.ts`,
			transforms.text(() => buildRemoteCommands({ demo }))
		);
		sv.file(
			`${directory.kitRoutes}/demo/atproto/+page.svelte`,
			transforms.text(() => buildDemoRemoteIndexPage(ctx))
		);
		sv.file(
			`${directory.kitRoutes}/demo/atproto/+page.server.ts`,
			transforms.text(() => buildDemoRemoteIndexServer(ctx))
		);
		sv.file(
			`${directory.kitRoutes}/demo/atproto/login/+page.svelte`,
			transforms.text(() => DEMO_REMOTE_LOGIN_PAGE)
		);
		sv.file(
			`${directory.kitRoutes}/demo/atproto/login/+page.server.ts`,
			transforms.text(() => DEMO_REMOTE_LOGIN_SERVER)
		);
	} else {
		sv.file(
			`${directory.kitRoutes}/demo/atproto/+page.svelte`,
			transforms.text(() => buildDemoFormIndexPage(ctx))
		);
		sv.file(
			`${directory.kitRoutes}/demo/atproto/+page.server.ts`,
			transforms.text(() => buildDemoFormIndexServer(ctx))
		);
		sv.file(
			`${directory.kitRoutes}/demo/atproto/login/+page.svelte`,
			transforms.text(() => DEMO_FORM_LOGIN_PAGE)
		);
		sv.file(
			`${directory.kitRoutes}/demo/atproto/login/+page.server.ts`,
			transforms.text(() => DEMO_FORM_LOGIN_SERVER)
		);
	}
}

/** @param {{ directory: any; sv: any; demo: string }} args */
function runBrowserMode({ directory, sv, demo }) {
	sv.file(
		`${directory.lib}/atproto/index.ts`,
		transforms.text(() => buildBrowserAtprotoConfig({ demo }))
	);

	// Prerendered metadata route — must be served at the path the lib's
	// `metadata.client_id` references.
	sv.file(
		`${directory.kitRoutes}/oauth-client-metadata.json/+server.ts`,
		transforms.text(() => BROWSER_METADATA_ROUTE)
	);

	// Patch root +layout.svelte to call atproto.init() on mount.
	sv.file(
		`${directory.kitRoutes}/+layout.svelte`,
		transforms.text(({ content }) => patchBrowserLayout(content))
	);

	if (demo === 'none') return;

	sv.file(
		`${directory.kitRoutes}/demo/atproto/+page.svelte`,
		transforms.text(() => buildBrowserDemoIndex({ demo }))
	);
	sv.file(
		`${directory.kitRoutes}/demo/atproto/login/+page.svelte`,
		transforms.text(() => BROWSER_DEMO_LOGIN_PAGE)
	);
}

const HOOKS_SERVER = `import { atproto } from '$lib/atproto';

export const handle = atproto.handle;
`;

const STATUSPHERE_COLLECTION = 'xyz.statusphere.status';

/** @param {{ storage: string; demo: string }} opts */
function buildAtprotoConfig({ storage, demo }) {
	const imports = [
		"// Side-effect: loads `com.atproto.*` lexicon types into the atcute Client.",
		"import '@atcute/atproto';",
		"import { createAtprotoAuth } from '@svelte-atproto/oauth/server';"
	];
	if (storage === 'cloudflare') {
		imports.push(
			"import { cloudflareKV } from '@svelte-atproto/oauth/server/stores/cloudflare';"
		);
	}
	if (storage === 'upstash') {
		imports.push("import { upstashRedis } from '@svelte-atproto/oauth/server/stores/upstash';");
	}
	imports.push("import { env } from '$env/dynamic/private';");

	const scope =
		demo === 'statusphere' ? `'atproto repo:${STATUSPHERE_COLLECTION}'` : "'atproto'";

	const fields = [
		'origin: env.ORIGIN',
		'cookieSecret: env.COOKIE_SECRET',
		'clientAssertionKey: env.CLIENT_ASSERTION_KEY',
		`scope: ${scope}`
	];
	if (storage === 'cloudflare') {
		fields.push("sessions: cloudflareKV('OAUTH_SESSIONS')");
		fields.push("states: cloudflareKV('OAUTH_STATES', { ttl: 600 })");
	} else if (storage === 'upstash') {
		fields.push(
			'sessions: upstashRedis({ url: env.UPSTASH_REDIS_REST_URL!, token: env.UPSTASH_REDIS_REST_TOKEN! })'
		);
		fields.push(
			'states: upstashRedis({ url: env.UPSTASH_REDIS_REST_URL!, token: env.UPSTASH_REDIS_REST_TOKEN!, ttl: 600 })'
		);
	}

	return `${imports.join('\n')}

// To enable signup, add: signupPDS: 'https://your-pds.example/'
export const atproto = createAtprotoAuth({
${fields.map((f) => `\t${f}`).join(',\n')}
});
`;
}

const APP_DTS = `// See https://svelte.dev/docs/kit/types#app.d.ts
import type { OAuthSession } from '@atcute/oauth-node-client';
import type { Client } from '@atcute/client';
import type { Did } from '@atcute/lexicons';

declare global {
\tnamespace App {
\t\t// interface Error {}
\t\tinterface Locals {
\t\t\tsession: OAuthSession | null;
\t\t\tclient: Client | null;
\t\t\tdid: Did | null;
\t\t}
\t\t// interface PageData {}
\t\t// interface PageState {}
\t\t// interface Platform {}
\t}
}

export {};
`;

/**
 * Inject `server: { host: '127.0.0.1' }` into a fresh sv-create vite config.
 * No-op if the file doesn't exist (the sibling .ts/.js call covers the other
 * extension), or if `server:` is already configured.
 *
 * @param {string} content
 */
function patchViteConfig(content) {
	if (content.length === 0) return content; // file doesn't exist on disk
	if (/server\s*:/m.test(content)) return content; // user already has a server block

	const replaced = content.replace(
		/defineConfig\(\s*{/,
		`defineConfig({\n\tserver: { host: '127.0.0.1' },`
	);
	if (replaced === content) return content; // unrecognized shape — bail out

	return replaced;
}

/**
 * @param {string} existing
 * @param {{ storage: string }} opts
 */
function mergeEnvExample(existing, { storage }) {
	if (existing.includes('@svelte-atproto/oauth')) return existing;

	const block = [
		'',
		'# @svelte-atproto/oauth',
		'ORIGIN=',
		'COOKIE_SECRET=',
		'CLIENT_ASSERTION_KEY=',
		...(storage === 'upstash' ? ['UPSTASH_REDIS_REST_URL=', 'UPSTASH_REDIS_REST_TOKEN='] : []),
		''
	].join('\n');

	return existing + block;
}

const STATUSPHERE_EMOJIS = ['👍', '🥰', '🎉', '🚀', '✨'];

/** Generates the lines that load `recent` (UFO) + own records and merge them. */
function statusphereLoadLines() {
	return [
		'// Recent statuses globally, from the firehose via UFO. UFO is slightly',
		"// behind the firehose, so we also pull the user's own records and merge",
		'// them in front so just-published statuses show up immediately.',
		'const [globalRecent, own] = await Promise.all([',
		'\trecentRecords(COLLECTION),',
		'\tlocals.client',
		'\t\t? listRecords({ did: locals.did, collection: COLLECTION, client: locals.client, limit: 10 })',
		'\t\t: Promise.resolve([])',
		']);',
		'',
		'const ownAsItems = own.map((r) => {',
		'\tconst parts = parseUri(r.uri);',
		'\tconst record = r.value as { $type: string; createdAt?: string; [k: string]: unknown };',
		"\tconst parsed = typeof record.createdAt === 'string' ? new Date(record.createdAt).getTime() : NaN;",
		'\tconst time_us = (Number.isFinite(parsed) ? parsed : Date.now()) * 1000;',
		'\treturn {',
		'\t\tdid: parts?.repo ?? locals.did,',
		'\t\tcollection: parts?.collection ?? COLLECTION,',
		"\t\trkey: parts?.rkey ?? '',",
		'\t\trecord,',
		'\t\ttime_us',
		'\t};',
		'});',
		'',
		"// Own records first so they win the dedupe (UFO can be stale on a record",
		"// the user just published). Then sort by time_us so the merged list is",
		'// in true reverse-chronological order regardless of source.',
		'const seen = new Set<string>();',
		'const merged = [];',
		'for (const item of [...ownAsItems, ...globalRecent]) {',
		'\tconst key = `${item.did}/${item.rkey}`;',
		'\tif (seen.has(key)) continue;',
		'\tseen.add(key);',
		'\tmerged.push(item);',
		'}',
		'const recent = merged.sort((a, b) => b.time_us - a.time_us);',
		'',
		'// Resolve the author handles in parallel (cached).',
		'// For richer profile data, swap `loadHandles` for:',
		"//   import { loadBskyProfiles } from '@svelte-atproto/oauth/bsky';",
		'const authorDids = [...new Set(recent.map((r) => r.did))];',
		'const authors = await loadHandles(authorDids, { cache: profileCache });'
	];
}

const DISPLAY_EXPR = '{data.handle ?? data.did}';

/** @param {{ demo: string }} opts */
function buildDemoFormIndexPage({ demo }) {
	if (demo === 'statusphere') {
		return `<script lang="ts">
\timport { enhance } from '$app/forms';
\timport type { PageServerData } from './$types';

\tlet { data }: { data: PageServerData } = $props();
\tconst emojis = ${JSON.stringify(STATUSPHERE_EMOJIS)};
</script>

<div style="max-width: 32rem; margin: 4rem auto; padding: 0 1rem; font-family: system-ui, sans-serif;">
\t<h1>What's your status?</h1>
\t<p>Hi <strong>${DISPLAY_EXPR}</strong>.</p>

\t<form method="POST" action="?/setStatus" use:enhance style="display: flex; gap: 0.5rem; margin: 1rem 0;">
\t\t{#each emojis as emoji}
\t\t\t<button type="submit" name="status" value={emoji} style="font-size: 1.5rem;">{emoji}</button>
\t\t{/each}
\t</form>

\t{#if data.recent?.length}
\t\t<h2 style="margin-top: 2rem;">Recent statuses (firehose)</h2>
\t\t<ul style="list-style: none; padding: 0;">
\t\t\t{#each data.recent as item}
\t\t\t\t<li style="padding: 0.5rem 0;">
\t\t\t\t\t<span style="font-size: 1.25rem;">{item.record.status}</span>
\t\t\t\t\t<span style="color: #444; margin-left: 0.5rem;">@{data.authors[item.did] ?? item.did}</span>
\t\t\t\t\t<small style="color: #888; margin-left: 0.5rem;">{item.record.createdAt}</small>
\t\t\t\t</li>
\t\t\t{/each}
\t\t</ul>
\t{/if}

\t<form method="POST" action="?/signOut" use:enhance style="margin-top: 2rem;">
\t\t<button type="submit">Sign out</button>
\t</form>
</div>
`;
	}

	// login demo
	return `<script lang="ts">
\timport { enhance } from '$app/forms';
\timport type { PageServerData } from './$types';

\tlet { data }: { data: PageServerData } = $props();
</script>

<div style="max-width: 32rem; margin: 4rem auto; padding: 0 1rem; font-family: system-ui, sans-serif;">
\t<h1>atproto demo</h1>

\t<p>Signed in as <strong>${DISPLAY_EXPR}</strong>.</p>

\t<form method="POST" action="?/signOut" use:enhance>
\t\t<button type="submit">Sign out</button>
\t</form>
</div>
`;
}

/** @param {{ demo: string }} opts */
function buildDemoFormIndexServer({ demo }) {
	const helperNames = ['loadHandle'];
	if (demo === 'statusphere') {
		helperNames.push('createTID', 'recentRecords', 'loadHandles', 'listRecords', 'parseUri');
	}

	const imports = [
		"import { redirect, fail } from '@sveltejs/kit';",
		"import type { Actions, PageServerLoad } from './$types';",
		"import { atproto } from '$lib/atproto';",
		`import { ${helperNames.join(', ')} } from '@svelte-atproto/oauth/helper';`,
		"import { memory } from '@svelte-atproto/oauth/server/stores/memory';"
	];
	const moduleScope = [
		'// In-memory cache for handle lookups — fine for dev. For prod, swap in',
		'// cloudflareKV or upstashRedis (any `Store` works).',
		'const profileCache = memory();'
	];
	const loadBody = [];

	if (demo === 'statusphere') {
		moduleScope.push(`const COLLECTION = '${STATUSPHERE_COLLECTION}';`);
	}

	loadBody.push('if (!locals.did) {');
	loadBody.push('\tconst returnTo = encodeURIComponent(url.pathname + url.search);');
	loadBody.push('\tredirect(302, `/demo/atproto/login?returnTo=${returnTo}`);');
	loadBody.push('}');
	loadBody.push('');

	loadBody.push("// Lightweight: just resolve the handle from the user's PDS.");
	loadBody.push('// For richer Bluesky profile data (display name, avatar) swap to:');
	loadBody.push("//   import { loadBskyProfile } from '@svelte-atproto/oauth/bsky';");
	loadBody.push(
		'//   const profile = await loadBskyProfile(locals.did, { cache: profileCache });'
	);
	loadBody.push('const handle = await loadHandle(locals.did, { cache: profileCache });');

	const returnFields = ['did: locals.did', 'handle'];
	if (demo === 'statusphere') {
		loadBody.push('');
		loadBody.push(...statusphereLoadLines());
		returnFields.push('recent', 'authors');
	}
	loadBody.push(`return { ${returnFields.join(', ')} };`);

	const actions = [];
	if (demo === 'statusphere') {
		actions.push(
			'\tsetStatus: async ({ request, locals }) => {',
			'\t\tif (!locals.client || !locals.did) return fail(401, { message: "Not signed in" });',
			'\t\tconst fd = await request.formData();',
			'\t\tconst status = fd.get("status")?.toString();',
			'\t\tif (!status) return fail(400, { message: "Missing status" });',
			'',
			'\t\tawait locals.client.post("com.atproto.repo.putRecord", {',
			'\t\t\tinput: {',
			'\t\t\t\trepo: locals.did,',
			'\t\t\t\tcollection: COLLECTION,',
			'\t\t\t\trkey: createTID(),',
			'\t\t\t\trecord: {',
			'\t\t\t\t\t$type: COLLECTION,',
			'\t\t\t\t\tstatus,',
			'\t\t\t\t\tcreatedAt: new Date().toISOString()',
			'\t\t\t\t}',
			'\t\t\t}',
			'\t\t});',
			'\t\treturn { ok: true };',
			'\t},'
		);
	}
	actions.push(
		'\tsignOut: async () => {',
		'\t\tawait atproto.api.logout();',
		"\t\tredirect(303, '/demo/atproto/login');",
		'\t}'
	);

	return [
		...imports,
		'',
		...moduleScope,
		moduleScope.length ? '' : '',
		'export const load: PageServerLoad = async ({ locals, url }) => {',
		...loadBody.map((l) => (l ? `\t${l}` : '')),
		'};',
		'',
		'export const actions: Actions = {',
		...actions,
		'};',
		''
	].join('\n');
}

const DEMO_FORM_LOGIN_PAGE = `<script lang="ts">
\timport { enhance } from '$app/forms';
\timport type { ActionData, PageData } from './$types';

\tlet { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div style="max-width: 24rem; margin: 4rem auto; padding: 0 1rem; font-family: system-ui, sans-serif;">
\t<h1>Sign in with atproto</h1>

\t<form method="POST" action="?/signIn" use:enhance style="display: flex; flex-direction: column; gap: 0.5rem;">
\t\t<label>
\t\t\t<span>Handle or DID</span>
\t\t\t<input name="handle" placeholder="alice.bsky.social" required />
\t\t</label>

\t\t<input type="hidden" name="returnTo" value={data.returnTo ?? ''} />

\t\t{#if form?.message}
\t\t\t<p style="color: #c00;">{form.message}</p>
\t\t{/if}

\t\t<button type="submit">Sign in</button>
\t</form>
</div>
`;

const DEMO_FORM_LOGIN_SERVER = `import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { atproto } from '$lib/atproto';

const DEFAULT_RETURN_TO = '/demo/atproto';

function safeReturnTo(value: string | null | undefined): string {
\tif (!value) return DEFAULT_RETURN_TO;
\ttry {
\t\tconst decoded = decodeURIComponent(value);
\t\tif (decoded.startsWith('/') && !decoded.startsWith('//')) return decoded;
\t} catch {}
\treturn DEFAULT_RETURN_TO;
}

export const load: PageServerLoad = ({ locals, url }) => {
\tif (locals.did) redirect(302, safeReturnTo(url.searchParams.get('returnTo')));
\treturn { returnTo: safeReturnTo(url.searchParams.get('returnTo')) };
};

export const actions: Actions = {
\tsignIn: async ({ request }) => {
\t\tconst fd = await request.formData();
\t\tconst handle = fd.get('handle')?.toString().trim();
\t\tconst returnTo = safeReturnTo(fd.get('returnTo')?.toString());
\t\tif (!handle) return fail(400, { message: 'Handle or DID is required' });

\t\ttry {
\t\t\tconst { url } = await atproto.api.startLogin({ handle, returnTo });
\t\t\tredirect(303, url);
\t\t} catch (e) {
\t\t\tif (e && typeof e === 'object' && 'status' in e && 'location' in e) throw e;
\t\t\treturn fail(400, { message: e instanceof Error ? e.message : 'Sign-in failed' });
\t\t}
\t}
};
`;

// --------------------------------------------------------------------------
// Remote-functions demo
// --------------------------------------------------------------------------

/** @param {{ demo: string }} opts */
function buildDemoRemoteIndexPage({ demo }) {
	if (demo === 'statusphere') {
		return `<script lang="ts">
\timport { oauthLogout, setStatus } from '$lib/atproto/oauth.remote';
\timport { invalidateAll } from '$app/navigation';
\timport type { PageServerData } from './$types';

\tlet { data }: { data: PageServerData } = $props();
\tlet pending = $state<string | null>(null);
\tconst emojis = ${JSON.stringify(STATUSPHERE_EMOJIS)};

\tasync function pick(emoji: string) {
\t\tpending = emoji;
\t\ttry {
\t\t\tawait setStatus(emoji);
\t\t\tawait invalidateAll();
\t\t} finally {
\t\t\tpending = null;
\t\t}
\t}

\tasync function signOut() {
\t\tawait oauthLogout();
\t\twindow.location.href = '/demo/atproto/login';
\t}
</script>

<div style="max-width: 32rem; margin: 4rem auto; padding: 0 1rem; font-family: system-ui, sans-serif;">
\t<h1>What's your status?</h1>
\t<p>Hi <strong>${DISPLAY_EXPR}</strong>.</p>

\t<div style="display: flex; gap: 0.5rem; margin: 1rem 0;">
\t\t{#each emojis as emoji}
\t\t\t<button onclick={() => pick(emoji)} disabled={pending !== null} style="font-size: 1.5rem;">
\t\t\t\t{pending === emoji ? '…' : emoji}
\t\t\t</button>
\t\t{/each}
\t</div>

\t{#if data.recent?.length}
\t\t<h2 style="margin-top: 2rem;">Recent statuses (firehose)</h2>
\t\t<ul style="list-style: none; padding: 0;">
\t\t\t{#each data.recent as item}
\t\t\t\t<li style="padding: 0.5rem 0;">
\t\t\t\t\t<span style="font-size: 1.25rem;">{item.record.status}</span>
\t\t\t\t\t<span style="color: #444; margin-left: 0.5rem;">@{data.authors[item.did] ?? item.did}</span>
\t\t\t\t\t<small style="color: #888; margin-left: 0.5rem;">{item.record.createdAt}</small>
\t\t\t\t</li>
\t\t\t{/each}
\t\t</ul>
\t{/if}

\t<button onclick={signOut} style="margin-top: 2rem;">Sign out</button>
</div>
`;
	}

	// login demo
	return `<script lang="ts">
\timport { oauthLogout } from '$lib/atproto/oauth.remote';
\timport type { PageServerData } from './$types';

\tlet { data }: { data: PageServerData } = $props();
\tlet pending = $state(false);

\tasync function signOut() {
\t\tpending = true;
\t\ttry {
\t\t\tawait oauthLogout();
\t\t\twindow.location.href = '/demo/atproto/login';
\t\t} catch (e) {
\t\t\tpending = false;
\t\t\tconsole.error(e);
\t\t}
\t}
</script>

<div style="max-width: 32rem; margin: 4rem auto; padding: 0 1rem; font-family: system-ui, sans-serif;">
\t<h1>atproto demo</h1>

\t<p>Signed in as <strong>${DISPLAY_EXPR}</strong>.</p>

\t<button onclick={signOut} disabled={pending}>
\t\t{pending ? 'Signing out…' : 'Sign out'}
\t</button>
</div>
`;
}

/** @param {{ demo: string }} opts */
function buildDemoRemoteIndexServer({ demo }) {
	const helperNames = ['loadHandle'];
	if (demo === 'statusphere') {
		helperNames.push('recentRecords', 'loadHandles', 'listRecords', 'parseUri');
	}

	const imports = [
		"import { redirect } from '@sveltejs/kit';",
		"import type { PageServerLoad } from './$types';",
		`import { ${helperNames.join(', ')} } from '@svelte-atproto/oauth/helper';`,
		"import { memory } from '@svelte-atproto/oauth/server/stores/memory';"
	];
	const moduleScope = [
		'// In-memory cache for handle lookups — fine for dev. For prod, swap in',
		'// cloudflareKV or upstashRedis (any `Store` works).',
		'const profileCache = memory();'
	];
	const loadBody = [];

	if (demo === 'statusphere') {
		moduleScope.push(`const COLLECTION = '${STATUSPHERE_COLLECTION}';`);
	}

	loadBody.push('if (!locals.did) {');
	loadBody.push('\tconst returnTo = encodeURIComponent(url.pathname + url.search);');
	loadBody.push('\tredirect(302, `/demo/atproto/login?returnTo=${returnTo}`);');
	loadBody.push('}');
	loadBody.push('');

	loadBody.push("// Lightweight: just resolve the handle from the user's PDS.");
	loadBody.push('// For richer Bluesky profile data (display name, avatar) swap to:');
	loadBody.push("//   import { loadBskyProfile } from '@svelte-atproto/oauth/bsky';");
	loadBody.push(
		'//   const profile = await loadBskyProfile(locals.did, { cache: profileCache });'
	);
	loadBody.push('const handle = await loadHandle(locals.did, { cache: profileCache });');

	const returnFields = ['did: locals.did', 'handle'];
	if (demo === 'statusphere') {
		loadBody.push('');
		loadBody.push(...statusphereLoadLines());
		returnFields.push('recent', 'authors');
	}
	loadBody.push(`return { ${returnFields.join(', ')} };`);

	return [
		...imports,
		'',
		...moduleScope,
		moduleScope.length ? '' : '',
		'export const load: PageServerLoad = async ({ locals, url }) => {',
		...loadBody.map((l) => (l ? `\t${l}` : '')),
		'};',
		''
	].join('\n');
}

/** @param {{ demo: string }} opts */
function buildRemoteCommands({ demo }) {
	const lines = [
		"import { command, getRequestEvent } from '$app/server';",
		"import { error } from '@sveltejs/kit';",
		"import * as v from 'valibot';",
		"import { atproto } from '$lib/atproto';"
	];
	if (demo === 'statusphere') {
		lines.push("import { createTID } from '@svelte-atproto/oauth/helper';");
	}
	lines.push('');
	lines.push('export const oauthLogin = command(');
	lines.push('\tv.object({');
	lines.push('\t\thandle: v.optional(v.pipe(v.string(), v.minLength(3))),');
	lines.push('\t\tsignup: v.optional(v.boolean()),');
	lines.push('\t\treturnTo: v.optional(v.string())');
	lines.push('\t}),');
	lines.push('\t(input) => atproto.api.startLogin(input)');
	lines.push(');');
	lines.push('');
	lines.push('export const oauthLogout = command(() => atproto.api.logout());');

	if (demo === 'statusphere') {
		lines.push('');
		lines.push(`const COLLECTION = '${STATUSPHERE_COLLECTION}';`);
		lines.push('');
		lines.push('export const setStatus = command(v.string(), async (status) => {');
		lines.push('\tconst { locals } = getRequestEvent();');
		lines.push("\tif (!locals.client || !locals.did) error(401, 'Not signed in');");
		lines.push('');
		lines.push("\tawait locals.client.post('com.atproto.repo.putRecord', {");
		lines.push('\t\tinput: {');
		lines.push('\t\t\trepo: locals.did,');
		lines.push('\t\t\tcollection: COLLECTION,');
		lines.push('\t\t\trkey: createTID(),');
		lines.push('\t\t\trecord: {');
		lines.push('\t\t\t\t$type: COLLECTION,');
		lines.push('\t\t\t\tstatus,');
		lines.push('\t\t\t\tcreatedAt: new Date().toISOString()');
		lines.push('\t\t\t}');
		lines.push('\t\t}');
		lines.push('\t});');
		lines.push('\treturn { ok: true };');
		lines.push('});');
	}
	lines.push('');
	return lines.join('\n');
}

const DEMO_REMOTE_LOGIN_PAGE = `<script lang="ts">
\timport { oauthLogin } from '$lib/atproto/oauth.remote';
\timport type { PageData } from './$types';

\tlet { data }: { data: PageData } = $props();

\tlet handle = $state('');
\tlet error = $state<string | null>(null);
\tlet pending = $state(false);

\tasync function submit(event: SubmitEvent) {
\t\tevent.preventDefault();
\t\terror = null;
\t\tpending = true;
\t\ttry {
\t\t\tconst { url } = await oauthLogin({ handle: handle.trim(), returnTo: data.returnTo });
\t\t\twindow.location.assign(url);
\t\t} catch (e) {
\t\t\terror = e instanceof Error ? e.message : 'Sign-in failed';
\t\t\tpending = false;
\t\t}
\t}
</script>

<div style="max-width: 24rem; margin: 4rem auto; padding: 0 1rem; font-family: system-ui, sans-serif;">
\t<h1>Sign in with atproto</h1>

\t<form onsubmit={submit} style="display: flex; flex-direction: column; gap: 0.5rem;">
\t\t<label>
\t\t\t<span>Handle or DID</span>
\t\t\t<input bind:value={handle} placeholder="alice.bsky.social" required />
\t\t</label>

\t\t{#if error}
\t\t\t<p style="color: #c00;">{error}</p>
\t\t{/if}

\t\t<button type="submit" disabled={pending}>
\t\t\t{pending ? 'Signing in…' : 'Sign in'}
\t\t</button>
\t</form>
</div>
`;

const DEMO_REMOTE_LOGIN_SERVER = `import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

const DEFAULT_RETURN_TO = '/demo/atproto';

function safeReturnTo(value: string | null | undefined): string {
\tif (!value) return DEFAULT_RETURN_TO;
\ttry {
\t\tconst decoded = decodeURIComponent(value);
\t\tif (decoded.startsWith('/') && !decoded.startsWith('//')) return decoded;
\t} catch {}
\treturn DEFAULT_RETURN_TO;
}

export const load: PageServerLoad = ({ locals, url }) => {
\tconst returnTo = safeReturnTo(url.searchParams.get('returnTo'));
\tif (locals.did) redirect(302, returnTo);
\treturn { returnTo };
};
`;

/**
 * Add `kit.experimental.remoteFunctions: true` to a fresh sv-create
 * `svelte.config.js`. No-op if missing or already enabled.
 *
 * @param {string} content
 */
function patchSvelteConfig(content) {
	if (content.length === 0) return content;
	if (/remoteFunctions\s*:\s*true/m.test(content)) return content;

	// Try to inject inside an existing `kit: { ... }` block.
	if (/kit\s*:\s*\{/m.test(content)) {
		// If `experimental: { ... }` already exists inside kit, add remoteFunctions there.
		if (/experimental\s*:\s*\{/m.test(content)) {
			return content.replace(
				/experimental\s*:\s*\{/,
				'experimental: { remoteFunctions: true,'
			);
		}
		return content.replace(/kit\s*:\s*\{/, 'kit: {\n\t\texperimental: { remoteFunctions: true },');
	}
	return content; // unrecognized shape
}


// ---------------------------------------------------------------------------
// Browser mode templates
// ---------------------------------------------------------------------------

/** @param {{ demo: string }} opts */
function buildBrowserAtprotoConfig({ demo }) {
	const scope =
		demo === 'statusphere'
			? `'atproto repo:${STATUSPHERE_COLLECTION}'`
			: `'atproto'`;

	const redirectLine =
		demo === 'none'
			? ''
			: "\n\t// PDS redirects users back here after sign-in. Default is `/`.\n\tredirectPath: '/demo/atproto',";

	return `// Side-effect: loads \`com.atproto.*\` lexicon types into the atcute Client.
import '@atcute/atproto';
import { createAtprotoBrowserAuth } from '@svelte-atproto/oauth/browser';
import { dev } from '$app/environment';

// To enable signup, uncomment the signupPDS line below.
export const atproto = createAtprotoBrowserAuth({
\t// TODO: replace with your deployed origin (e.g. https://your-app.example).
\t// In dev, this is ignored — the lib uses a loopback client_id automatically.
\torigin: 'https://your-app.example',
\tscope: ${scope},${redirectLine}
\t// signupPDS: dev ? 'https://pds.rip/' : 'https://selfhosted.social/'
});
`;
}

const BROWSER_METADATA_ROUTE = `import { atproto } from '$lib/atproto';
import { json } from '@sveltejs/kit';

export const prerender = true;

export const GET = () => json(atproto.metadata);
`;

const BROWSER_LAYOUT_DEFAULT = `<script lang="ts">
\timport { onMount } from 'svelte';
\timport { atproto } from '$lib/atproto';

\tlet { children } = $props();

\tonMount(() => atproto.init());
</script>

{@render children()}
`;

/**
 * Patch the user's root +layout.svelte to call atproto.init() on mount.
 * Appends our imports + onMount call to whatever existing `<script>` block
 * is there. If there's no script block yet, prepends one.
 *
 * @param {string} content
 */
function patchBrowserLayout(content) {
	if (content.length === 0) return BROWSER_LAYOUT_DEFAULT;
	if (/atproto\.init\(/.test(content)) return content; // already patched

	const additions = [
		"\timport { onMount } from 'svelte';",
		"\timport { atproto } from '$lib/atproto';",
		'',
		'\tonMount(() => atproto.init());'
	].join('\n');

	const scriptRe = /(<script\b[^>]*>)([\s\S]*?)(<\/script>)/;
	const m = content.match(scriptRe);
	if (m) {
		const [, openTag, body, closeTag] = m;
		const trimmed = body.replace(/\s+$/, '');
		const newScript = `${openTag}${trimmed}\n\n${additions}\n${closeTag}`;
		return content.replace(scriptRe, newScript);
	}

	// No existing <script> — prepend one
	return (
		`<script lang="ts">\n${additions}\n</script>\n\n` +
		content.replace(/^\s+/, '')
	);
}

const BROWSER_DEMO_LOGIN_PAGE = `<script lang="ts">
\timport { goto } from '$app/navigation';
\timport { atproto } from '$lib/atproto';

\tconst { user } = atproto;

\tlet handle = $state('');
\tlet error = $state<string | null>(null);
\tlet pending = $state(false);

\t$effect(() => {
\t\tif ($user.isLoggedIn) goto('/demo/atproto');
\t});

\tasync function submit(event: SubmitEvent) {
\t\tevent.preventDefault();
\t\terror = null;
\t\tpending = true;
\t\ttry {
\t\t\tawait atproto.login(handle.trim());
\t\t} catch (e) {
\t\t\terror = e instanceof Error ? e.message : 'Sign-in failed';
\t\t\tpending = false;
\t\t}
\t}
</script>

<div style="max-width: 24rem; margin: 4rem auto; padding: 0 1rem; font-family: system-ui, sans-serif;">
\t<h1>Sign in with atproto</h1>

\t<form onsubmit={submit} style="display: flex; flex-direction: column; gap: 0.5rem;">
\t\t<label>
\t\t\t<span>Handle or DID</span>
\t\t\t<input bind:value={handle} placeholder="alice.bsky.social" required />
\t\t</label>

\t\t{#if error}
\t\t\t<p style="color: #c00;">{error}</p>
\t\t{/if}

\t\t<button type="submit" disabled={pending || $user.isInitializing}>
\t\t\t{pending ? 'Signing in…' : 'Sign in'}
\t\t</button>
\t</form>
</div>
`;

/** @param {{ demo: string }} opts */
function buildBrowserDemoIndex({ demo }) {
	if (demo === 'statusphere') {
		return `<script lang="ts">
\timport { goto } from '$app/navigation';
\timport { atproto } from '$lib/atproto';
\timport {
\t\tcreateTID,
\t\tlistRecords,
\t\tloadHandles,
\t\tparseUri,
\t\trecentRecords,
\t\ttype UfoRecord
\t} from '@svelte-atproto/oauth/helper';
\timport type { Did } from '@atcute/lexicons';

\tconst { user } = atproto;
\tconst COLLECTION = '${STATUSPHERE_COLLECTION}';
\tconst emojis = ${JSON.stringify(STATUSPHERE_EMOJIS)};

\tlet recent = $state<UfoRecord[]>([]);
\tlet authors = $state<Record<string, string | undefined>>({});
\tlet pending = $state<string | null>(null);

\t$effect(() => {
\t\tif (!$user.isInitializing && !$user.isLoggedIn) goto('/demo/atproto/login');
\t});

\t$effect(() => {
\t\tif ($user.isLoggedIn) refresh();
\t});

\tasync function refresh() {
\t\tconst client = $user.client;
\t\tconst did = $user.did;
\t\tconst [globalRecent, own] = await Promise.all([
\t\t\trecentRecords(COLLECTION),
\t\t\tclient && did
\t\t\t\t? listRecords({ did, collection: COLLECTION, client, limit: 10 })
\t\t\t\t: Promise.resolve([])
\t\t]);

\t\tconst ownAsItems = own.map((r) => {
\t\t\tconst parts = parseUri(r.uri);
\t\t\tconst record = r.value as { $type: string; createdAt?: string; [k: string]: unknown };
\t\t\tconst parsed = typeof record.createdAt === 'string' ? new Date(record.createdAt).getTime() : NaN;
\t\t\tconst time_us = (Number.isFinite(parsed) ? parsed : Date.now()) * 1000;
\t\t\treturn {
\t\t\t\tdid: parts?.repo ?? did!,
\t\t\t\tcollection: parts?.collection ?? COLLECTION,
\t\t\t\trkey: parts?.rkey ?? '',
\t\t\t\trecord,
\t\t\t\ttime_us
\t\t\t} as UfoRecord;
\t\t});

\t\tconst seen = new Set<string>();
\t\tconst merged: UfoRecord[] = [];
\t\tfor (const item of [...ownAsItems, ...globalRecent]) {
\t\t\tconst key = \`\${item.did}/\${item.rkey}\`;
\t\t\tif (seen.has(key)) continue;
\t\t\tseen.add(key);
\t\t\tmerged.push(item);
\t\t}
\t\trecent = merged.sort((a, b) => b.time_us - a.time_us);

\t\tconst authorDids = [...new Set([did as Did, ...recent.map((r) => r.did as Did)])];
\t\tauthors = await loadHandles(authorDids);
\t}

\tasync function pick(emoji: string) {
\t\tconst client = $user.client;
\t\tconst did = $user.did;
\t\tif (!client || !did) return;
\t\tpending = emoji;
\t\ttry {
\t\t\tawait client.post('com.atproto.repo.putRecord', {
\t\t\t\tinput: {
\t\t\t\t\trepo: did,
\t\t\t\t\tcollection: COLLECTION,
\t\t\t\t\trkey: createTID(),
\t\t\t\t\trecord: {
\t\t\t\t\t\t$type: COLLECTION,
\t\t\t\t\t\tstatus: emoji,
\t\t\t\t\t\tcreatedAt: new Date().toISOString()
\t\t\t\t\t}
\t\t\t\t}
\t\t\t});
\t\t\tawait refresh();
\t\t} finally {
\t\t\tpending = null;
\t\t}
\t}

\tasync function signOut() {
\t\tawait atproto.logout();
\t\tgoto('/demo/atproto/login');
\t}
</script>

<div style="max-width: 32rem; margin: 4rem auto; padding: 0 1rem; font-family: system-ui, sans-serif;">
\t<h1>What's your status?</h1>
\t<p>Hi <strong>{$user.did ? (authors[$user.did] ?? $user.did) : ''}</strong>.</p>

\t<div style="display: flex; gap: 0.5rem; margin: 1rem 0;">
\t\t{#each emojis as emoji}
\t\t\t<button onclick={() => pick(emoji)} disabled={pending !== null} style="font-size: 1.5rem;">
\t\t\t\t{pending === emoji ? '…' : emoji}
\t\t\t</button>
\t\t{/each}
\t</div>

\t{#if recent.length}
\t\t<h2 style="margin-top: 2rem;">Recent statuses (firehose)</h2>
\t\t<ul style="list-style: none; padding: 0;">
\t\t\t{#each recent as item}
\t\t\t\t<li style="padding: 0.5rem 0;">
\t\t\t\t\t<span style="font-size: 1.25rem;">{item.record.status}</span>
\t\t\t\t\t<span style="color: #444; margin-left: 0.5rem;">@{authors[item.did] ?? item.did}</span>
\t\t\t\t\t<small style="color: #888; margin-left: 0.5rem;">{item.record.createdAt}</small>
\t\t\t\t</li>
\t\t\t{/each}
\t\t</ul>
\t{/if}

\t<button onclick={signOut} style="margin-top: 2rem;">Sign out</button>
</div>
`;
	}

	// login demo
	return `<script lang="ts">
\timport { goto } from '$app/navigation';
\timport { atproto } from '$lib/atproto';
\timport { loadHandle } from '@svelte-atproto/oauth/helper';

\tconst { user } = atproto;

\tlet handle = $state<string | undefined>(undefined);
\tlet pending = $state(false);

\t$effect(() => {
\t\tif (!$user.isInitializing && !$user.isLoggedIn) goto('/demo/atproto/login');
\t});

\t$effect(() => {
\t\tconst did = $user.did;
\t\tif (!did) return;
\t\tloadHandle(did).then((h) => {
\t\t\tif ($user.did === did) handle = h;
\t\t});
\t});

\tasync function signOut() {
\t\tpending = true;
\t\ttry {
\t\t\tawait atproto.logout();
\t\t\tgoto('/demo/atproto/login');
\t\t} finally {
\t\t\tpending = false;
\t\t}
\t}
</script>

<div style="max-width: 32rem; margin: 4rem auto; padding: 0 1rem; font-family: system-ui, sans-serif;">
\t<h1>atproto demo</h1>

\t<p>Signed in as <strong>{handle ?? $user.did}</strong>.</p>

\t<button onclick={signOut} disabled={pending}>
\t\t{pending ? 'Signing out…' : 'Sign out'}
\t</button>
</div>
`;
}
