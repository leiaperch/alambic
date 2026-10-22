import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const STALL_MS = 60_000;

/**
 * Télécharge `url` vers `dest` via un fichier .part renommé à la fin : un fichier tronqué n'est jamais pris pour complet.
 * `sha256` (facultatif) est vérifié avant le renommage. Le délai d'inactivité repart à chaque bloc reçu.
 */
export async function downloadFile(url, dest, { onProgress = () => {}, signal = null, sha256 = null, expectedBytes = 0 } = {}) {
	const controller = new AbortController();
	signal?.addEventListener('abort', () => controller.abort(), { once: true });
	const part = `${dest}.part`;
	let stall = setTimeout(() => controller.abort(), STALL_MS);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) throw new Error(`Téléchargement refusé (HTTP ${response.status})`);
		const total = Number(response.headers.get('content-length')) || expectedBytes;
		const hash = createHash('sha256');
		let received = 0;
		const meter = new Transform({
			transform(chunk, _encoding, callback) {
				received += chunk.length;
				hash.update(chunk);
				clearTimeout(stall);
				stall = setTimeout(() => controller.abort(), STALL_MS);
				if (total) onProgress(Math.min(1, received / total));
				callback(null, chunk);
			},
		});
		await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(part));
		if (sha256 && hash.digest('hex') !== sha256) throw new Error('Fichier téléchargé corrompu (empreinte SHA-256 différente)');
		await rename(part, dest);
	} catch (error) {
		await rm(part, { force: true });
		throw new Error(controller.signal.aborted && !error.message.includes('SHA') ? 'Téléchargement interrompu' : error.message);
	} finally {
		clearTimeout(stall);
	}
}
