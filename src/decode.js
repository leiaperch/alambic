/**
 * Formats que ffmpeg ne lit pas : Chromium les décode, puis le processus principal reprend la main.
 * WebP animé → une PNG par image + durées ; SVG → une PNG.
 */

const MICROSECONDS_PER_MS = 1000;
const DEFAULT_FRAME_MS = 100;
const SVG_RASTER_MIN_SIZE = 1024;
const PNG = 'image/png';

const mediaUrl = (id) => `media://item/${id}`;

async function canvasToBytes(canvas) {
	const blob = await canvas.convertToBlob({ type: PNG });
	return new Uint8Array(await blob.arrayBuffer());
}

export async function decodeAnimatedWebp(item, onProgress) {
	const data = await (await fetch(mediaUrl(item.id))).arrayBuffer();
	const decoder = new ImageDecoder({ data, type: 'image/webp' });
	try {
		await decoder.tracks.ready;
		const { frameCount } = decoder.tracks.selectedTrack;
		const durations = [];
		let canvas = null;
		for (let index = 0; index < frameCount; index++) {
			const { image } = await decoder.decode({ frameIndex: index });
			canvas ??= new OffscreenCanvas(image.displayWidth, image.displayHeight);
			const context = canvas.getContext('2d');
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(image, 0, 0);
			durations.push(image.duration ? image.duration / MICROSECONDS_PER_MS : DEFAULT_FRAME_MS);
			image.close();
			await window.alambic.decodeFrame(item.id, index, await canvasToBytes(canvas));
			onProgress((index + 1) / frameCount);
		}
		return window.alambic.decodeFinish(item.id, durations);
	} finally {
		decoder.close();
	}
}

/** Rastérise un SVG à sa taille native, agrandie si elle est petite, pour garder des bords nets. */
export async function rasterizeSvg(item) {
	const image = new Image();
	// media:// est une autre origine que la page : sans CORS, le canvas serait « teinté » et illisible.
	image.crossOrigin = 'anonymous';
	image.src = mediaUrl(item.id);
	await image.decode();
	const natural = Math.max(image.naturalWidth, image.naturalHeight) || SVG_RASTER_MIN_SIZE;
	const scale = Math.max(1, SVG_RASTER_MIN_SIZE / natural);
	const width = Math.round((image.naturalWidth || SVG_RASTER_MIN_SIZE) * scale);
	const height = Math.round((image.naturalHeight || SVG_RASTER_MIN_SIZE) * scale);
	const canvas = new OffscreenCanvas(width, height);
	canvas.getContext('2d').drawImage(image, 0, 0, width, height);
	return window.alambic.raster(item.id, await canvasToBytes(canvas));
}
