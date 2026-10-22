import { spawn, execFile } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { downloadFile } from './download.js';

const execFileAsync = promisify(execFile);

/** Publication officielle xinntao/Real-ESRGAN v0.2.5.0 ; l'empreinte bloque toute archive modifiée. */
const RELEASE = Object.freeze({
	url: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip',
	sha256: 'abc02804e17982a3be33675e4d471e91ea374e65b70167abc09e31acb412802d',
	bytes: 45_474_481,
	folder: 'realesrgan-20220424',
});
export const UPSCALE_MODELS = Object.freeze({ photo: 'realesrgan-x4plus', drawing: 'realesrgan-x4plus-anime' });
export const NATIVE_FACTOR = 4;
const UNZIP_TIMEOUT_MS = 120_000;
const PERCENT = 100;

export class Upscaler {
	#dir;
	#jobs = new Map();
	#installing = null;

	constructor(toolsDir) {
		this.#dir = join(toolsDir, RELEASE.folder);
	}

	get #exe() {
		return join(this.#dir, 'realesrgan-ncnn-vulkan.exe');
	}

	async installed() {
		return access(this.#exe).then(() => true, () => false);
	}

	/** Télécharge l'archive (45 Mo), vérifie son empreinte et la décompresse avec Expand-Archive de Windows. */
	async install(onProgress) {
		if (this.#installing) throw new Error('Installation déjà en cours');
		this.#installing = new AbortController();
		const zip = `${this.#dir}.zip`;
		try {
			await mkdir(this.#dir, { recursive: true });
			await downloadFile(RELEASE.url, zip, { onProgress, signal: this.#installing.signal, sha256: RELEASE.sha256, expectedBytes: RELEASE.bytes });
			await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
				'Expand-Archive -LiteralPath $env:ALAMBIC_ZIP -DestinationPath $env:ALAMBIC_DEST -Force'], {
				env: { ...process.env, ALAMBIC_ZIP: zip, ALAMBIC_DEST: this.#dir }, timeout: UNZIP_TIMEOUT_MS, windowsHide: true,
			});
			if (!(await this.installed())) throw new Error('Archive Real-ESRGAN incomplète');
		} catch (error) {
			await rm(this.#dir, { recursive: true, force: true });
			throw error;
		} finally {
			await rm(zip, { force: true });
			this.#installing = null;
		}
	}

	cancelInstall() {
		this.#installing?.abort();
	}

	/** Agrandit ×4 avec le modèle choisi ; la progression arrive sur stderr sous la forme « 25,00% ». */
	run(jobId, input, output, model, onProgress) {
		return new Promise((resolve, reject) => {
			const name = UPSCALE_MODELS[model] ?? UPSCALE_MODELS.photo;
			const child = spawn(this.#exe, ['-i', input, '-o', output, '-n', name, '-s', String(NATIVE_FACTOR), '-f', 'png'],
				{ cwd: this.#dir, windowsHide: true });
			this.#jobs.set(jobId, child);
			let log = '';
			child.stderr.setEncoding('utf8');
			child.stderr.on('data', (chunk) => {
				log = (log + chunk).slice(-2000);
				const matches = [...chunk.matchAll(/(\d+)[.,](\d+)%/g)];
				const last = matches.at(-1);
				if (last) onProgress(Number(`${last[1]}.${last[2]}`) / PERCENT);
			});
			child.on('error', reject);
			child.on('close', (code) => {
				this.#jobs.delete(jobId);
				if (child.killed) reject(new Error('Annulé'));
				else if (code === 0) resolve();
				else reject(new Error(`Real-ESRGAN a échoué (code ${code}). ${log.trim().split('\n').pop() ?? ''}`));
			});
		});
	}

	cancel(jobId) {
		this.#jobs.get(jobId)?.kill();
	}
}
