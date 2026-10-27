import { test } from 'vitest';
import { findPreviewOrigin } from './setup/compatibility.js';

const cases = [
	{
		name: 'plain Vite output',
		output: '  ➜  Local:   http://127.0.0.1:40205/\n',
		origin: 'http://127.0.0.1:40205'
	},
	{
		name: 'CI output with a bold port number',
		output: '  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://127.0.0.1:\x1b[1m40205\x1b[22m/\x1b[39m\n',
		origin: 'http://127.0.0.1:40205'
	},
	{
		name: 'Kit warnings preceding the URL',
		output: '[sveltekit] app_environment_deprecated\n  Local: \x1b[36mhttp://127.0.0.1:\x1b[1m39811\x1b[22m/\x1b[39m\n',
		origin: 'http://127.0.0.1:39811'
	},
	{ name: 'no URL yet', output: 'Starting preview…\n', origin: undefined },
	{ name: 'port split across chunks', output: 'Local: http://127.0.0.1:40', origin: undefined }
];

test.for(cases)('preview URL: $name', ({ output, origin }, { expect }) => {
	expect(findPreviewOrigin(output)).toBe(origin);
});

test('preview URL waits for a complete URL across colored output chunks', ({ expect }) => {
	const chunks = ['Local: \x1b[36mhttp://127.0.0.1:\x1b[', '1m40', '205\x1b[22m/\x1b[39m\n'];
	let output = '';
	for (const chunk of chunks.slice(0, -1)) {
		output += chunk;
		expect(findPreviewOrigin(output)).toBeUndefined();
	}
	output += chunks.at(-1);
	expect(findPreviewOrigin(output)).toBe('http://127.0.0.1:40205');
});
