/** Catalogue partagé entre le processus principal (construction des commandes) et l'interface (choix proposés). */

export const KIND = Object.freeze({
	VIDEO: 'video',
	AUDIO: 'audio',
	IMAGE: 'image',
	ANIMATED: 'animated',
	DOCUMENT: 'document',
});

export const KIND_LABEL = Object.freeze({
	video: 'Vidéo',
	audio: 'Audio',
	image: 'Image',
	animated: 'Animation',
	document: 'Document',
});

const EXTENSIONS = {
	video: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', '3gp', 'ogv'],
	audio: ['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'wma', 'aiff', 'aif', 'amr'],
	image: ['png', 'jpg', 'jpeg', 'jfif', 'webp', 'avif', 'jxl', 'bmp', 'tif', 'tiff', 'ico', 'heic', 'heif', 'svg', 'tga', 'gif', 'apng'],
	document: ['pdf', 'docx', 'doc', 'odt', 'rtf', 'txt'],
};

const KIND_BY_EXTENSION = new Map(
	Object.entries(EXTENSIONS).flatMap(([kind, list]) => list.map((ext) => [ext, kind])),
);

export const OFFICE_EXTENSIONS = new Set(['docx', 'doc', 'odt', 'rtf', 'txt']);

export function extensionOf(path) {
	const match = /\.([^.\\/]+)$/.exec(path);
	return match ? match[1].toLowerCase() : '';
}

/** Type deviné par l'extension ; gif/webp/png animés sont reclassés après analyse. */
export function kindFromPath(path) {
	return KIND_BY_EXTENSION.get(extensionOf(path)) ?? null;
}

export const QUALITY = Object.freeze([
	{ id: 'max', label: 'Maximale' },
	{ id: 'high', label: 'Haute' },
	{ id: 'balanced', label: 'Équilibrée' },
	{ id: 'small', label: 'Légère' },
]);

/**
 * engine : ffmpeg (processus principal), pdf (pdf-lib/pdf.js dans l'interface) ou office (Word).
 * still : sortie d'une seule image ; motion : sortie animée ; audioOnly : pas de piste vidéo.
 */
export const OUTPUTS = Object.freeze({
	mp4: { label: 'MP4 · H.264', ext: 'mp4', engine: 'ffmpeg', motion: true, audio: true },
	'mp4-hevc': { label: 'MP4 · H.265', ext: 'mp4', engine: 'ffmpeg', motion: true, audio: true },
	'mp4-av1': { label: 'MP4 · AV1', ext: 'mp4', engine: 'ffmpeg', motion: true, audio: true },
	webm: { label: 'WebM · VP9', ext: 'webm', engine: 'ffmpeg', motion: true, audio: true },
	mov: { label: 'MOV · H.264', ext: 'mov', engine: 'ffmpeg', motion: true, audio: true },
	mkv: { label: 'MKV · H.264', ext: 'mkv', engine: 'ffmpeg', motion: true, audio: true },
	gif: { label: 'GIF animé', ext: 'gif', engine: 'ffmpeg', motion: true },
	'webp-anim': { label: 'WebP animé', ext: 'webp', engine: 'ffmpeg', motion: true },
	apng: { label: 'APNG', ext: 'png', engine: 'ffmpeg', motion: true },
	mp3: { label: 'MP3', ext: 'mp3', engine: 'ffmpeg', audioOnly: true },
	m4a: { label: 'M4A · AAC', ext: 'm4a', engine: 'ffmpeg', audioOnly: true },
	ogg: { label: 'OGG · Vorbis', ext: 'ogg', engine: 'ffmpeg', audioOnly: true },
	opus: { label: 'Opus', ext: 'opus', engine: 'ffmpeg', audioOnly: true },
	flac: { label: 'FLAC', ext: 'flac', engine: 'ffmpeg', audioOnly: true },
	wav: { label: 'WAV', ext: 'wav', engine: 'ffmpeg', audioOnly: true },
	png: { label: 'PNG', ext: 'png', engine: 'ffmpeg', still: true },
	jpg: { label: 'JPG', ext: 'jpg', engine: 'ffmpeg', still: true },
	webp: { label: 'WebP', ext: 'webp', engine: 'ffmpeg', still: true },
	avif: { label: 'AVIF', ext: 'avif', engine: 'ffmpeg', still: true },
	jxl: { label: 'JPEG XL', ext: 'jxl', engine: 'ffmpeg', still: true },
	bmp: { label: 'BMP', ext: 'bmp', engine: 'ffmpeg', still: true },
	tiff: { label: 'TIFF', ext: 'tiff', engine: 'ffmpeg', still: true },
	ico: { label: 'ICO', ext: 'ico', engine: 'ffmpeg', still: true },
	'image-pdf': { label: 'PDF', ext: 'pdf', engine: 'pdf', still: true },
	'upscale-2': { label: 'Agrandie ×2 (PNG)', ext: 'png', engine: 'upscale', factor: 2 },
	'upscale-4': { label: 'Agrandie ×4 (PNG)', ext: 'png', engine: 'upscale', factor: 4 },
	cutout: { label: 'Sans fond (PNG transparent)', ext: 'png', engine: 'matting' },
	'stems-wav': { label: 'Voix et musique séparées (WAV)', ext: 'wav', engine: 'stems' },
	'stems-mp3': { label: 'Voix et musique séparées (MP3)', ext: 'mp3', engine: 'stems' },
	'frames-png': { label: 'Images PNG (une par image)', ext: 'png', engine: 'ffmpeg', sequence: true },
	'frames-jpg': { label: 'Images JPG (une par image)', ext: 'jpg', engine: 'ffmpeg', sequence: true },
	sprite: { label: 'Planche de sprites PNG', ext: 'png', engine: 'ffmpeg', sprite: true },
	'subs-srt': { label: 'Sous-titres SRT', ext: 'srt', engine: 'whisper' },
	'subs-txt': { label: 'Transcription texte', ext: 'txt', engine: 'whisper' },
	'subs-burn': { label: 'MP4 sous-titré', ext: 'mp4', engine: 'whisper', burn: true },
	'pdf-png': { label: 'PNG (une par page)', ext: 'png', engine: 'pdf' },
	'pdf-jpg': { label: 'JPG (une par page)', ext: 'jpg', engine: 'pdf' },
	'pdf-txt': { label: 'Texte brut', ext: 'txt', engine: 'pdf' },
	'pdf-pages': { label: 'PDF (pages choisies)', ext: 'pdf', engine: 'pdf' },
	'pdf-edit': { label: 'PDF modifié (pages, filigrane, numéros)', ext: 'pdf', engine: 'pdf' },
	'pdf-docx': { label: 'DOCX (via Word)', ext: 'docx', engine: 'office' },
	'office-pdf': { label: 'PDF', ext: 'pdf', engine: 'office' },
	'office-docx': { label: 'DOCX', ext: 'docx', engine: 'office' },
	'office-odt': { label: 'ODT', ext: 'odt', engine: 'office' },
	'office-rtf': { label: 'RTF', ext: 'rtf', engine: 'office' },
	'office-txt': { label: 'Texte brut', ext: 'txt', engine: 'office' },
	'office-html': { label: 'HTML', ext: 'html', engine: 'office' },
});

const STILLS = ['png', 'jpg', 'webp', 'avif', 'jxl', 'bmp', 'tiff', 'ico'];
const AUDIOS = ['mp3', 'm4a', 'ogg', 'opus', 'flac', 'wav'];
const VIDEOS = ['mp4', 'mp4-hevc', 'mp4-av1', 'webm', 'mov', 'mkv'];
const ANIMS = ['gif', 'webp-anim', 'apng'];
const FRAMES = ['frames-png', 'frames-jpg', 'sprite'];
const SUBTITLES = ['subs-srt', 'subs-txt', 'subs-burn'];
const STEMS = ['stems-mp3', 'stems-wav'];

/** Sorties proposées selon le type d'entrée (ext sert à distinguer PDF et traitement de texte). */
export function outputsFor(kind, ext) {
	switch (kind) {
		case KIND.VIDEO: return [...VIDEOS, ...ANIMS, ...AUDIOS, ...STEMS, ...STILLS, ...FRAMES, ...SUBTITLES];
		case KIND.ANIMATED: return [...ANIMS, ...VIDEOS, ...STILLS, ...FRAMES];
		case KIND.AUDIO: return [...AUDIOS, ...STEMS, 'subs-srt', 'subs-txt'];
		case KIND.IMAGE: return [...STILLS, 'image-pdf', 'upscale-2', 'upscale-4', 'cutout'];
		case KIND.DOCUMENT:
			return ext === 'pdf'
				? ['pdf-edit', 'pdf-png', 'pdf-jpg', 'pdf-txt', 'pdf-pages', 'pdf-docx']
				: ['office-pdf', 'office-docx', 'office-odt', 'office-rtf', 'office-txt', 'office-html'];
		default: return [];
	}
}

export function defaultOutputFor(kind, ext) {
	const defaults = { video: 'mp4', animated: 'gif', audio: 'mp3', image: ext === 'png' ? 'webp' : 'png' };
	if (kind === KIND.DOCUMENT) return ext === 'pdf' ? 'pdf-png' : 'office-pdf';
	return defaults[kind];
}

export const FILTERS = Object.freeze([
	{ id: 'none', label: 'Aucun' },
	{ id: 'grayscale', label: 'Noir et blanc' },
	{ id: 'sepia', label: 'Sépia' },
	{ id: 'vintage', label: 'Vintage' },
	{ id: 'cool', label: 'Froid' },
	{ id: 'warm', label: 'Chaud' },
	{ id: 'invert', label: 'Négatif' },
	{ id: 'sharpen', label: 'Netteté' },
	{ id: 'blur', label: 'Flou' },
]);

export const SUB_LANGUAGES = Object.freeze([
	{ id: 'auto', label: 'Détection automatique' }, { id: 'fr', label: 'Français' }, { id: 'en', label: 'Anglais' },
	{ id: 'es', label: 'Espagnol' }, { id: 'de', label: 'Allemand' }, { id: 'it', label: 'Italien' }, { id: 'pt', label: 'Portugais' },
	{ id: 'nl', label: 'Néerlandais' }, { id: 'ja', label: 'Japonais' }, { id: 'ko', label: 'Coréen' }, { id: 'zh', label: 'Chinois' },
]);

export const SUB_MODELS = Object.freeze([
	{ id: 'base', label: 'Rapide', detail: '148 Mo, à peu près le temps réel' },
	{ id: 'turbo', label: 'Précis', detail: '574 Mo, 3 à 6 fois plus lent' },
]);

export const UPSCALE_STYLES = Object.freeze([
	{ id: 'photo', label: 'Photo' },
	{ id: 'drawing', label: 'Dessin, anime' },
]);

export const TEXT_POSITIONS = Object.freeze([
	{ id: 'top', label: 'En haut' },
	{ id: 'center', label: 'Au centre' },
	{ id: 'bottom', label: 'En bas' },
]);

/**
 * Préréglage « Discord » : limite d'envoi gratuite de 10 Mo, avec une marge pour l'écart du débit moyen.
 * La largeur plafonnée garde un débit par pixel correct sur les vidéos longues.
 */
export const DISCORD_PRESET = Object.freeze({ output: 'mp4', targetSizeMb: 9.3, maxWidth: 1280 });

/** Recette vierge : chaque édition est neutre tant qu'on n'y touche pas. */
export function emptyRecipe(output) {
	return {
		output,
		quality: 'high',
		targetSizeMb: null,
		gpu: false,
		crop: null,
		rotate: 0,
		flipH: false,
		flipV: false,
		width: null,
		height: null,
		trim: null,
		frameTime: 0,
		speed: 1,
		reverse: false,
		boomerang: false,
		fps: null,
		loop: true,
		adjust: { brightness: 0, contrast: 1, saturation: 1, gamma: 1, hue: 0 },
		filter: 'none',
		text: { content: '', size: 8, color: '#ffffff', position: 'bottom' },
		mute: false,
		volume: 1,
		fadeIn: 0,
		fadeOut: 0,
		normalize: false,
		stripMetadata: false,
		spriteColumns: null,
		subLanguage: 'auto',
		subModel: 'base',
		pageOrder: null,
		watermark: { text: '', opacity: 0.18, size: 12 },
		pageNumbers: false,
		upscaleModel: 'photo',
		pages: '',
		dpi: 150,
	};
}
