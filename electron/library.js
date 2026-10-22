import { randomUUID } from 'node:crypto';
import { open, readdir, stat, mkdir, rm, writeFile, copyFile, access } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { KIND, kindFromPath, extensionOf } from '../shared/formats.js';

const RIFF_HEADER_BYTES = 32;
const VP8X_FLAGS_OFFSET = 20;
const VP8X_ANIMATION_FLAG = 0x02;
const MAX_FOLDER_DEPTH = 8;
const MAX_FILES = 5000;
const MAX_NAME_SUFFIX = 9999;
const MIN_ANIMATION_SECONDS = 0.1;
const QUARTER_TURN = 90;
const THREE_QUARTER_TURN = 270;
const FONT_CANDIDATES = ['segoeuib.ttf', 'arialbd.ttf', 'arial.ttf'];

/**
 * Registre des fichiers ajoutés par l'utilisateur. Tout accès disque demandé par l'interface
 * passe par un identifiant de ce registre : l'interface ne fournit jamais un chemin à lire.
 */
export class Library {
	#items = new Map();
	#root = join(tmpdir(), 'alambic');

	/** Dossier de travail propre à cette session : un ancien dossier verrouillé (EBUSY) ne bloque pas le démarrage. */
	async init() {
		await rm(this.#root, { recursive: true, force: true }).catch(() => {});
		this.#root = join(this.#root, randomUUID());
		await mkdir(this.#root, { recursive: true });
	}

	async dispose() {
		await rm(this.#root, { recursive: true, force: true }).catch(() => {});
	}

	get(id) {
		const item = this.#items.get(id);
		if (!item) throw new Error('Fichier inconnu');
		return item;
	}

	has(path) {
		for (const item of this.#items.values()) if (item.path === path || item.source === path) return true;
		return false;
	}

	/** Ajoute des fichiers ou dossiers (parcourus récursivement) ; ignore les types inconnus. */
	async add(paths) {
		const files = [];
		for (const path of paths) await this.#collect(path, files, 0);
		const added = [];
		for (const path of files) {
			const kind = kindFromPath(path);
			const { size } = await stat(path);
			const item = { id: randomUUID(), path, source: path, kind, ext: extensionOf(path), size, name: basename(path) };
			this.#items.set(item.id, item);
			added.push(item);
		}
		return added;
	}

	async #collect(path, files, depth) {
		if (files.length >= MAX_FILES) return;
		const info = await stat(path).catch(() => null);
		if (!info) return;
		if (info.isDirectory()) {
			if (depth >= MAX_FOLDER_DEPTH) return;
			for (const entry of await readdir(path)) await this.#collect(join(path, entry), files, depth + 1);
		} else if (kindFromPath(path)) {
			files.push(path);
		}
	}

	remove(id) {
		const item = this.#items.get(id);
		this.#items.delete(id);
		if (item?.workDir) rm(item.workDir, { recursive: true, force: true }).catch(() => {});
	}

	async workDir(id) {
		const item = this.get(id);
		if (!item.workDir) {
			item.workDir = join(this.#root, id);
			await mkdir(item.workDir, { recursive: true });
			await this.#installFont(item.workDir);
		}
		return item.workDir;
	}

	async #installFont(dir) {
		const fonts = join(process.env.WINDIR ?? 'C:\\Windows', 'Fonts');
		for (const name of FONT_CANDIDATES) {
			try {
				await copyFile(join(fonts, name), join(dir, 'font.ttf'));
				return;
			} catch { /* police suivante */ }
		}
	}

	async writeText(id, text) {
		await writeFile(join(await this.workDir(id), 'text.txt'), text, 'utf8');
	}

	/** Chemin de sortie libre : « nom.ext », puis « nom (2).ext »… jamais d'écrasement. */
	async outputPath(id, ext, outputDir, suffix = '') {
		const item = this.get(id);
		const dir = outputDir ?? dirname(item.path);
		const stem = basename(item.path, extname(item.path)) + suffix;
		for (let n = 1; n <= MAX_NAME_SUFFIX; n++) {
			const candidate = join(dir, `${stem}${n === 1 ? '' : ` (${n})`}.${ext}`);
			if (candidate === item.path) continue;
			const taken = await access(candidate).then(() => true, () => false);
			if (!taken) return candidate;
		}
		throw new Error('Aucun nom de fichier libre');
	}

	/** Dossier neuf « nom - images », « nom - images (2) »… pour les sorties image par image. */
	async outputFolder(id, outputDir, suffix) {
		const item = this.get(id);
		const parent = outputDir ?? dirname(item.path);
		const stem = basename(item.path, extname(item.path)) + suffix;
		for (let n = 1; n <= MAX_NAME_SUFFIX; n++) {
			const candidate = join(parent, `${stem}${n === 1 ? '' : ` (${n})`}`);
			const taken = await access(candidate).then(() => true, () => false);
			if (!taken) {
				await mkdir(candidate, { recursive: true });
				return candidate;
			}
		}
		throw new Error('Aucun nom de dossier libre');
	}
}

/** Le bit « animation » du bloc VP8X distingue un WebP animé d'un WebP fixe. */
export async function isAnimatedWebp(path) {
	const handle = await open(path, 'r');
	try {
		const buffer = Buffer.alloc(RIFF_HEADER_BYTES);
		await handle.read(buffer, 0, RIFF_HEADER_BYTES, 0);
		const isVp8x = buffer.toString('ascii', 12, 16) === 'VP8X';
		return isVp8x && (buffer[VP8X_FLAGS_OFFSET] & VP8X_ANIMATION_FLAG) !== 0;
	} finally {
		await handle.close();
	}
}

/** Résume la sortie de ffprobe et reclasse les images qui ont plusieurs images (GIF, APNG). */
export function summarize(item, probe) {
	const video = probe.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
	const audio = probe.streams.find((s) => s.codec_type === 'audio');
	const duration = Number.parseFloat(probe.format?.duration) || null;
	const [num, den] = (video?.avg_frame_rate ?? '0/1').split('/').map(Number);
	const fps = den ? num / den : null;
	let { kind } = item;
	const frames = Number.parseInt(video?.nb_frames, 10);
	const multiFrameGif = video?.codec_name === 'gif' && (frames > 1 || (duration ?? 0) > MIN_ANIMATION_SECONDS);
	if (kind === KIND.IMAGE && (multiFrameGif || video?.codec_name === 'apng')) kind = KIND.ANIMATED;
	if (kind === KIND.VIDEO && !video && audio) kind = KIND.AUDIO;
	// Vidéo de téléphone : ffmpeg applique la rotation des métadonnées, les dimensions utiles sont donc inversées.
	const rotation = Math.abs(Number(video?.side_data_list?.find((data) => 'rotation' in data)?.rotation ?? 0));
	const quarterTurn = rotation === QUARTER_TURN || rotation === THREE_QUARTER_TURN;
	return {
		kind,
		width: (quarterTurn ? video?.height : video?.width) ?? null,
		height: (quarterTurn ? video?.width : video?.height) ?? null,
		duration: kind === KIND.IMAGE ? null : duration,
		fps: fps && Number.isFinite(fps) ? fps : null,
		hasAudio: Boolean(audio),
		hasVideo: Boolean(video),
		codec: video?.codec_name ?? audio?.codec_name ?? null,
	};
}
