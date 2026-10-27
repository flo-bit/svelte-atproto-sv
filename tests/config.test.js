import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import addon from '../dist/index.mjs';
import { js, svelteConfig } from '../dist/sv-utils.mjs';

const cases = ['svelte', 'vite'].flatMap((kind) =>
	['js', 'ts'].flatMap((extension) =>
		['missing', 'disabled', 'enabled'].map((flag) => ({ kind, extension, flag }))
	)
);

test.for(cases)('remote config: $kind.config.$extension ($flag)', ({ kind, extension, flag }, { expect, onTestFinished }) => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'atproto-config-'));
	onTestFinished(() => fs.rmSync(cwd, { recursive: true, force: true }));
	const filename = `${kind}.config.${extension}`;
	const experimental = flag === 'missing'
		? ''
		: `experimental: { remoteFunctions: ${flag === 'enabled'}, async: true },`;
	const options = `${experimental} adapter: adapter()`;
	const vite = (options = '') => `
import adapter from '@sveltejs/adapter-auto';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
export default defineConfig({ plugins: [sveltekit(${options})] });
`;
	if (kind === 'svelte') {
		fs.writeFileSync(path.join(cwd, filename), `
import adapter from '@sveltejs/adapter-auto';
const config = {
	compilerOptions: { dev: true },
	kit: { ${options} }
};
export default config;
`);
		fs.writeFileSync(path.join(cwd, `vite.config.${extension}`), vite());
	} else {
		fs.writeFileSync(path.join(cwd, filename), vite(`{
		compilerOptions: { dev: true },
		${options}
	}`));
	}

	// Exercise the packaged add-on with a minimal file API, leaving unrelated
	// scaffold files alone. Running twice must not duplicate config properties.
	const run = () => addon.run({
		cwd,
		dependencyVersion: () => kind === 'vite' ? '3.0.0' : '2.70.3',
		directory: { src: 'src', lib: 'src/lib', kitRoutes: 'src/routes' },
		options: { mode: 'server', storage: 'memory', demo: 'login', demoStyle: 'remote' },
		sv: {
			dependency() {},
			file(filename, transform) {
				if (!/^(svelte|vite)\.config\.(js|ts)$/.test(filename)) return;
				const file = path.join(cwd, filename);
				const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
				const result = transform(content);
				if (typeof result === 'string' && result !== content) fs.writeFileSync(file, result);
			}
		}
	});
	run();
	const once = fs.readFileSync(path.join(cwd, filename), 'utf8');
	run();
	expect(fs.readFileSync(path.join(cwd, filename), 'utf8')).toBe(once);

	const config = svelteConfig.read(cwd);
	expect(config.location).toEqual({ path: filename, kind });
	const experimentalNode = js.object.findProperty(config.kit, { name: 'experimental' }).value;
	const remoteFunctions = experimentalNode.properties.filter((prop) =>
		js.object.propertyName(prop) === 'remoteFunctions'
	);
	expect(remoteFunctions).toHaveLength(1);
	expect(remoteFunctions[0].value).toMatchObject({ type: 'Literal', value: true });
	if (flag !== 'missing') {
		expect(js.object.findProperty(experimentalNode, { name: 'async' }).value).toMatchObject({ value: true });
	}
	expect(js.object.findProperty(config.kit, { name: 'adapter' }).value).toMatchObject({ type: 'CallExpression' });
	expect(js.object.findProperty(config.config, { name: 'compilerOptions' })).toBeDefined();
	expect(fs.readFileSync(path.join(cwd, `vite.config.${extension}`), 'utf8')).toContain("host: '127.0.0.1'");
	if (kind === 'vite') {
		expect(fs.existsSync(path.join(cwd, 'svelte.config.js'))).toBe(false);
		expect(fs.existsSync(path.join(cwd, 'svelte.config.ts'))).toBe(false);
		// Kit 3 options are flattened, never nested under an extra kit object.
		expect(js.object.findProperty(config.kit, { name: 'kit' })).toBeUndefined();
	}
});
