import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';

const execFileAsync = promisify(execFile);
const MAX_URL_LENGTH = 2048;
const UPDATE_TIMEOUT_MS = 120_000;
const TITLE_MAX_BYTES = 120;
const WINGET_LINKS = join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links');

/** Formats demandés à yt-dlp selon l'usage choisi dans l'interface. */
const FORMATS = {
	// H.264 + AAC d'abord : un MP4 lisible partout, plafonné de fait à 1080p sur YouTube.
	mp4: ['-f', 'bv*[vcodec^=avc1]+ba[acodec^=mp4a]/bv*+ba/b', '--merge-output-format', 'mp4'],
	mp3: ['-f', 'ba/b'],
	edit: ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'],
};

export const LINK_MODES = Object.freeze(Object.keys(FORMATS));

/** Erreurs courantes de yt-dlp (lignes « ERROR: … », en anglais) et leur explication. */
const YTDLP_ERRORS = [
	[/Private video|This video is private/i, 'Vidéo privée : seul son auteur peut la voir.'],
	[/Sign in to confirm your age|age-restricted|inappropriate for some users/i, 'Vidéo soumise à une limite d’âge : YouTube exige une connexion, que yt-dlp ne fait pas ici.'],
	[/Sign in to confirm you.re not a bot|confirm you are not a bot/i, 'YouTube demande de prouver qu’on n’est pas un robot. Réessaie plus tard, ou mets yt-dlp à jour.'],
	[/not available in your country|geo.?restrict|blocked it in your country/i, 'Vidéo bloquée dans ton pays.'],
	[/members-only|Join this channel/i, 'Vidéo réservée aux membres de la chaîne.'],
	[/Premieres in|live event will begin|This live event/i, 'La vidéo n’est pas encore diffusée (première ou direct à venir).'],
	[/Video unavailable|This video is unavailable|has been removed|does not exist|HTTP Error 404/i, 'Vidéo introuvable : elle a été supprimée, ou le lien est faux.'],
	[/Unsupported URL/i, 'Ce site n’est pas pris en charge par yt-dlp, ou le lien ne mène pas à une vidéo.'],
	[/Requested format is not available/i, 'Ce format n’existe pas pour cette vidéo. Essaie le mode « À éditer ».'],
	[/HTTP Error 403|Forbidden/i, 'Le site refuse le téléchargement (HTTP 403). Mets yt-dlp à jour puis réessaie.'],
	[/HTTP Error 429|Too Many Requests/i, 'Trop de téléchargements d’affilée : le site bloque temporairement. Réessaie dans quelques minutes.'],
	[/Unable to download webpage|getaddrinfo|Failed to resolve|Connection refused|timed out|Network is unreachable/i, 'Pas de connexion à Internet, ou le site est injoignable.'],
	[/No space left on device/i, 'Disque plein : libère de la place dans le dossier Téléchargements.'],
	[/ffmpeg.*(not found|failed)|Postprocessing/i, 'La vidéo a été téléchargée mais l’assemblage image + son a échoué.'],
];

/**
 * Une installation système (que l'utilisateur met à jour) passe avant la copie embarquée,
 * qui vieillit avec l'installeur ; celle-ci se met à jour seule via `yt-dlp -U` (voir update()).
 */
export function locateYtdlp() {
	const bundled = process.resourcesPath ? join(process.resourcesPath, 'bin') : null;
	const dirs = [process.env.ALAMBIC_YTDLP_DIR, ...(process.env.PATH ?? '').split(delimiter), WINGET_LINKS, bundled].filter(Boolean);
	for (const dir of dirs) {
		const candidate = join(dir, 'yt-dlp.exe');
		if (existsSync(candidate)) return { path: candidate, bundled: dir === bundled };
	}
	return null;
}

/** Refuse tout ce qui n'est pas une adresse http(s) ; le `--` des arguments empêche une URL de passer pour une option. */
export function validateUrl(text) {
	const value = String(text ?? '').trim();
	if (!value || value.length > MAX_URL_LENGTH) throw new Error('Lien vide ou trop long');
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error('Ce texte n’est pas un lien');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Seuls les liens http et https sont acceptés');
	return url.href;
}

export function buildDownloadArgs(url, mode, { directory, ffmpegDir }) {
	if (!FORMATS[mode]) throw new Error(`Mode de téléchargement inconnu : ${mode}`);
	return [
		// --print passe yt-dlp en mode silencieux : --progress rétablit les lignes de progression.
		'--no-playlist', '--newline', '--progress', '--no-colors', '--encoding', 'utf-8', '--no-mtime',
		...(ffmpegDir ? ['--ffmpeg-location', ffmpegDir] : []),
		'-P', directory,
		'-o', `%(title).${TITLE_MAX_BYTES}B [%(id)s].%(ext)s`,
		'--progress-template', 'download:PROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes,progress.total_bytes_estimate)s',
		'--print', 'before_dl:TITLE %(title)s',
		'--print', 'after_move:FILE %(filepath)s',
		'--no-simulate',
		...FORMATS[mode],
		'--', url,
	];
}

export class Ytdlp {
	#path;
	#bundled;
	#jobs = new Map();

	constructor({ path, bundled }) {
		this.#path = path;
		this.#bundled = bundled;
	}

	get bundled() {
		return this.#bundled;
	}

	/** `yt-dlp -U` remplace l'exécutable embarqué par la dernière version publiée (vérifiée par yt-dlp lui-même). */
	async update() {
		if (!this.#bundled) throw new Error('yt-dlp est installé sur le système : mets-le à jour avec « winget upgrade yt-dlp.yt-dlp ».');
		const { stdout } = await execFileAsync(this.#path, ['-U'], { timeout: UPDATE_TIMEOUT_MS, windowsHide: true });
		return stdout.trim().split('\n').pop();
	}

	/**
	 * Télécharge et renvoie le chemin du fichier final.
	 * onEvent reçoit { title } puis des { ratio } ; YouTube livre image et son séparément, le ratio repart donc à 0 entre les deux.
	 */
	download(jobId, args, onEvent) {
		return new Promise((resolve, reject) => {
			const child = spawn(this.#path, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
			this.#jobs.set(jobId, child);
			let file = null;
			let stderr = '';
			let pending = '';
			child.stdout.setEncoding('utf8');
			child.stdout.on('data', (chunk) => {
				pending += chunk;
				const lines = pending.split(/\r?\n/);
				pending = lines.pop();
				for (const line of lines) file = this.#parse(line, onEvent) ?? file;
			});
			child.stderr.setEncoding('utf8');
			child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
			child.on('error', reject);
			child.on('close', (code) => {
				this.#jobs.delete(jobId);
				if (child.killed) reject(new Error('Annulé'));
				else if (code === 0 && file) resolve(file);
				else reject(new Error(this.#explain(stderr, code)));
			});
		});
	}

	#parse(line, onEvent) {
		if (line.startsWith('TITLE ')) onEvent({ title: line.slice('TITLE '.length) });
		if (line.startsWith('FILE ')) return line.slice('FILE '.length).trim();
		if (line.startsWith('PROGRESS ')) {
			const [done, total] = line.slice('PROGRESS '.length).split(' ').map(Number);
			if (total > 0) onEvent({ ratio: Math.min(1, done / total) });
		}
		return null;
	}

	#explain(stderr, code) {
		const error = stderr.split('\n').filter((line) => line.startsWith('ERROR')).pop()?.replace(/^ERROR:\s*/, '');
		const known = YTDLP_ERRORS.find(([pattern]) => pattern.test(stderr))?.[1];
		if (known) return known;
		const hint = this.#bundled
			? 'Si le site a changé, mets yt-dlp à jour avec le bouton ci-dessous.'
			: 'Si le site a changé, mets yt-dlp à jour : winget upgrade yt-dlp.yt-dlp';
		return `${error ?? `yt-dlp a quitté avec le code ${code}`}\n${hint}`;
	}

	cancel(jobId) {
		this.#jobs.get(jobId)?.kill();
	}

	cancelAll() {
		for (const child of this.#jobs.values()) child.kill();
	}
}
