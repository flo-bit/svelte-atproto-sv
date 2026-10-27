import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const exec = promisify(execFile);

// sv creates Kit 3 templates now. Convert a copy to the equivalent minimal
// Kit 2 project before running the add-on, so both supported majors are tested.
export function prepareKit2(cwd) {
	const pkgPath = path.join(cwd, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
	pkg.devDependencies['@sveltejs/kit'] = '^2.70.3';
	pkg.devDependencies['@sveltejs/adapter-auto'] = '^7.0.1';
	delete pkg.imports;
	fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
	const extension = fs.existsSync(path.join(cwd, 'vite.config.ts')) ? 'ts' : 'js';
	fs.writeFileSync(path.join(cwd, `vite.config.${extension}`), `
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
export default defineConfig({ plugins: [sveltekit()] });
`);
	fs.writeFileSync(path.join(cwd, 'svelte.config.js'), `
import adapter from '@sveltejs/adapter-auto';
export default { kit: { adapter: adapter() } };
`);
	const typeConfig = extension === 'ts' ? 'tsconfig.json' : 'jsconfig.json';
	fs.writeFileSync(path.join(cwd, typeConfig), JSON.stringify({
		extends: './.svelte-kit/tsconfig.json',
		compilerOptions: {
			allowJs: true, checkJs: true, esModuleInterop: true,
			resolveJsonModule: true, skipLibCheck: true, strict: true,
			moduleResolution: 'bundler', rewriteRelativeImportExtensions: true
		}
	}, null, 2));
	for (const filename of fs.readdirSync(path.join(cwd, 'src'), { recursive: true })) {
		if (!/\.(svelte|[jt]s)$/.test(filename)) continue;
		const file = path.join(cwd, 'src', filename);
		fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll('#lib/', '$lib/'));
	}
}

export async function verifyApp(cwd, options) {
	const run = async (...args) => {
		try {
			await exec('pnpm', args, { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 120_000 });
		} catch (error) {
			throw new Error(`pnpm ${args.join(' ')} failed in ${cwd}\n${error.stdout}\n${error.stderr}`, { cause: error });
		}
	};
	if (options.mode === 'server') {
		await run('atproto:setup');
		const envPath = path.join(cwd, '.env');
		let env = fs.readFileSync(envPath, 'utf8').replace(/^ORIGIN=.*$/m, 'ORIGIN=https://app.example.com');
		if (options.storage === 'upstash') {
			env = env.replace(/^UPSTASH_REDIS_REST_URL=.*$/m, 'UPSTASH_REDIS_REST_URL=https://redis.example.com')
				.replace(/^UPSTASH_REDIS_REST_TOKEN=.*$/m, 'UPSTASH_REDIS_REST_TOKEN=test-token');
		}
		fs.writeFileSync(envPath, env);
	}
	await run('check');
	await run('build');
	await verifyPreview(cwd, options);
}

// Exercise the actual Kit runtime, not just bundling: the OAuth hook must
// serve metadata/JWKS, and generated login pages must render successfully.
async function verifyPreview(cwd, options) {
	const require = createRequire(path.join(cwd, 'package.json'));
	const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
	const child = spawn(process.execPath, [vite, 'preview', '--host', '127.0.0.1', '--port', '0'], {
		cwd, stdio: ['ignore', 'pipe', 'pipe']
	});
	const exited = new Promise((resolve) => child.once('close', resolve));
	let output = '';
	try {
		const origin = await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error(`Preview startup timed out: ${output}`)), 20_000);
			const capture = (chunk) => {
				output += chunk.toString();
				const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
				if (match) { clearTimeout(timeout); resolve(match[0]); }
			};
			child.stdout.on('data', capture);
			child.stderr.on('data', capture);
			child.once('error', (error) => { clearTimeout(timeout); reject(error); });
			child.once('close', () => { clearTimeout(timeout); reject(new Error(`Preview exited: ${output}`)); });
		});
		const request = (pathname) => fetch(`${origin}${pathname}`, {
			redirect: 'manual', signal: AbortSignal.timeout(10_000)
		});
		const metadata = await request('/oauth-client-metadata.json');
		assert.equal(metadata.status, 200, await metadata.clone().text());
		const client = await metadata.json();
		assert.equal(new URL(client.client_id).pathname, '/oauth-client-metadata.json');
		if (options.mode === 'server') {
			const jwks = await request('/oauth/jwks.json');
			assert.equal(jwks.status, 200);
			assert.ok((await jwks.json()).keys.length > 0);
			const logout = await fetch(`${origin}/oauth/logout`, {
				method: 'POST',
				headers: { origin, 'content-type': 'application/json' },
				body: '{}', signal: AbortSignal.timeout(10_000)
			});
			assert.equal(logout.status, 200, await logout.clone().text());
			assert.deepEqual(await logout.json(), { ok: true });
			const deletions = logout.headers.getSetCookie();
			assert.equal(deletions.length, 2);
			assert.ok(deletions.every((cookie) => /Max-Age=0/.test(cookie)));
			if (options.demo !== 'none') {
				const protectedPage = await request('/demo/atproto');
				assert.equal(protectedPage.status, 302);
				assert.ok(protectedPage.headers.get('location').startsWith('/demo/atproto/login'));
			}
		}
		if (options.demo !== 'none') {
			const login = await request('/demo/atproto/login');
			assert.equal(login.status, 200, await login.clone().text());
			assert.match(await login.text(), /<form/);
		}
	} finally {
		child.kill('SIGTERM');
		await exited;
	}
}
