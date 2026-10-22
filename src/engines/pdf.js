import * as pdfjs from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { OUTPUTS } from '../../shared/formats.js';
import { editPdfBytes } from './pdf-edit.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

const POINTS_PER_PIXEL = 0.75;
const BASE_DPI = 72;
const FALLBACK_IMAGE_SIZE = 1024;
const BACKGROUND = '#ffffff';
const PNG_MIME = 'image/png';
const JPG_MIME = 'image/jpeg';
const SVG_MIME = 'image/svg+xml';
const JPG_QUALITY = Object.freeze({ max: 0.95, high: 0.9, balanced: 0.8, small: 0.65 });
const DEFAULT_JPG_QUALITY = JPG_QUALITY.high;
const PNG_EXTENSIONS = new Set(['png']);
const JPG_EXTENSIONS = new Set(['jpg', 'jpeg', 'jfif']);
const RANGE_PATTERN = /^(\d*)-(\d*)$/;
const NUMBER_PATTERN = /^\d+$/;
const RANGE_SEPARATOR = /[,;]/;

/**
 * Pages 1-based triées et uniques ; « 8- » va jusqu'à la fin, « -2 » part de la page 1.
 * Les numéros hors du document sont ignorés.
 */
export function parsePageRange(text, pageCount) {
	const source = String(text ?? '').replace(/\s+/g, '');
	if (source === '') return Array.from({ length: pageCount }, (_, index) => index + 1);
	const pages = new Set();
	for (const token of source.split(RANGE_SEPARATOR)) {
		if (token === '') continue;
		addToken(pages, token, text, pageCount);
	}
	if (pages.size === 0) throw new Error(`Pages invalides : « ${String(text).trim()} » ne désigne aucune page (1 à ${pageCount}).`);
	return [...pages].sort((a, b) => a - b);
}

function addToken(pages, token, original, pageCount) {
	const [first, last] = tokenBounds(token, original, pageCount);
	for (let page = Math.max(first, 1); page <= Math.min(last, pageCount); page += 1) pages.add(page);
}

function tokenBounds(token, original, pageCount) {
	if (NUMBER_PATTERN.test(token)) return [Number(token), Number(token)];
	const match = RANGE_PATTERN.exec(token);
	if (!match || (match[1] === '' && match[2] === '')) {
		throw new Error(`Pages invalides : « ${String(original).trim()} » (« ${token} » est incompréhensible).`);
	}
	const first = match[1] === '' ? 1 : Number(match[1]);
	const last = match[2] === '' ? pageCount : Number(match[2]);
	if (first > last) throw new Error(`Pages invalides : la plage « ${token} » est à l'envers.`);
	return [first, last];
}

async function readBytes(item) {
	const response = await fetch(`media://item/${item.id}`);
	if (!response.ok) throw new Error(`Lecture impossible : ${item.name}.`);
	return new Uint8Array(await response.arrayBuffer());
}

/** pdf.js transfère le tampon au worker : on lui passe une copie. */
async function withPdf(item, task) {
	const bytes = await readBytes(item);
	const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
	const doc = await loadingTask.promise;
	try {
		return await task(doc);
	} finally {
		await loadingTask.destroy();
	}
}

function whiteCanvas(width, height) {
	const canvas = new OffscreenCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
	const context = canvas.getContext('2d');
	context.fillStyle = BACKGROUND;
	context.fillRect(0, 0, canvas.width, canvas.height);
	return canvas;
}

async function renderPage(doc, pageNumber, scale) {
	const page = await doc.getPage(pageNumber);
	try {
		const viewport = page.getViewport({ scale });
		const canvas = whiteCanvas(viewport.width, viewport.height);
		await page.render({ canvas, viewport }).promise;
		return canvas;
	} finally {
		page.cleanup();
	}
}

export async function pdfPageCount(item) {
	return withPdf(item, (doc) => doc.numPages);
}

/** Première page, recadrée en carré (cover) et centrée sur fond blanc. */
export async function pdfThumb(item, size) {
	return withPdf(item, async (doc) => {
		const page = await doc.getPage(1);
		try {
			const natural = page.getViewport({ scale: 1 });
			const scale = size / Math.min(natural.width, natural.height);
			const viewport = page.getViewport({ scale });
			const canvas = whiteCanvas(size, size);
			const transform = [1, 0, 0, 1, (size - viewport.width) / 2, (size - viewport.height) / 2];
			await page.render({ canvas, viewport, transform }).promise;
			return canvas.convertToBlob({ type: PNG_MIME });
		} finally {
			page.cleanup();
		}
	});
}

export async function pdfPagePreview(item, pageNumber, maxWidth) {
	return withPdf(item, async (doc) => {
		const page = await doc.getPage(pageNumber);
		const scale = maxWidth / page.getViewport({ scale: 1 }).width;
		page.cleanup();
		const canvas = await renderPage(doc, pageNumber, scale);
		return canvas.convertToBlob({ type: PNG_MIME });
	});
}

async function pageText(doc, pageNumber) {
	const page = await doc.getPage(pageNumber);
	try {
		const { items } = await page.getTextContent();
		const lines = [];
		let line = '';
		for (const entry of items) {
			if (typeof entry.str !== 'string') continue;
			line += entry.str;
			if (entry.hasEOL) {
				lines.push(line);
				line = '';
			}
		}
		if (line !== '') lines.push(line);
		return lines.join('\n');
	} finally {
		page.cleanup();
	}
}

function encodeText(text) {
	return new TextEncoder().encode(text);
}

async function saveImagePages(item, doc, recipe, pages, { outputDir, onProgress }) {
	const isJpg = recipe.output === 'pdf-jpg';
	const mime = isJpg ? JPG_MIME : PNG_MIME;
	const quality = isJpg ? (JPG_QUALITY[recipe.quality] ?? DEFAULT_JPG_QUALITY) : undefined;
	const scale = recipe.dpi / BASE_DPI;
	const written = [];
	for (const [index, pageNumber] of pages.entries()) {
		const canvas = await renderPage(doc, pageNumber, scale);
		const blob = await canvas.convertToBlob({ type: mime, quality });
		const bytes = new Uint8Array(await blob.arrayBuffer());
		written.push(await window.alambic.save(item.id, OUTPUTS[recipe.output].ext, bytes, outputDir, ` - page ${pageNumber}`));
		onProgress?.((index + 1) / pages.length);
	}
	return written;
}

async function saveText(item, doc, pages, { outputDir, onProgress }) {
	const chunks = [];
	for (const [index, pageNumber] of pages.entries()) {
		chunks.push(await pageText(doc, pageNumber));
		onProgress?.((index + 1) / pages.length);
	}
	const path = await window.alambic.save(item.id, 'txt', encodeText(chunks.join('\n\n')), outputDir, '');
	return [path];
}

async function savePages(item, pages, { outputDir, onProgress }) {
	const source = await PDFDocument.load(await readBytes(item));
	const target = await PDFDocument.create();
	const copies = await target.copyPages(source, pages.map((page) => page - 1));
	for (const [index, copy] of copies.entries()) {
		target.addPage(copy);
		onProgress?.((index + 1) / copies.length);
	}
	const path = await window.alambic.save(item.id, 'pdf', await target.save(), outputDir, ' - pages');
	return [path];
}

export async function convertPdf(item, recipe, { outputDir, onProgress } = {}) {
	const options = { outputDir, onProgress };
	switch (recipe.output) {
		case 'pdf-png':
		case 'pdf-jpg':
			return withPdf(item, (doc) => saveImagePages(item, doc, recipe, parsePageRange(recipe.pages, doc.numPages), options));
		case 'pdf-txt':
			return withPdf(item, (doc) => saveText(item, doc, parsePageRange(recipe.pages, doc.numPages), options));
		case 'pdf-pages': {
			const count = await pdfPageCount(item);
			return savePages(item, parsePageRange(recipe.pages, count), options);
		}
		case 'pdf-edit': {
			const bytes = await editPdfBytes(await readBytes(item), { pages: recipe.pageOrder, watermark: recipe.watermark, pageNumbers: recipe.pageNumbers });
			onProgress?.(1);
			return [await window.alambic.save(item.id, 'pdf', bytes, outputDir, ' - modifié')];
		}
		default:
			throw new Error(`Sortie PDF non prise en charge : ${recipe.output}.`);
	}
}

async function loadSvg(blob) {
	const url = URL.createObjectURL(blob);
	try {
		const image = new Image();
		image.src = url;
		await image.decode();
		return {
			source: image,
			width: image.naturalWidth || FALLBACK_IMAGE_SIZE,
			height: image.naturalHeight || FALLBACK_IMAGE_SIZE,
		};
	} finally {
		URL.revokeObjectURL(url);
	}
}

async function pngFromDecodable(item, bytes) {
	const mime = item.ext === 'svg' ? SVG_MIME : '';
	const blob = new Blob([bytes], { type: mime });
	const decoded = item.ext === 'svg' ? await loadSvg(blob) : await decodeBitmap(blob);
	const canvas = new OffscreenCanvas(decoded.width, decoded.height);
	canvas.getContext('2d').drawImage(decoded.source, 0, 0, decoded.width, decoded.height);
	decoded.source.close?.();
	const png = await canvas.convertToBlob({ type: PNG_MIME });
	return new Uint8Array(await png.arrayBuffer());
}

async function decodeBitmap(blob) {
	const bitmap = await createImageBitmap(blob);
	return { source: bitmap, width: bitmap.width, height: bitmap.height };
}

async function embedImage(pdf, item) {
	const bytes = await readBytes(item);
	const ext = item.ext.toLowerCase();
	if (PNG_EXTENSIONS.has(ext)) return pdf.embedPng(bytes);
	if (JPG_EXTENSIONS.has(ext)) return pdf.embedJpg(bytes);
	return pdf.embedPng(await pngFromDecodable({ ...item, ext }, bytes));
}

export async function imagesToPdf(items, { outputDir, onProgress } = {}) {
	const pdf = await PDFDocument.create();
	for (const [index, item] of items.entries()) {
		const image = await embedImage(pdf, item);
		const width = image.width * POINTS_PER_PIXEL;
		const height = image.height * POINTS_PER_PIXEL;
		pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
		onProgress?.((index + 1) / items.length);
	}
	return window.alambic.save(items[0].id, 'pdf', await pdf.save(), outputDir, ' - assemblé');
}

export async function mergePdfs(items, { outputDir, onProgress } = {}) {
	const target = await PDFDocument.create();
	for (const [index, item] of items.entries()) {
		const source = await PDFDocument.load(await readBytes(item));
		const copies = await target.copyPages(source, source.getPageIndices());
		for (const copy of copies) target.addPage(copy);
		onProgress?.((index + 1) / items.length);
	}
	return window.alambic.save(items[0].id, 'pdf', await target.save(), outputDir, ' - fusion');
}
