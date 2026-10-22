import { app, BrowserWindow, ipcMain, dialog, protocol, shell, nativeTheme } from 'electron';
import { createReadStream, existsSync } from 'node:fs';
import { stat, writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ffmpeg } from './ffmpeg.js';
import { Library, isAnimatedWebp, summarize } from './library.js';
import { buildJob, buildPreviewArgs, buildThumbArgs, buildStabilizeArgs, buildNoiseFloorArgs, parseNoiseFloor } from './recipe.js';
import { Logos, Presets } from './presets.js';
import { Updater } from './updater.js';
import { isWordAvailable, convertWithWord } from './office.js';
import { Ytdlp, locateYtdlp, validateUrl, buildDownloadArgs, LINK_MODES } from './ytdlp.js';
import { ModelStore, MODELS, buildWhisperArgs, filterPath, tidySrt, srtToText } from './whisper.js';
import { Upscaler, NATIVE_FACTOR } from './upscale.js';
import { Matting } from './matting.js';
import { Stems } from './stems.js';
import { OUTPUTS, KIND, emptyRecipe } from '../shared/formats.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MEDIA_SCHEME = 'media';
const THUMB_SIZE = 96;
const PREVIEW_MAX_WIDTH = 1600;
const WAVEFORM_SIZE = '1600x240';
const MIME = {
	mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg',
	mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
	png: 'image/png', apng: 'image/apng', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
	avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon', pdf: 'application/pdf',
};
const THEME = {
	dark: { color: '#141312', symbolColor: '#ece6dc' },
	light: { color: '#f3efe8', symbolColor: '#25211c' },
};
const TITLE_BAR_HEIGHT = 44;
const DOWNLOAD_FOLDER = 'Alambic';
/** Part de la barre de progression occupée par Real-ESRGAN, le reste étant les passes ffmpeg. */
const UPSCALE_SHARE = 0.95;
const MATTING_PREPARED = 0.1;
const STEM_RATE = 44100;
const STEMS_SHARE = 0.95;
const STAB_FILE = 'stab.trf';
const STAB_SHARE = 0.5;
/** La page est servie en file:// : sans cet en-tête, fetch() refuse de lire media://. */
const CORS = { 'Access-Control-Allow-Origin': '*' };

protocol.registerSchemesAsPrivileged([
	{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const ffmpeg = new Ffmpeg();
const library = new Library();
let ytdlp = null;
let models = null;
let upscaler = null;
let matting = null;
let stems = null;
let presets = null;
const logos = new Logos();
const updater = new Updater();
/** Fichiers reçus par la ligne de commande (clic droit « Convertir avec Alambic ») avant que l'interface soit prête. */
let pendingOpen = [];
let window = null;
let status = null;

/** Sert media://item/<id> avec prise en charge des requêtes Range (lecture et déplacement dans les vidéos). */
async function serveMedia(request) {
	const id = new URL(request.url).pathname.slice(1);
	let item;
	try { item = library.get(id); } catch { return new Response('Introuvable', { status: 404 }); }
	const { size } = await stat(item.path);
	const type = MIME[item.ext] ?? 'application/octet-stream';
	const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '');
	if (!range) {
		return new Response(Readable.toWeb(createReadStream(item.path)), {
			headers: { ...CORS, 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
		});
	}
	const start = range[1] ? Number(range[1]) : size - Number(range[2]);
	const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
	return new Response(Readable.toWeb(createReadStream(item.path, { start, end })), {
		status: 206,
		headers: {
			...CORS,
			'Content-Type': type,
			'Content-Length': String(end - start + 1),
			'Content-Range': `bytes ${start}-${end}/${size}`,
			'Accept-Ranges': 'bytes',
		},
	});
}

function themeOverlay() {
	return { ...(nativeTheme.shouldUseDarkColors ? THEME.dark : THEME.light), height: TITLE_BAR_HEIGHT };
}

function createWindow() {
	window = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 960,
		minHeight: 600,
		show: false,
		title: 'Alambic',
		backgroundColor: themeOverlay().color,
		titleBarStyle: 'hidden',
		titleBarOverlay: themeOverlay(),
		icon: join(HERE, 'icon.png'),
		webPreferences: {
			preload: join(HERE, 'preload.cjs'),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			spellcheck: false,
		},
	});
	window.once('ready-to-show', () => window.show());
	nativeTheme.on('updated', () => window?.setTitleBarOverlay(themeOverlay()));
	window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	window.webContents.on('will-navigate', (event) => event.preventDefault());
	if (process.env.ALAMBIC_DEV_URL) window.loadURL(process.env.ALAMBIC_DEV_URL);
	else window.loadFile(join(HERE, '..', 'dist', 'index.html'));
}

function publicItem(item) {
	const { id, name, kind, ext, size, info, path } = item;
	return { id, name, kind, ext, size, info, path };
}

async function analyze(id) {
	const item = library.get(id);
	if (item.kind === KIND.DOCUMENT) {
		item.info = { kind: KIND.DOCUMENT };
		return publicItem(item);
	}
	if (item.ext === 'webp' && await isAnimatedWebp(item.path)) {
		item.kind = KIND.ANIMATED;
		item.info = { kind: KIND.ANIMATED, needsDecode: true, hasAudio: false, hasVideo: true };
		return publicItem(item);
	}
	if (item.ext === 'svg') {
		item.info = { kind: KIND.IMAGE, needsRaster: true, hasAudio: false, hasVideo: true };
		return publicItem(item);
	}
	item.info = summarize(item, await ffmpeg.probe(item.source));
	item.kind = item.info.kind;
	return publicItem(item);
}

function sourceOf(item, recipe = null) {
	return {
		path: item.source, kind: item.kind, width: item.info?.width ?? null, height: item.info?.height ?? null,
		duration: item.info?.duration ?? null, hasAudio: item.info?.hasAudio ?? false, fps: item.info?.fps ?? null,
		logoPath: logos.path(recipe?.logo?.id),
	};
}

/**
 * Passes de mesure avant l'encodage : mouvements de caméra (vidstabdetect) et plancher de bruit (astats).
 * La stabilisation occupe la première moitié de la barre de progression.
 */
async function measurePasses(jobId, item, recipe, output, cwd, send) {
	const source = sourceOf(item, recipe);
	const visual = output.motion || output.sequence || output.sprite;
	let offset = 0;
	if (recipe.stabilize && visual && (item.kind === KIND.VIDEO || item.kind === KIND.ANIMATED)) {
		await unlink(join(cwd, STAB_FILE)).catch(() => {});
		await ffmpeg.run(jobId, buildStabilizeArgs(source, recipe, STAB_FILE), { duration: source.duration ?? 0, cwd, onProgress: (ratio) => send(ratio * STAB_SHARE) });
		recipe.stabilizeFile = STAB_FILE;
		offset = STAB_SHARE;
	}
	const audible = output.audioOnly || (output.audio && !recipe.mute);
	if (recipe.denoise !== 'off' && source.hasAudio && audible) {
		recipe.noiseFloor = parseNoiseFloor(await ffmpeg.measure(buildNoiseFloorArgs(source, recipe), { cwd }));
	}
	return offset;
}

/** Le WebP animé est décodé par Chromium image par image ; on le reconstruit ici en FFV1 sans perte. */
async function finishDecode(id, durationsMs) {
	const item = library.get(id);
	const dir = await library.workDir(id);
	const lines = ['ffconcat version 1.0'];
	// Pas de dernière image répétée (astuce courante) : ffmpeg 8 l'encoderait comme une image en trop.
	durationsMs.forEach((ms, index) => lines.push(`file frame-${index}.png`, `duration ${(ms / 1000).toFixed(3)}`));
	await writeFile(join(dir, 'frames.ffconcat'), lines.join('\n'));
	const output = join(dir, 'source.mkv');
	await ffmpeg.run(`decode-${id}`, ['-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.ffconcat'), '-fps_mode', 'passthrough', '-c:v', 'ffv1', '-pix_fmt', 'bgra', output], { duration: 0, onProgress: () => {} });
	item.source = output;
	item.info = summarize(item, await ffmpeg.probe(output));
	item.info.kind = KIND.ANIMATED;
	item.kind = KIND.ANIMATED;
	return publicItem(item);
}

/** Les SVG sont rastérisés par Chromium ; ffmpeg travaille ensuite sur ce PNG. */
async function finishRaster(id, bytes) {
	const item = library.get(id);
	const output = join(await library.workDir(id), 'source.png');
	await writeFile(output, Buffer.from(bytes));
	item.source = output;
	item.info = summarize(item, await ffmpeg.probe(output));
	return publicItem(item);
}

/** Télécharge dans Téléchargements\Alambic puis ajoute le fichier au registre comme un fichier déposé. */
async function downloadLink(jobId, rawUrl, mode) {
	if (!ytdlp) throw new Error('yt-dlp est introuvable. Installe-le avec « winget install yt-dlp.yt-dlp » puis relance Alambic.');
	if (!LINK_MODES.includes(mode)) throw new Error('Mode de téléchargement inconnu');
	const url = validateUrl(rawUrl);
	const directory = join(app.getPath('downloads'), DOWNLOAD_FOLDER);
	await mkdir(directory, { recursive: true });
	const args = buildDownloadArgs(url, mode, { directory, ffmpegDir: status.ffmpegPath ? dirname(status.ffmpegPath) : null });
	const file = await ytdlp.download(jobId, args, (event) => window?.webContents.send('link:progress', jobId, event));
	const [item] = await library.add([file]);
	if (!item) throw new Error('Le fichier téléchargé n’est pas un format pris en charge');
	return publicItem(item);
}

/**
 * Transcrit avec whisper (première moitié de la progression pour une vidéo sous-titrée), puis écrit le .srt,
 * le texte, ou encode la vidéo avec les sous-titres incrustés.
 */
async function runWhisper(jobId, id, recipe, outputDir) {
	const item = library.get(id);
	const modelName = recipe.subModel === 'turbo' ? 'turbo' : 'base';
	if (!(await models.has(modelName)) || !(await models.has('vad'))) throw new Error('Télécharge d’abord le modèle de reconnaissance vocale (section Sous-titres).');
	const cwd = await library.workDir(id);
	const output = OUTPUTS[recipe.output];
	const share = output.burn ? 0.5 : 1;
	const progress = (offset) => (ratio) => window?.webContents.send('job:progress', jobId, offset + ratio * share);
	const args = buildWhisperArgs({
		input: item.source, trim: recipe.trim, language: recipe.subLanguage,
		modelPath: filterPath(models.path(modelName), cwd), vadPath: filterPath(models.path('vad'), cwd), destination: 'whisper.srt',
	});
	await unlink(join(cwd, 'whisper.srt')).catch(() => {});
	const source = sourceOf(item, recipe);
	const spoken = recipe.trim ? recipe.trim.end - recipe.trim.start : source.duration ?? 0;
	await ffmpeg.run(jobId, args, { duration: spoken, cwd, onProgress: progress(0) });
	const srt = tidySrt(await readFile(join(cwd, 'whisper.srt'), 'utf8'));
	if (!srt.trim()) throw new Error('Aucune parole reconnue dans ce passage.');
	if (!output.burn) {
		const outputPath = await library.outputPath(id, output.ext, outputDir);
		await writeFile(outputPath, recipe.output === 'subs-txt' ? srtToText(srt) : srt, 'utf8');
		return outputPath;
	}
	await writeFile(join(cwd, 'subs.srt'), srt, 'utf8');
	const outputPath = await library.outputPath(id, output.ext, outputDir, ' - sous-titres');
	await library.writeText(id, recipe.text.content);
	const job = buildJob({ source, recipe: { ...recipe, output: 'mp4', subtitleFile: 'subs.srt' }, outputPath, hardware: ffmpeg.hardware });
	await ffmpeg.run(jobId, job.args, { duration: job.duration, cwd, onProgress: progress(share) });
	return outputPath;
}

/**
 * Retouches appliquées d'abord par ffmpeg (PNG sans redimensionnement), agrandissement ×4 par Real-ESRGAN,
 * puis réduction lanczos pour ×2 ou pour une taille finale imposée.
 */
async function runUpscale(jobId, id, recipe, outputDir) {
	if (!(await upscaler.installed())) throw new Error('Installe d’abord l’outil d’agrandissement (section Agrandissement).');
	const item = library.get(id);
	const cwd = await library.workDir(id);
	const output = OUTPUTS[recipe.output];
	const send = (ratio) => window?.webContents.send('job:progress', jobId, ratio);
	await library.writeText(id, recipe.text.content);
	const prepared = join(cwd, 'upscale-in.png');
	const enlarged = join(cwd, 'upscale-out.png');
	const pre = buildJob({ source: sourceOf(item, recipe), recipe: { ...recipe, output: 'png', width: null, height: null }, outputPath: prepared, hardware: ffmpeg.hardware });
	await ffmpeg.run(jobId, pre.args, { duration: 0, cwd, onProgress: () => {} });
	await upscaler.run(jobId, prepared, enlarged, recipe.upscaleModel, (ratio) => send(ratio * UPSCALE_SHARE));
	const outputPath = await library.outputPath(id, output.ext, outputDir, ` ×${output.factor}`);
	const reduce = recipe.width || recipe.height
		? `scale=${recipe.width || -1}:${recipe.height || -1}:flags=lanczos`
		: `scale=iw*${output.factor / NATIVE_FACTOR}:ih*${output.factor / NATIVE_FACTOR}:flags=lanczos`;
	await ffmpeg.run(jobId, ['-i', enlarged, '-vf', reduce, '-frames:v', '1', '-update', '1', '-c:v', 'png', outputPath], { duration: 0, cwd, onProgress: () => {} });
	send(1);
	return outputPath;
}

/** Retouches ffmpeg d'abord (PNG), détourage BiRefNet ensuite, puis redimensionnement final éventuel. */
async function runMatting(jobId, id, recipe, outputDir) {
	if (!(await matting.installed())) throw new Error('Installe d’abord le modèle de détourage (section Détourage).');
	const item = library.get(id);
	const cwd = await library.workDir(id);
	const send = (ratio) => window?.webContents.send('job:progress', jobId, ratio);
	await library.writeText(id, recipe.text.content);
	const prepared = join(cwd, 'matting-in.png');
	const pre = buildJob({ source: sourceOf(item, recipe), recipe: { ...recipe, output: 'png' }, outputPath: prepared, hardware: ffmpeg.hardware });
	await ffmpeg.run(jobId, pre.args, { duration: 0, cwd, onProgress: () => {} });
	send(MATTING_PREPARED);
	const { streams } = await ffmpeg.probe(prepared);
	const outputPath = await library.outputPath(id, 'png', outputDir, ' - sans fond');
	await matting.run(ffmpeg, { input: prepared, width: streams[0].width, height: streams[0].height, output: outputPath, cwd });
	send(1);
	return outputPath;
}

/**
 * Décode en float32 stéréo 44,1 kHz, sépare dans un worker (MDX-Net), puis encode « - voix » et « - musique ».
 * Découpe respectée ; volume et normalisation appliqués à chaque piste.
 */
async function runStems(jobId, id, recipe, outputDir) {
	if (!(await stems.installed())) throw new Error('Installe d’abord le modèle de séparation (section Séparation).');
	const item = library.get(id);
	const cwd = await library.workDir(id);
	const send = (ratio) => window?.webContents.send('job:progress', jobId, ratio);
	const seek = [];
	if (recipe.trim?.start) seek.push('-ss', String(recipe.trim.start));
	if (recipe.trim) seek.push('-t', String(recipe.trim.end - recipe.trim.start));
	const raw = ['-f', 'f32le', '-ac', '2', '-ar', String(STEM_RATE)];
	await ffmpeg.run(jobId, [...seek, '-i', item.source, '-vn', ...raw, 'stems-mix.f32'], { duration: 0, cwd, onProgress: () => {} });
	await stems.run(jobId, { input: join(cwd, 'stems-mix.f32'), instrumental: join(cwd, 'stems-music.f32'), vocals: join(cwd, 'stems-voice.f32') },
		(ratio) => send(ratio * STEMS_SHARE));
	const output = OUTPUTS[recipe.output];
	const codec = output.ext === 'mp3' ? ['-c:a', 'libmp3lame', '-q:a', '2'] : ['-c:a', 'pcm_s16le'];
	const filters = [];
	if (recipe.volume !== 1) filters.push(`volume=${recipe.volume}`);
	if (recipe.normalize) filters.push('loudnorm=I=-16:TP=-1.5:LRA=11', `aresample=${STEM_RATE}`);
	const paths = [];
	for (const [file, suffix] of [['stems-voice.f32', ' - voix'], ['stems-music.f32', ' - musique']]) {
		const outputPath = await library.outputPath(id, output.ext, outputDir, suffix);
		await ffmpeg.run(jobId, [...raw, '-i', file, ...(filters.length ? ['-af', filters.join(',')] : []), ...codec, outputPath], { duration: 0, cwd, onProgress: () => {} });
		paths.push(outputPath);
	}
	send(1);
	return paths;
}

/** Une image par fichier dans un dossier dédié ; renvoie le dossier. */
async function runSequence(jobId, id, recipe, outputDir) {
	const item = library.get(id);
	const folder = await library.outputFolder(id, outputDir, ' - images');
	const cwd = await library.workDir(id);
	await library.writeText(id, recipe.text.content);
	const pattern = join(folder, `image-%04d.${OUTPUTS[recipe.output].ext}`);
	const send = (ratio) => window?.webContents.send('job:progress', jobId, ratio);
	const offset = await measurePasses(jobId, item, recipe, OUTPUTS[recipe.output], cwd, send);
	const { args, duration } = buildJob({ source: sourceOf(item, recipe), recipe, outputPath: pattern, hardware: ffmpeg.hardware });
	await ffmpeg.run(jobId, args, { duration, cwd, onProgress: (ratio) => send(offset + ratio * (1 - offset)) });
	return folder;
}

async function runJob(jobId, id, recipe, outputDir) {
	const item = library.get(id);
	const output = OUTPUTS[recipe.output];
	if (!output) throw new Error('Format de sortie inconnu');
	const merged = { ...emptyRecipe(recipe.output), ...recipe };
	if (output.sequence) return runSequence(jobId, id, merged, outputDir);
	if (output.engine === 'whisper') return runWhisper(jobId, id, merged, outputDir);
	if (output.engine === 'upscale') return runUpscale(jobId, id, merged, outputDir);
	if (output.engine === 'matting') return runMatting(jobId, id, merged, outputDir);
	if (output.engine === 'stems') return runStems(jobId, id, merged, outputDir);
	const outputPath = await library.outputPath(id, output.ext, outputDir, output.sprite ? ' - sprites' : '');
	if (output.engine === 'office') {
		await convertWithWord(item.path, outputPath, recipe.output);
		return outputPath;
	}
	const cwd = await library.workDir(id);
	await library.writeText(id, merged.text.content);
	const send = (ratio) => window?.webContents.send('job:progress', jobId, ratio);
	try {
		const offset = await measurePasses(jobId, item, merged, output, cwd, send);
		const { args, duration } = buildJob({ source: sourceOf(item, merged), recipe: merged, outputPath, hardware: ffmpeg.hardware });
		await ffmpeg.run(jobId, args, { duration, cwd, onProgress: (ratio) => send(offset + ratio * (1 - offset)) });
	} catch (error) {
		await unlink(outputPath).catch(() => {});
		throw error;
	}
	return outputPath;
}

function registerIpc() {
	ipcMain.handle('app:status', () => status);
	ipcMain.handle('logo:pick', async () => {
		const result = await dialog.showOpenDialog(window, {
			properties: ['openFile'],
			filters: [{ name: 'Images', extensions: ['png', 'webp', 'jpg', 'jpeg', 'gif', 'bmp'] }],
		});
		return result.canceled ? null : logos.register(result.filePaths[0]);
	});
	ipcMain.handle('presets:list', () => presets.list());
	ipcMain.handle('presets:save', (_event, name, recipe) => presets.save(name, recipe));
	ipcMain.handle('presets:remove', (_event, name) => presets.remove(String(name)));
	ipcMain.handle('files:initial', () => {
		const items = pendingOpen;
		pendingOpen = [];
		return items;
	});
	ipcMain.handle('update:install', () => updater.install());
	ipcMain.handle('link:download', (_event, jobId, url, mode) => downloadLink(String(jobId), url, mode));
	ipcMain.handle('link:cancel', (_event, jobId) => ytdlp?.cancel(String(jobId)));
	ipcMain.handle('link:update', () => ytdlp?.update());
	ipcMain.handle('models:status', () => models.status());
	ipcMain.handle('models:download', async (_event, name) => {
		if (name !== 'base' && name !== 'turbo') throw new Error('Modèle inconnu');
		if (!(await models.has('vad'))) await models.download('vad', () => {});
		await models.download(name, (ratio) => window?.webContents.send('models:progress', name, ratio));
		return models.status();
	});
	ipcMain.handle('models:cancel', (_event, name) => models.cancel(String(name)));
	ipcMain.handle('tools:status', async () => ({ upscale: await upscaler.installed(), matting: await matting.installed(), stems: await stems.installed() }));
	ipcMain.handle('tools:install', async (_event, name) => {
		const tool = { upscale: upscaler, matting, stems }[name];
		if (!tool) throw new Error('Outil inconnu');
		await tool.install((ratio) => window?.webContents.send('tools:progress', name, ratio));
		return { [name]: true };
	});
	ipcMain.handle('tools:cancel', (_event, name) => ({ upscale: upscaler, matting, stems })[name]?.cancelInstall());
	ipcMain.handle('files:pick', async () => {
		const result = await dialog.showOpenDialog(window, { properties: ['openFile', 'multiSelections'] });
		return result.canceled ? [] : (await library.add(result.filePaths)).map(publicItem);
	});
	ipcMain.handle('files:add', async (_event, paths) => {
		if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string')) throw new Error('Chemins invalides');
		return (await library.add(paths)).map(publicItem);
	});
	ipcMain.handle('files:remove', (_event, id) => library.remove(id));
	ipcMain.handle('folder:pick', async () => {
		const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] });
		return result.canceled ? null : result.filePaths[0];
	});
	ipcMain.handle('media:analyze', (_event, id) => analyze(id));
	ipcMain.handle('media:decode-frame', async (_event, id, index, bytes) => {
		await writeFile(join(await library.workDir(id), `frame-${Number(index)}.png`), Buffer.from(bytes));
	});
	ipcMain.handle('media:decode-finish', (_event, id, durations) => finishDecode(id, durations.map(Number)));
	ipcMain.handle('media:raster', (_event, id, bytes) => finishRaster(id, bytes));
	ipcMain.handle('media:thumb', async (_event, id) => ffmpeg.frame(buildThumbArgs(sourceOf(library.get(id)), THUMB_SIZE)));
	ipcMain.handle('media:waveform', async (_event, id, color) => {
		if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Couleur invalide');
		return ffmpeg.frame(['-i', library.get(id).source, '-filter_complex', `aformat=channel_layouts=mono,showwavespic=s=${WAVEFORM_SIZE}:colors=${color}`]);
	});
	ipcMain.handle('media:preview', async (_event, id, recipe, time) => {
		const merged = { ...emptyRecipe(recipe.output), ...recipe };
		await library.writeText(id, merged.text.content);
		const cwd = await library.workDir(id);
		return ffmpeg.frame(buildPreviewArgs(sourceOf(library.get(id), merged), merged, Number(time) || 0, PREVIEW_MAX_WIDTH), { cwd });
	});
	ipcMain.handle('job:run', (_event, jobId, id, recipe, outputDir) => runJob(jobId, id, recipe, outputDir ?? null));
	ipcMain.handle('job:cancel', (_event, jobId) => {
		ffmpeg.cancel(jobId);
		upscaler.cancel(jobId);
		stems.cancel(jobId);
	});
	ipcMain.handle('file:save', async (_event, id, ext, bytes, outputDir, suffix) => {
		const path = await library.outputPath(id, String(ext), outputDir ?? null, suffix ? String(suffix) : '');
		await writeFile(path, Buffer.from(bytes));
		return path;
	});
	ipcMain.handle('shell:reveal', (_event, path) => {
		if (typeof path === 'string') shell.showItemInFolder(path);
	});
}

/** Chemins passés en ligne de commande, sans l'exécutable, les options ni le « . » du lancement en développement. */
function pathsFromArgv(argv) {
	return argv.slice(1).filter((arg) => !arg.startsWith('-') && arg !== '.' && existsSync(arg) && arg !== process.execPath);
}

async function openFromArgv(argv) {
	const paths = pathsFromArgv(argv);
	if (!paths.length) return;
	const items = (await library.add(paths)).map(publicItem);
	if (!items.length) return;
	if (window?.webContents && !window.webContents.isLoading()) window.webContents.send('files:opened', items);
	else pendingOpen.push(...items);
}

// Une seule fenêtre : les fichiers choisis par « Convertir avec Alambic » rejoignent l'instance déjà ouverte.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_event, argv) => {
	if (window) {
		if (window.isMinimized()) window.restore();
		window.focus();
	}
	openFromArgv(argv);
});

app.whenReady().then(async () => {
	protocol.handle(MEDIA_SCHEME, serveMedia);
	await library.init();
	const [engine, word] = await Promise.all([ffmpeg.init(), isWordAvailable()]);
	presets = new Presets(join(app.getPath('userData'), 'presets.json'), logos);
	models = new ModelStore(join(app.getPath('userData'), 'models'));
	upscaler = new Upscaler(join(app.getPath('userData'), 'tools'));
	matting = new Matting(join(app.getPath('userData'), 'models'));
	stems = new Stems(join(app.getPath('userData'), 'models'));
	const ytdlpFound = locateYtdlp();
	ytdlp = ytdlpFound ? new Ytdlp(ytdlpFound) : null;
	status = { ffmpeg: engine.ok, ffmpegPath: engine.path ?? null, hardware: engine.hardware ?? {}, word, ytdlp: Boolean(ytdlpFound), ytdlpBundled: ytdlpFound?.bundled ?? false };
	registerIpc();
	createWindow();
	await openFromArgv(process.argv);
	if (app.isPackaged) updater.start((info) => window?.webContents.send('update:ready', info));
});

app.on('window-all-closed', async () => {
	ffmpeg.cancelAll();
	ytdlp?.cancelAll();
	await library.dispose();
	app.quit();
});
