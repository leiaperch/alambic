import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 20_000;
const FRAME_TIMEOUT_MS = 20_000;
const PROBE_MAX_BUFFER = 16 * 1024 * 1024;
const FRAME_MAX_BUFFER = 64 * 1024 * 1024;
const RAW_TIMEOUT_MS = 600_000;
/** Un morceau de 10 minutes en float32 stéréo 44,1 kHz pèse environ 210 Mo. */
const RAW_MAX_BUFFER = 1024 * 1024 * 1024;
const MICROSECONDS = 1_000_000;
const HARDWARE_TEST_SOURCE = 'color=s=256x256:d=0.2';
const HARDWARE_CANDIDATES = {
	h264: ['h264_nvenc', 'h264_qsv', 'h264_amf'],
	hevc: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf'],
	av1: ['av1_nvenc', 'av1_qsv', 'av1_amf'],
};
const WINGET_PACKAGES = join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages');

/** Cherche ffmpeg/ffprobe : variable ALAMBIC_FFMPEG_DIR, copie embarquée, PATH, puis le paquet WinGet Gyan. */
async function locateBinaries() {
	const candidates = [];
	if (process.env.ALAMBIC_FFMPEG_DIR) candidates.push(process.env.ALAMBIC_FFMPEG_DIR);
	// Copie embarquée par l'installeur (resources/bin) : prioritaire, ses codecs sont ceux qui ont été testés.
	if (process.resourcesPath) candidates.push(join(process.resourcesPath, 'bin'));
	candidates.push(...(process.env.PATH ?? '').split(delimiter));
	if (existsSync(WINGET_PACKAGES)) {
		const { readdirSync } = await import('node:fs');
		for (const pkg of readdirSync(WINGET_PACKAGES).filter((name) => name.startsWith('Gyan.FFmpeg'))) {
			for (const build of readdirSync(join(WINGET_PACKAGES, pkg))) candidates.push(join(WINGET_PACKAGES, pkg, build, 'bin'));
		}
	}
	for (const dir of candidates) {
		const ffmpeg = join(dir, 'ffmpeg.exe');
		const ffprobe = join(dir, 'ffprobe.exe');
		if (existsSync(ffmpeg) && existsSync(ffprobe)) return { ffmpeg, ffprobe };
	}
	return null;
}

export class Ffmpeg {
	#bin = null;
	#jobs = new Map();

	async init() {
		this.#bin = await locateBinaries();
		if (!this.#bin) return { ok: false };
		this.hardware = await this.#detectHardware();
		return { ok: true, path: this.#bin.ffmpeg, hardware: this.hardware };
	}

	/**
	 * Un encodeur matériel peut être compilé dans ffmpeg sans pilote derrière (h264_nvenc sans carte NVIDIA) :
	 * on garde, par codec, le premier qui encode réellement une image de test.
	 */
	async #detectHardware() {
		const hardware = {};
		for (const [codec, candidates] of Object.entries(HARDWARE_CANDIDATES)) {
			for (const encoder of candidates) {
				const works = await execFileAsync(this.#bin.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', HARDWARE_TEST_SOURCE, '-c:v', encoder, '-f', 'null', '-'], { timeout: PROBE_TIMEOUT_MS, windowsHide: true })
					.then(() => true, () => false);
				if (works) {
					hardware[codec] = encoder;
					break;
				}
			}
		}
		return hardware;
	}

	async probe(path) {
		const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path];
		const { stdout } = await execFileAsync(this.#bin.ffprobe, args, { timeout: PROBE_TIMEOUT_MS, maxBuffer: PROBE_MAX_BUFFER });
		return JSON.parse(stdout);
	}

	/** Rend une image PNG en mémoire (aperçu, vignette). */
	/** Sortie brute de ffmpeg en mémoire (pixels bruts pour le détourage, échantillons pour la séparation). */
	async raw(args, { cwd } = {}) {
		const { stdout } = await execFileAsync(this.#bin.ffmpeg, ['-v', 'error', ...args], {
			cwd,
			encoding: 'buffer',
			timeout: RAW_TIMEOUT_MS,
			maxBuffer: RAW_MAX_BUFFER,
			windowsHide: true,
		});
		return stdout;
	}

	/** Lance ffmpeg pour ses mesures : renvoie stderr (astats, vidstabdetect…), sortie vers null. */
	async measure(args, { cwd } = {}) {
		const { stderr } = await execFileAsync(this.#bin.ffmpeg, ['-hide_banner', '-nostats', ...args], {
			cwd,
			timeout: RAW_TIMEOUT_MS,
			maxBuffer: PROBE_MAX_BUFFER,
			windowsHide: true,
		});
		return stderr;
	}

	async frame(args, { cwd } = {}) {
		const { stdout } = await execFileAsync(this.#bin.ffmpeg, ['-v', 'error', ...args, '-f', 'image2pipe', '-c:v', 'png', 'pipe:1'], {
			cwd,
			encoding: 'buffer',
			timeout: FRAME_TIMEOUT_MS,
			maxBuffer: FRAME_MAX_BUFFER,
		});
		return stdout;
	}

	/**
	 * Lance un encodage ; onProgress reçoit un ratio 0..1 calculé sur `duration` (secondes de sortie).
	 * Une sortie en erreur rejette avec les dernières lignes de stderr.
	 */
	run(jobId, args, { duration, cwd, onProgress }) {
		return new Promise((resolve, reject) => {
			const child = spawn(this.#bin.ffmpeg, ['-hide_banner', '-nostats', '-progress', 'pipe:1', '-y', ...args], { cwd, windowsHide: true });
			this.#jobs.set(jobId, child);
			let stderr = '';
			let pending = '';
			child.stdout.on('data', (chunk) => {
				pending += chunk;
				const lines = pending.split('\n');
				pending = lines.pop();
				for (const line of lines) {
					const [key, value] = line.split('=');
					if (key === 'out_time_us' && duration > 0) onProgress(Math.min(1, Number(value) / MICROSECONDS / duration));
				}
			});
			child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
			child.on('error', reject);
			child.on('close', (code, signal) => {
				this.#jobs.delete(jobId);
				if (code === 0) resolve();
				else if (signal || child.killed) reject(new Error('Annulé'));
				else reject(new Error(stderr.trim().split('\n').slice(-3).join('\n') || `ffmpeg a quitté avec le code ${code}`));
			});
		});
	}

	cancel(jobId) {
		this.#jobs.get(jobId)?.kill();
	}

	cancelAll() {
		for (const child of this.#jobs.values()) child.kill();
	}
}
