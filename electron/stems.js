import { Worker } from 'node:worker_threads';
import { access, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadFile } from './download.js';

/** Modèle UVR-MDX-NET Inst HQ 3 (dépôt TRvlvr/model_repo, publication « all_public_uvr_models ») ; empreinte figée. */
const MODEL = Object.freeze({
	url: 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_3.onnx',
	sha256: '317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc',
	bytes: 66_759_214,
	file: 'UVR-MDX-NET-Inst_HQ_3.onnx',
});

/**
 * Le worker doit être lu hors de l'archive asar (worker_threads ne sait pas y charger un module ESM) :
 * electron-builder le dépose dans app.asar.unpacked (voir asarUnpack dans package.json).
 */
const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'separation-worker.js').replace(`app.asar${'\\'}`, `app.asar.unpacked${'\\'}`);

export class Stems {
	#dir;
	#installing = null;
	#workers = new Map();

	constructor(modelsDir) {
		this.#dir = modelsDir;
	}

	get #path() {
		return join(this.#dir, MODEL.file);
	}

	async installed() {
		return access(this.#path).then(() => true, () => false);
	}

	async install(onProgress) {
		if (this.#installing) throw new Error('Installation déjà en cours');
		this.#installing = new AbortController();
		try {
			await mkdir(this.#dir, { recursive: true });
			await downloadFile(MODEL.url, this.#path, { onProgress, signal: this.#installing.signal, sha256: MODEL.sha256, expectedBytes: MODEL.bytes });
		} finally {
			this.#installing = null;
		}
	}

	cancelInstall() {
		this.#installing?.abort();
	}

	/** Sépare `input` (float32 stéréo 44,1 kHz entrelacé) en deux fichiers du même format. */
	run(jobId, { input, instrumental, vocals }, onProgress) {
		return new Promise((resolve, reject) => {
			const stop = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
			const job = { worker: new Worker(WORKER_PATH, { workerData: { modelPath: this.#path, input, instrumental, vocals, stop } }), stop: new Int32Array(stop) };
			this.#workers.set(jobId, job);
			job.worker.on('message', (message) => {
				if (message.progress !== undefined) onProgress(message.progress);
				if (message.done) resolve();
				if (message.cancelled) reject(new Error('Annulé'));
				if (message.error && /protobuf|Load model|ONNX|INVALID_GRAPH|invalid model/i.test(message.error)) {
					rm(this.#path, { force: true }).finally(() => reject(new Error('Le modèle de séparation était abîmé et a été supprimé. Télécharge-le à nouveau dans la section Séparation.')));
				} else if (message.error) {
					reject(new Error(/memory|alloc/i.test(message.error)
						? 'Mémoire insuffisante pour séparer un morceau aussi long. Découpe-le dans le temps (section Temps) puis réessaie.'
						: `Séparation impossible : ${message.error}`));
				}
			});
			job.worker.on('error', reject);
			job.worker.on('exit', () => this.#workers.delete(jobId));
		});
	}

	/**
	 * Annulation coopérative : le worker s'arrête entre deux morceaux (quelques secondes au plus).
	 * Un terminate() pendant l'inférence native d'onnxruntime fait planter tout le processus.
	 */
	cancel(jobId) {
		const job = this.#workers.get(jobId);
		if (job) Atomics.store(job.stop, 0, 1);
	}
}
