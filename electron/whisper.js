import { access, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { downloadFile } from './download.js';

const HF = 'https://huggingface.co';
/** Modèles whisper.cpp (format ggml) ; la détection de parole (VAD) découpe les phrases proprement. */
export const MODELS = Object.freeze({
	base: { file: 'ggml-base.bin', url: `${HF}/ggerganov/whisper.cpp/resolve/main/ggml-base.bin`, sizeMb: 148 },
	turbo: { file: 'ggml-large-v3-turbo-q5_0.bin', url: `${HF}/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin`, sizeMb: 574 },
	vad: { file: 'ggml-silero-v5.1.2.bin', url: `${HF}/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin`, sizeMb: 1 },
});
export const LANGUAGES = Object.freeze(['auto', 'fr', 'en', 'es', 'de', 'it', 'pt', 'nl', 'ja', 'ko', 'zh']);

const WHISPER_SAMPLE_RATE = 16000;
/** Avec la VAD, une file longue laisse whisper voir des phrases entières. */
const QUEUE_SECONDS = 20;
const BYTES_PER_MB = 1_000_000;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

export class ModelStore {
	#dir;
	#downloads = new Map();

	constructor(dir) {
		this.#dir = dir;
	}

	path(name) {
		return join(this.#dir, MODELS[name].file);
	}

	async has(name) {
		return access(this.path(name)).then(() => true, () => false);
	}

	async status() {
		const entries = await Promise.all(Object.keys(MODELS).map(async (name) => [name, await this.has(name)]));
		return Object.fromEntries(entries);
	}

	async download(name, onProgress) {
		const model = MODELS[name];
		if (!model) throw new Error('Modèle inconnu');
		if (this.#downloads.has(name)) throw new Error('Téléchargement déjà en cours');
		await mkdir(this.#dir, { recursive: true });
		const controller = new AbortController();
		this.#downloads.set(name, controller);
		try {
			await downloadFile(model.url, this.path(name), { onProgress, signal: controller.signal, expectedBytes: model.sizeMb * BYTES_PER_MB });
		} finally {
			this.#downloads.delete(name);
		}
	}

	cancel(name) {
		this.#downloads.get(name)?.abort();
	}
}

/**
 * Chemin utilisable dans un graphe de filtres : relatif au dossier de travail et en barres obliques,
 * ce qui évite d'échapper le « C: » ; impossible si les deux sont sur des lecteurs différents.
 */
export function filterPath(target, cwd) {
	const path = relative(cwd, target).replaceAll('\\', '/');
	if (/^[a-z]:/i.test(path) || /[:',;[\]]/.test(path)) throw new Error('Le modèle doit être sur le même disque que le dossier temporaire');
	return path;
}

export function buildWhisperArgs({ input, trim, language, modelPath, vadPath, destination }) {
	const seek = [];
	if (trim?.start) seek.push('-ss', String(trim.start));
	if (trim) seek.push('-t', String(trim.end - trim.start));
	const options = [
		`model=${modelPath}`, `language=${LANGUAGES.includes(language) ? language : 'auto'}`,
		`queue=${QUEUE_SECONDS}`, `vad_model=${vadPath}`, `destination=${destination}`, 'format=srt',
	];
	return [...seek, '-i', input, '-vn', '-af', `aresample=${WHISPER_SAMPLE_RATE},whisper=${options.join(':')}`, '-f', 'null', '-'];
}

const TIME = /(\d{2}):(\d{2}):(\d{2}),(\d{3})/;
const toSeconds = (stamp) => {
	const [, h, m, s, ms] = TIME.exec(stamp).map(Number);
	return h * SECONDS_PER_HOUR + m * SECONDS_PER_MINUTE + s + ms / MS_PER_SECOND;
};
const toStamp = (seconds) => {
	const total = Math.round(seconds * MS_PER_SECOND);
	const pad = (n, width = 2) => String(n).padStart(width, '0');
	const h = Math.floor(total / (SECONDS_PER_HOUR * MS_PER_SECOND));
	const m = Math.floor(total / (SECONDS_PER_MINUTE * MS_PER_SECOND)) % SECONDS_PER_MINUTE;
	const s = Math.floor(total / MS_PER_SECOND) % SECONDS_PER_MINUTE;
	return `${pad(h)}:${pad(m)}:${pad(s)},${pad(total % MS_PER_SECOND, 3)}`;
};

export function parseSrt(text) {
	return text.replace(/\r/g, '').split(/\n{2,}/).map((block) => {
		const lines = block.trim().split('\n');
		const timing = lines.findIndex((line) => line.includes('-->'));
		if (timing < 0) return null;
		const [start, end] = lines[timing].split('-->').map((part) => toSeconds(part.trim()));
		return { start, end, text: lines.slice(timing + 1).join('\n').trim() };
	}).filter((cue) => cue && cue.text);
}

/** whisper numérote à partir de 0 et fait chevaucher des segments : on renumérote et on coupe les chevauchements. */
export function tidySrt(text) {
	const cues = parseSrt(text).sort((a, b) => a.start - b.start);
	cues.forEach((cue, index) => {
		const next = cues[index + 1];
		if (next && cue.end > next.start) cue.end = Math.max(cue.start, next.start);
	});
	return cues.map((cue, index) => `${index + 1}\n${toStamp(cue.start)} --> ${toStamp(cue.end)}\n${cue.text}\n`).join('\n');
}

export function srtToText(text) {
	return parseSrt(text).map((cue) => cue.text).join('\n');
}
