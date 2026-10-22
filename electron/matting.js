import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { downloadFile } from './download.js';

/**
 * BiRefNet « general lite » (licence MIT) tel que publié par rembg ; empreinte figée.
 * Préparation identique à rembg : division par le maximum de l'image, puis moyenne et écart-type d'ImageNet ; sortie en sigmoïde.
 */
const MODEL = Object.freeze({
	url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
	sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
	bytes: 224_005_088,
	file: 'birefnet-general-lite.onnx',
	mean: [0.485, 0.456, 0.406],
	std: [0.229, 0.224, 0.225],
});
const SIZE = 1024;
const CHANNELS = 3;
const MAX_BYTE = 255;
const MASK_FILE = 'matting-mask.raw';

/** Normalisation de rembg : division par la valeur maximale de l'image (pas par 255), puis (x - moyenne) / écart-type. */
export function toTensorData(rgb, mean = MODEL.mean, std = MODEL.std) {
	let max = 0;
	for (const value of rgb) if (value > max) max = value;
	const scale = 1 / Math.max(max, 1e-6);
	const plane = SIZE * SIZE;
	const data = new Float32Array(CHANNELS * plane);
	for (let pixel = 0; pixel < plane; pixel++) {
		for (let channel = 0; channel < CHANNELS; channel++) {
			data[channel * plane + pixel] = (rgb[pixel * CHANNELS + channel] * scale - mean[channel]) / std[channel];
		}
	}
	return data;
}

/** Sigmoïde puis min-max vers 0..255, comme rembg pour BiRefNet. */
export function toMask(logits) {
	const prediction = Float32Array.from(logits, (value) => 1 / (1 + Math.exp(-value)));
	let min = Infinity;
	let max = -Infinity;
	for (const value of prediction) {
		if (value < min) min = value;
		if (value > max) max = value;
	}
	const range = max - min || 1;
	const mask = new Uint8Array(prediction.length);
	for (let index = 0; index < prediction.length; index++) mask[index] = Math.round(((prediction[index] - min) / range) * MAX_BYTE);
	return mask;
}

export class Matting {
	#dir;
	#session = null;
	#installing = null;

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

	/**
	 * Processeur seulement : DirectML a mis 149 s au premier lancement (compilation des shaders)
	 * pour un gain de moins d'une seconde ensuite. onnxruntime n'est chargé qu'au premier détourage.
	 */
	async #load() {
		if (this.#session) return this.#session;
		this.ort = await import('onnxruntime-node');
		this.#session = await this.ort.InferenceSession.create(this.#path, { executionProviders: ['cpu'] });
		return this.#session;
	}

	/**
	 * Détoure `input` (largeur × hauteur connues) vers un PNG transparent.
	 * ffmpeg fournit l'image en 1024² RGB brut, puis recolle le masque agrandi comme canal alpha.
	 */
	async run(ffmpeg, { input, width, height, output, cwd }) {
		const session = await this.#load();
		const rgb = await ffmpeg.raw(['-i', input, '-frames:v', '1', '-vf', `scale=${SIZE}:${SIZE}:flags=lanczos,format=rgb24`, '-f', 'rawvideo', 'pipe:1'], { cwd });
		if (rgb.length !== SIZE * SIZE * CHANNELS) throw new Error('Image illisible pour le détourage');
		const tensor = new this.ort.Tensor('float32', toTensorData(rgb), [1, CHANNELS, SIZE, SIZE]);
		const result = await session.run({ [session.inputNames[0]]: tensor });
		const prediction = result[session.outputNames[0]].data.subarray(0, SIZE * SIZE);
		await writeFile(join(cwd, MASK_FILE), toMask(prediction));
		await ffmpeg.raw(['-y', '-i', input, '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${SIZE}x${SIZE}`, '-i', MASK_FILE,
			'-filter_complex', `[1:v]scale=${width}:${height}:flags=lanczos[m];[0:v]format=rgba[c];[c][m]alphamerge`,
			'-frames:v', '1', '-update', '1', '-c:v', 'png', output], { cwd });
	}
}
