import { OUTPUTS, KIND, outputsFor, defaultOutputFor } from '../shared/formats.js';
import { STATUS } from './store.js';
import { decodeAnimatedWebp, rasterizeSvg } from './decode.js';
import { convertPdf, imagesToPdf, mergePdfs, pdfThumb } from './engines/pdf.js';

const CONCURRENCY = 2;
const THUMB_SIZE = 96;

const pngUrl = (bytes) => URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));

/** Analyse les fichiers ajoutés puis exécute les conversions, CONCURRENCY à la fois. */
export class Runner {
	#store;
	#waiting = [];
	#running = new Set();

	constructor(store) {
		this.#store = store;
		window.alambic.onProgress((jobId, ratio) => {
			if (this.#running.has(jobId)) store.update(jobId, { progress: ratio }, 'progress');
		});
	}

	get busy() {
		return this.#running.size > 0 || this.#waiting.length > 0;
	}

	async ingest(items) {
		this.#store.add(items);
		for (const item of items) await this.#prepare(item.id);
	}

	async #prepare(id) {
		const store = this.#store;
		try {
			let item = await window.alambic.analyze(id);
			if (item.info?.needsDecode) item = await decodeAnimatedWebp(item, (ratio) => store.update(id, { progress: ratio }, 'progress'));
			if (item.info?.needsRaster) item = await rasterizeSvg(item);
			const entry = store.get(id);
			if (!entry) return;
			// L'analyse peut reclasser le fichier (GIF ou WebP animé) : la sortie par défaut suit le nouveau type.
			const reclassified = entry.item.kind !== item.kind;
			if (reclassified || !outputsFor(item.kind, item.ext).includes(entry.recipe.output)) entry.recipe.output = defaultOutputFor(item.kind, item.ext);
			entry.item = item;
			store.update(id, { info: item.info, status: STATUS.READY, progress: 0 }, 'analyzed');
			store.update(id, { thumbUrl: await this.#thumb(item) }, 'thumb');
		} catch (error) {
			store.update(id, { status: STATUS.ERROR, error: `Lecture impossible : ${error.message}` });
		}
	}

	async #thumb(item) {
		if (item.kind === KIND.AUDIO) return null;
		if (item.kind === KIND.DOCUMENT) return item.ext === 'pdf' ? URL.createObjectURL(await pdfThumb(item, THUMB_SIZE)) : null;
		return pngUrl(await window.alambic.thumb(item.id));
	}

	enqueue(ids) {
		for (const id of ids) {
			const entry = this.#store.get(id);
			if (!entry || ![STATUS.READY, STATUS.DONE, STATUS.ERROR].includes(entry.status)) continue;
			this.#store.update(id, { status: STATUS.QUEUED, progress: 0, error: null }, 'status');
			this.#waiting.push(id);
		}
		this.#pump();
	}

	cancel(id) {
		const index = this.#waiting.indexOf(id);
		if (index >= 0) {
			this.#waiting.splice(index, 1);
			this.#store.update(id, { status: STATUS.READY }, 'status');
		} else if (this.#running.has(id)) {
			window.alambic.cancel(id);
		}
	}

	#pump() {
		while (this.#running.size < CONCURRENCY && this.#waiting.length) {
			const id = this.#waiting.shift();
			this.#running.add(id);
			this.#execute(id).finally(() => {
				this.#running.delete(id);
				this.#pump();
			});
		}
	}

	async #execute(id) {
		const store = this.#store;
		const entry = store.get(id);
		if (!entry) return;
		store.update(id, { status: STATUS.RUNNING }, 'status');
		const options = { outputDir: store.outputDir, onProgress: (ratio) => store.update(id, { progress: ratio }, 'progress') };
		try {
			const outputs = await this.#dispatch(entry, options);
			store.update(id, { status: STATUS.DONE, progress: 1, outputs }, 'status');
		} catch (error) {
			store.update(id, { status: STATUS.ERROR, error: error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }, 'status');
		}
	}

	async #dispatch({ id, item, recipe }, options) {
		const output = OUTPUTS[recipe.output];
		if (output.engine !== 'pdf') return [await window.alambic.run(id, id, structuredClone(recipe), options.outputDir)];
		if (recipe.output === 'image-pdf') return [await imagesToPdf([item], options)];
		return convertPdf(item, recipe, options);
	}

	/** Actions de lot qui produisent un seul fichier à partir de plusieurs. */
	async combine(kind, entries) {
		const items = entries.map((entry) => entry.item);
		const options = { outputDir: this.#store.outputDir, onProgress: () => {} };
		return kind === 'merge' ? mergePdfs(items, options) : imagesToPdf(items, options);
	}
}
