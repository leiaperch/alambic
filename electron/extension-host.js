/** Canaux IPC réservés aux extensions : tout autre canal leur est refusé. */
export const EXTENSION_CHANNEL = /^ext:[a-z0-9][a-z0-9:-]*$/;

export function assertExtensionChannel(channel) {
	if (typeof channel !== 'string' || !EXTENSION_CHANNEL.test(channel)) throw new Error(`Canal d'extension invalide : ${channel}`);
}

/**
 * Accès d'une extension au cœur : ses propres canaux IPC et quelques opérations sur la file.
 * `core` fournit les fonctions de main.js ; rien d'autre n'est exposé.
 */
export function createExtensionHost(core) {
	return Object.freeze({
		userData: core.userData,
		status: () => ({ ...core.status() }),
		handle(channel, fn) {
			assertExtensionChannel(channel);
			core.handle(channel, fn);
		},
		send(channel, ...args) {
			assertExtensionChannel(channel);
			core.send(channel, ...args);
		},
		analyze: (id) => core.analyze(id),
		estimate: (id, recipe) => core.estimate(id, recipe),
		runJob: (jobId, id, recipe, outputDir = null) => core.runJob(jobId, id, recipe, outputDir),
		cancelJob: (jobId) => core.cancelJob(jobId),
		addFiles: (paths) => core.addFiles(paths),
	});
}

/** Enregistre chaque extension ; l'échec de l'une n'empêche ni les autres ni l'application de démarrer. */
export async function mountExtensions(extensions, host, onError) {
	for (const extension of extensions) {
		try {
			await extension.register(host);
		} catch (error) {
			onError(error);
		}
	}
}
