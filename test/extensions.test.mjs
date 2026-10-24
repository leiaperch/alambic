import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertExtensionChannel, createExtensionHost, mountExtensions } from '../electron/extension-host.js';
import extensions from '../electron/extensions.js';

function fakeCore() {
	const calls = [];
	const record = (name) => (...args) => calls.push([name, ...args]);
	return {
		calls,
		core: {
			userData: 'C:/data', handle: record('handle'), send: record('send'), analyze: record('analyze'),
			estimate: record('estimate'), runJob: record('runJob'), cancelJob: record('cancelJob'), addFiles: record('addFiles'),
		},
	};
}

test('la version publique n\'embarque aucune extension', () => {
	assert.deepEqual(extensions, []);
});

test('une extension ne peut ouvrir que des canaux ext:', () => {
	const { core, calls } = fakeCore();
	const host = createExtensionHost(core);
	host.handle('ext:pro:plan', () => {});
	assert.throws(() => host.handle('job:run', () => {}), /Canal d'extension invalide/);
	assert.throws(() => host.send('files:opened'), /Canal d'extension invalide/);
	assert.deepEqual(calls.map(([name, channel]) => [name, channel]), [['handle', 'ext:pro:plan']]);
});

test('l\'hôte est figé et n\'expose que les opérations prévues', () => {
	const host = createExtensionHost(fakeCore().core);
	assert.ok(Object.isFrozen(host));
	assert.deepEqual(Object.keys(host).sort(), ['addFiles', 'analyze', 'cancelJob', 'estimate', 'handle', 'runJob', 'send', 'userData']);
});

test('runJob passe un dossier de sortie nul par défaut', () => {
	const { core, calls } = fakeCore();
	createExtensionHost(core).runJob('j1', 'a', { output: 'mp4' });
	assert.deepEqual(calls[0], ['runJob', 'j1', 'a', { output: 'mp4' }, null]);
});

test('une extension en échec n\'empêche pas les suivantes', async () => {
	const errors = [];
	const loaded = [];
	const broken = { register: () => { throw new Error('cassée'); } };
	const healthy = { register: (host) => loaded.push(host) };
	await mountExtensions([broken, healthy], 'hôte', (error) => errors.push(error.message));
	assert.deepEqual(errors, ['cassée']);
	assert.deepEqual(loaded, ['hôte']);
});

test('motif des canaux : préfixe ext: et caractères simples seulement', () => {
	assertExtensionChannel('ext:pro:run');
	for (const bad of ['ext:', 'ext:Pro', 'ext:a b', 'extension:x', 42]) assert.throws(() => assertExtensionChannel(bad));
});
