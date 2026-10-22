import { OUTPUTS } from '../shared/formats.js';

/**
 * Traduit une recette en arguments ffmpeg. Fonctions pures : aucun accès disque.
 * Le texte incrusté et la police sont lus en chemins relatifs (TEXT_FILE, FONT_FILE) :
 * ffmpeg doit donc tourner avec cwd = dossier de travail de l'élément, ce qui évite
 * l'échappement des « C:\ » dans le graphe de filtres.
 */

export const TEXT_FILE = 'text.txt';
export const FONT_FILE = 'font.ttf';

const QUALITY_INDEX = { max: 0, high: 1, balanced: 2, small: 3 };
const CRF = {
	libx264: [16, 20, 23, 28],
	libx265: [18, 22, 26, 30],
	libsvtav1: [22, 28, 34, 40],
	'libvpx-vp9': [20, 28, 33, 40],
	hardware: [18, 22, 26, 32],
};
const GIF_COLORS = [256, 256, 192, 128];
const WEBP_QUALITY = [95, 85, 75, 60];
const JPG_QSCALE = [2, 3, 5, 8];
const AVIF_CRF = [18, 24, 30, 38];
const JXL_DISTANCE = [0.5, 1, 2, 3];
const MP3_VBR = [0, 2, 4, 6];
const AAC_KBPS = [256, 192, 160, 128];
const VORBIS_Q = [8, 6, 5, 3];
const OPUS_KBPS = [192, 160, 128, 96];
const VIDEO_AUDIO_KBPS = 192;
const ICO_MAX_SIZE = 256;
/** Une vidéo 60 i/s en GIF donne des fichiers énormes : sans réglage explicite, on descend à 20 i/s. */
const ANIM_DEFAULT_FPS_FROM_VIDEO = 20;
const ATEMPO_MIN = 0.5;
const ATEMPO_MAX = 2;
const TARGET_MAXRATE_FACTOR = 1.5;
const TARGET_BUFSIZE_FACTOR = 2;
const MIN_VIDEO_KBPS = 50;
const BITS_PER_BYTE = 8;
const BYTES_PER_MB = 1_000_000;
const TEXT_BORDER_RATIO = 0.08;
const TEXT_MARGIN_RATIO = 0.04;
const PERCENT = 100;
const FALLBACK_TEXT_HEIGHT = 720;
const LOUDNESS_TARGET = -16;
const TRUE_PEAK = -1.5;
const LOUDNESS_RANGE = 11;
const AUDIO_SAMPLE_RATE = 48000;
const SPRITE_DEFAULT_FPS = 12;
const SUBTITLE_STYLE = 'FontName=Segoe UI Semibold,Fontsize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H99000000,BorderStyle=1,Outline=1.6,Shadow=0,MarginV=18';
/** Au-delà, la planche dépasse vite les limites de taille d'image des encodeurs et des navigateurs. */
const SPRITE_MAX_FRAMES = 400;

const SEPIA_MATRIX = '.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131';
const FILTER_GRAPHS = {
	none: null,
	grayscale: 'hue=s=0',
	sepia: `colorchannelmixer=${SEPIA_MATRIX}`,
	vintage: 'curves=preset=vintage',
	cool: 'colorbalance=rs=-0.1:bs=0.15:rm=-0.05:bm=0.1',
	warm: 'colorbalance=rs=0.15:bs=-0.1:rm=0.1:bm=-0.05',
	invert: 'negate',
	sharpen: 'unsharp=5:5:1.0',
	blur: 'gblur=sigma=3',
};

const q = (recipe) => QUALITY_INDEX[recipe.quality] ?? QUALITY_INDEX.high;

/** Durée de la portion utile de la source, avant changement de vitesse. */
export function trimmedDuration(source, recipe) {
	const start = recipe.trim?.start ?? 0;
	const end = recipe.trim?.end ?? source.duration ?? 0;
	return Math.max(0, end - start);
}

/** Durée du fichier produit, utilisée pour la barre de progression et le débit cible. */
export function outputDuration(source, recipe) {
	const base = trimmedDuration(source, recipe) / (recipe.speed || 1);
	return recipe.boomerang ? base * 2 : base;
}

function geometryFilters(source, recipe, { evenDimensions }) {
	const chain = [];
	const { crop } = recipe;
	if (crop) chain.push(`crop=${Math.round(crop.w)}:${Math.round(crop.h)}:${Math.round(crop.x)}:${Math.round(crop.y)}`);
	if (recipe.rotate === 90) chain.push('transpose=1');
	if (recipe.rotate === 180) chain.push('hflip', 'vflip');
	if (recipe.rotate === 270) chain.push('transpose=2');
	if (recipe.flipH) chain.push('hflip');
	if (recipe.flipV) chain.push('vflip');
	if (recipe.width || recipe.height) chain.push(`scale=${recipe.width || -1}:${recipe.height || -1}:flags=lanczos`);
	// Les codecs vidéo en 4:2:0 refusent les dimensions impaires.
	if (evenDimensions) chain.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
	return chain;
}

function colorFilters(recipe) {
	const chain = [];
	const { brightness, contrast, saturation, gamma, hue } = recipe.adjust;
	if (brightness !== 0 || contrast !== 1 || saturation !== 1 || gamma !== 1) {
		chain.push(`eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}:gamma=${gamma}`);
	}
	if (hue !== 0) chain.push(`hue=h=${hue}`);
	const graph = FILTER_GRAPHS[recipe.filter];
	if (graph) chain.push(graph);
	return chain;
}

/** Hauteur finale après recadrage, rotation et redimensionnement ; null si la source n'est pas mesurée. */
export function outputHeight(source, recipe) {
	let width = recipe.crop?.w ?? source.width;
	let height = recipe.crop?.h ?? source.height;
	if (!width || !height) return null;
	if (recipe.rotate === 90 || recipe.rotate === 270) [width, height] = [height, width];
	if (recipe.height) return recipe.height;
	if (recipe.width) return Math.round((height * recipe.width) / width);
	return height;
}

function textFilter(source, recipe) {
	const { content, size, color, position } = recipe.text;
	if (!content.trim()) return [];
	const fontSize = `h*${size / PERCENT}`;
	const margin = `h*${TEXT_MARGIN_RATIO}`;
	const y = { top: margin, center: '(h-text_h)/2', bottom: `h-text_h-${margin}` }[position];
	// borderw n'accepte pas d'expression : épaisseur calculée ici en pixels.
	const height = outputHeight(source, recipe) ?? FALLBACK_TEXT_HEIGHT;
	const border = Math.max(1, Math.round(height * (size / PERCENT) * TEXT_BORDER_RATIO));
	return [
		`drawtext=fontfile=${FONT_FILE}:textfile=${TEXT_FILE}:expansion=none:fontsize=${fontSize}:fontcolor=${color}`
		+ `:borderw=${border}:bordercolor=black@0.85:x=(w-text_w)/2:y=${y}`,
	];
}

/**
 * Sous-titres incrustés, posés avant le changement de vitesse pour rester calés sur la parole.
 * `subtitleFile` n'est jamais saisi par l'utilisateur : le processus principal le fixe au nom relatif du .srt produit.
 */
function subtitleFilter(recipe) {
	if (!recipe.subtitleFile) return [];
	return [`subtitles=${recipe.subtitleFile}:force_style='${SUBTITLE_STYLE}'`];
}

function atempoChain(speed) {
	const chain = [];
	let remaining = speed;
	while (remaining > ATEMPO_MAX) { chain.push(`atempo=${ATEMPO_MAX}`); remaining /= ATEMPO_MAX; }
	while (remaining < ATEMPO_MIN) { chain.push(`atempo=${ATEMPO_MIN}`); remaining /= ATEMPO_MIN; }
	if (remaining !== 1) chain.push(`atempo=${remaining.toFixed(4)}`);
	return chain;
}

function inputArgs(source, recipe, { still }) {
	if (still) {
		const time = source.duration ? Math.min(recipe.frameTime ?? 0, source.duration) : 0;
		return time > 0 ? ['-ss', String(time), '-i', source.path] : ['-i', source.path];
	}
	const args = [];
	if (recipe.trim?.start) args.push('-ss', String(recipe.trim.start));
	// -t placé avant -i limite la lecture de l'entrée ; après -i, il couperait la sortie (fausse vitesse lente et boomerang).
	if (recipe.trim) args.push('-t', String(trimmedDuration(source, recipe)));
	args.push('-i', source.path);
	return args;
}

const HARDWARE_FAMILY = (encoder) => encoder.split('_').pop();

/** Qualité constante propre à chaque famille d'encodeur matériel. */
function hardwareRateArgs(encoder, level) {
	const value = String(CRF.hardware[level]);
	switch (HARDWARE_FAMILY(encoder)) {
		case 'nvenc': return ['-preset', 'p5', '-cq', value];
		case 'qsv': return ['-preset', 'medium', '-global_quality', value];
		default: return ['-rc', 'cqp', '-qp_i', value, '-qp_p', value];
	}
}

/** Choix du codec vidéo : encodeur matériel détecté si demandé, sinon l'encodeur logiciel. */
function videoCodecArgs(outputId, recipe, hardware, bitrateKbps) {
	const level = q(recipe);
	const codec = { 'mp4-hevc': 'hevc', 'mp4-av1': 'av1', webm: 'vp9' }[outputId] ?? 'h264';
	const hwEncoder = recipe.gpu ? hardware?.[codec] : null;
	const bitrateArgs = bitrateKbps
		? ['-b:v', `${bitrateKbps}k`, '-maxrate', `${Math.round(bitrateKbps * TARGET_MAXRATE_FACTOR)}k`, '-bufsize', `${Math.round(bitrateKbps * TARGET_BUFSIZE_FACTOR)}k`]
		: null;
	const tag = codec === 'hevc' ? ['-tag:v', 'hvc1'] : [];
	if (hwEncoder) return ['-c:v', hwEncoder, ...(bitrateArgs ?? hardwareRateArgs(hwEncoder, level)), ...tag];
	switch (codec) {
		case 'hevc': return ['-c:v', 'libx265', '-preset', 'medium', ...(bitrateArgs ?? ['-crf', String(CRF.libx265[level])]), ...tag];
		case 'av1': return ['-c:v', 'libsvtav1', '-preset', '8', ...(bitrateArgs ?? ['-crf', String(CRF.libsvtav1[level])])];
		case 'vp9': return ['-c:v', 'libvpx-vp9', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4',
			...(bitrateArgs ?? ['-crf', String(CRF['libvpx-vp9'][level]), '-b:v', '0'])];
		default: return ['-c:v', 'libx264', '-preset', 'medium', ...(bitrateArgs ?? ['-crf', String(CRF.libx264[level])])];
	}
}

function audioCodecArgs(outputId, recipe) {
	const level = q(recipe);
	switch (outputId) {
		case 'mp3': return ['-c:a', 'libmp3lame', '-q:a', String(MP3_VBR[level])];
		case 'm4a': return ['-c:a', 'aac', '-b:a', `${AAC_KBPS[level]}k`];
		case 'ogg': return ['-c:a', 'libvorbis', '-q:a', String(VORBIS_Q[level])];
		case 'opus': return ['-c:a', 'libopus', '-b:a', `${OPUS_KBPS[level]}k`];
		case 'flac': return ['-c:a', 'flac'];
		case 'wav': return ['-c:a', 'pcm_s16le'];
		case 'webm': return ['-c:a', 'libopus', '-b:a', `${VIDEO_AUDIO_KBPS}k`];
		default: return ['-c:a', 'aac', '-b:a', `${VIDEO_AUDIO_KBPS}k`];
	}
}

function stillCodecArgs(outputId, recipe) {
	const level = q(recipe);
	switch (outputId) {
		case 'jpg': return ['-c:v', 'mjpeg', '-q:v', String(JPG_QSCALE[level]), '-pix_fmt', 'yuvj444p'];
		case 'webp': return ['-c:v', 'libwebp', '-quality', String(WEBP_QUALITY[level])];
		case 'avif': return ['-c:v', 'libaom-av1', '-still-picture', '1', '-crf', String(AVIF_CRF[level]), '-cpu-used', '6', '-pix_fmt', 'yuv420p'];
		case 'jxl': return ['-c:v', 'libjxl', '-distance', String(JXL_DISTANCE[level])];
		case 'bmp': return ['-c:v', 'bmp'];
		case 'tiff': return ['-c:v', 'tiff', '-compression_algo', 'deflate'];
		case 'ico': return ['-c:v', 'png', '-pix_fmt', 'rgba', '-f', 'ico'];
		default: return ['-c:v', 'png'];
	}
}

/** Débit vidéo pour atteindre un poids cible, audio déduit. */
function targetBitrateKbps(recipe, duration, hasAudio) {
	if (!recipe.targetSizeMb || duration <= 0) return null;
	const totalKbps = (recipe.targetSizeMb * BYTES_PER_MB * BITS_PER_BYTE) / duration / 1000;
	const audioKbps = hasAudio ? VIDEO_AUDIO_KBPS : 0;
	return Math.max(MIN_VIDEO_KBPS, Math.round(totalKbps - audioKbps));
}

/**
 * @param {{path:string, kind:string, width:number|null, height:number|null, duration:number|null, hasAudio:boolean, fps:number|null}} source
 * @return {{args:string[], duration:number}}
 */
export function buildJob({ source, recipe, outputPath, hardware }) {
	const output = OUTPUTS[recipe.output];
	if (!output || output.engine !== 'ffmpeg') throw new Error(`Sortie non gérée par ffmpeg : ${recipe.output}`);
	let job;
	if (output.audioOnly) job = buildAudioJob(source, recipe, outputPath);
	else if (output.still) job = buildStillJob(source, recipe, outputPath);
	else if (output.sequence || output.sprite) job = buildFramesJob(source, recipe, outputPath);
	else job = buildMotionJob(source, recipe, outputPath, hardware);
	// Les options de sortie doivent précéder le nom du fichier, toujours en dernière position.
	job.args.splice(job.args.length - 1, 0, ...metadataArgs(recipe));
	return job;
}

/** Sans demande explicite on garde les métadonnées ; sinon GPS, appareil, dates et chapitres disparaissent. */
function metadataArgs(recipe) {
	return recipe.stripMetadata
		? ['-map_metadata', '-1', '-map_chapters', '-1', '-fflags', '+bitexact']
		: ['-map_metadata', '0'];
}

/** Volume, vitesse, sens, fondus puis normalisation EBU R128 ; `duration` est la durée de sortie. */
function audioFilters(recipe, duration) {
	const chain = [];
	if (recipe.volume !== 1) chain.push(`volume=${recipe.volume}`);
	chain.push(...atempoChain(recipe.speed));
	if (recipe.reverse) chain.push('areverse');
	if (recipe.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${recipe.fadeIn}`);
	if (recipe.fadeOut > 0 && duration > recipe.fadeOut) chain.push(`afade=t=out:st=${(duration - recipe.fadeOut).toFixed(3)}:d=${recipe.fadeOut}`);
	// loudnorm travaille en 192 kHz : on revient à une fréquence standard.
	if (recipe.normalize) chain.push(`loudnorm=I=${LOUDNESS_TARGET}:TP=${TRUE_PEAK}:LRA=${LOUDNESS_RANGE}`, `aresample=${AUDIO_SAMPLE_RATE}`);
	return chain;
}

function videoFades(recipe, duration) {
	const chain = [];
	if (recipe.fadeIn > 0) chain.push(`fade=t=in:st=0:d=${recipe.fadeIn}`);
	if (recipe.fadeOut > 0 && duration > recipe.fadeOut) chain.push(`fade=t=out:st=${(duration - recipe.fadeOut).toFixed(3)}:d=${recipe.fadeOut}`);
	return chain;
}

function buildAudioJob(source, recipe, outputPath) {
	const duration = outputDuration(source, recipe);
	const chain = audioFilters(recipe, duration);
	const args = [...inputArgs(source, recipe, { still: false }), '-vn'];
	if (chain.length) args.push('-af', chain.join(','));
	args.push(...audioCodecArgs(recipe.output, recipe), outputPath);
	return { args, duration };
}

/** Images en série (outputPath = motif image-%04d.ext) ou planche de sprites carrée. */
function buildFramesJob(source, recipe, outputPath) {
	const output = OUTPUTS[recipe.output];
	const duration = outputDuration(source, recipe);
	const chain = [...geometryFilters(source, recipe, { evenDimensions: false }), ...colorFilters(recipe), ...textFilter(source, recipe)];
	if (recipe.speed !== 1) chain.push(`setpts=PTS/${recipe.speed}`);
	if (recipe.reverse) chain.push('reverse');
	const args = [...inputArgs(source, recipe, { still: false })];
	if (output.sprite) {
		const fps = recipe.fps ?? Math.round(source.fps ?? SPRITE_DEFAULT_FPS) ?? SPRITE_DEFAULT_FPS;
		const { columns, rows, count } = spriteLayout(duration, fps, recipe.spriteColumns);
		chain.push(`fps=${fps}`, `tile=layout=${columns}x${rows}:nb_frames=${count}`);
		args.push('-vf', chain.join(','), '-frames:v', '1', '-update', '1', '-c:v', 'png', outputPath);
		return { args, duration: 0, layout: { columns, rows, count } };
	}
	if (recipe.fps) chain.push(`fps=${recipe.fps}`);
	if (chain.length) args.push('-vf', chain.join(','));
	args.push('-fps_mode', 'passthrough', '-start_number', '1');
	if (recipe.output === 'frames-jpg') args.push('-q:v', String(JPG_QSCALE[q(recipe)]));
	args.push(outputPath);
	return { args, duration };
}

/** Grille presque carrée ; `columns` imposé par l'utilisateur sinon racine du nombre d'images. */
export function spriteLayout(duration, fps, columns = null) {
	const count = Math.min(SPRITE_MAX_FRAMES, Math.max(1, Math.round(duration * fps)));
	const cols = Math.max(1, Math.min(count, columns ?? Math.ceil(Math.sqrt(count))));
	return { columns: cols, rows: Math.ceil(count / cols), count };
}

function buildStillJob(source, recipe, outputPath) {
	const chain = [...geometryFilters(source, recipe, { evenDimensions: false }), ...colorFilters(recipe), ...textFilter(source, recipe)];
	if (recipe.output === 'ico') chain.push(`scale=${ICO_MAX_SIZE}:${ICO_MAX_SIZE}:force_original_aspect_ratio=decrease`);
	const args = [...inputArgs(source, recipe, { still: true }), '-frames:v', '1', '-update', '1'];
	if (chain.length) args.push('-vf', chain.join(','));
	args.push(...stillCodecArgs(recipe.output, recipe), outputPath);
	return { args, duration: 0 };
}

function buildMotionJob(source, recipe, outputPath, hardware) {
	const outputId = recipe.output;
	const isAnim = ['gif', 'webp-anim', 'apng'].includes(outputId);
	const duration = outputDuration(source, recipe);
	const keepAudio = OUTPUTS[outputId].audio && source.hasAudio && !recipe.mute && !recipe.boomerang;

	const video = [...geometryFilters(source, recipe, { evenDimensions: !isAnim }), ...colorFilters(recipe), ...subtitleFilter(recipe), ...textFilter(source, recipe)];
	if (recipe.speed !== 1) video.push(`setpts=PTS/${recipe.speed}`);
	const fps = recipe.fps ?? (isAnim && source.kind === 'video' ? Math.min(source.fps ?? ANIM_DEFAULT_FPS_FROM_VIDEO, ANIM_DEFAULT_FPS_FROM_VIDEO) : null);
	if (fps) video.push(`fps=${fps}`);
	if (recipe.reverse) video.push('reverse');
	if (!recipe.boomerang) video.push(...videoFades(recipe, duration));
	if (!isAnim) video.push('format=yuv420p');

	const graph = [`[0:v]${video.length ? video.join(',') : 'null'}[v0]`];
	let last = 'v0';
	if (recipe.boomerang) {
		const fades = videoFades(recipe, duration);
		graph.push(`[${last}]split[fw][bw0]`, '[bw0]reverse[bw]', `[fw][bw]concat=n=2:v=1:a=0${fades.length ? `,${fades.join(',')}` : ''}[vb]`);
		last = 'vb';
	}
	if (outputId === 'gif') {
		const level = q(recipe);
		const dither = level <= QUALITY_INDEX.high ? 'sierra2_4a' : 'bayer:bayer_scale=3';
		graph.push(`[${last}]split[g0][g1]`, `[g0]palettegen=stats_mode=diff:max_colors=${GIF_COLORS[level]}[pal]`,
			`[g1][pal]paletteuse=dither=${dither}:diff_mode=rectangle[vg]`);
		last = 'vg';
	}
	const args = [...inputArgs(source, recipe, { still: false })];
	if (keepAudio) {
		const audio = audioFilters(recipe, duration);
		graph.push(`[0:a:0]${audio.length ? audio.join(',') : 'anull'}[a0]`);
	}
	args.push('-filter_complex', graph.join(';'), '-map', `[${last}]`);
	if (keepAudio) args.push('-map', '[a0]');
	else args.push('-an');

	switch (outputId) {
		case 'gif':
			args.push('-loop', recipe.loop ? '0' : '-1');
			break;
		case 'webp-anim':
			args.push('-c:v', 'libwebp_anim', '-quality', String(WEBP_QUALITY[q(recipe)]), '-loop', recipe.loop ? '0' : '1');
			break;
		case 'apng':
			args.push('-c:v', 'apng', '-plays', recipe.loop ? '0' : '1', '-f', 'apng');
			break;
		default: {
			const bitrate = targetBitrateKbps(recipe, duration, keepAudio);
			args.push(...videoCodecArgs(outputId, recipe, hardware, bitrate));
			if (keepAudio) args.push(...audioCodecArgs(outputId, recipe));
			if (['mp4', 'mp4-hevc', 'mp4-av1', 'mov'].includes(outputId)) args.push('-movflags', '+faststart');
		}
	}
	args.push(outputPath);
	return { args, duration };
}

/** Aperçu d'une image du rendu : géométrie, couleur et texte, sans temps ni vitesse. */
export function buildPreviewArgs(source, recipe, time, maxWidth) {
	const chain = [...geometryFilters(source, recipe, { evenDimensions: false }), ...colorFilters(recipe), ...textFilter(source, recipe)];
	chain.push(`scale='min(${maxWidth},iw)':-1`);
	const seek = source.duration && time > 0 ? ['-ss', String(Math.min(time, source.duration))] : [];
	return [...seek, '-i', source.path, '-frames:v', '1', '-vf', chain.join(',')];
}

/** Vignette carrée pour la file. */
export function buildThumbArgs(source, size) {
	const seek = source.duration && source.duration > 2 ? ['-ss', '1'] : [];
	return [...seek, '-i', source.path, '-frames:v', '1', '-vf',
		`scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size}`];
}
