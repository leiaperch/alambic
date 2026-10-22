import { emptyRecipe, defaultOutputFor, outputsFor } from '../shared/formats.js';

export const STATUS = Object.freeze({
	ANALYZING: 'analyzing',
	READY: 'ready',
	QUEUED: 'queued',
	RUNNING: 'running',
	DONE: 'done',
	ERROR: 'error',
});

/** Champs qui dépendent des dimensions ou de la durée d'un fichier : jamais recopiés d'un fichier à l'autre. */
const PER_FILE_FIELDS = ['crop', 'trim', 'frameTime', 'pages'];

/**
 * État de l'application. Émet `change` (détail : { id?, reason }) à chaque modification.
 * Les composants relisent l'état au lieu de recevoir des copies.
 */
export class Store extends EventTarget {
	#entries = new Map();
	#selection = new Set();
	#activeId = null;
	outputDir = null;
	status = null;
	/** Rapport largeur/hauteur imposé au recadrage à la souris, null = libre. */
	cropAspect = null;
	/** Position de lecture de l'éditeur, en secondes de la source. */
	playhead = 0;

	setUi(patch) {
		Object.assign(this, patch);
		this.#emit({ reason: 'ui' });
	}

	get entries() {
		return [...this.#entries.values()];
	}

	get active() {
		return this.#activeId ? this.#entries.get(this.#activeId) ?? null : null;
	}

	get selection() {
		return this.entries.filter((entry) => this.#selection.has(entry.id));
	}

	isSelected(id) {
		return this.#selection.has(id);
	}

	get(id) {
		return this.#entries.get(id) ?? null;
	}

	add(items) {
		for (const item of items) {
			this.#entries.set(item.id, {
				id: item.id,
				item,
				info: null,
				recipe: emptyRecipe(defaultOutputFor(item.kind, item.ext)),
				status: STATUS.ANALYZING,
				progress: 0,
				outputs: [],
				error: null,
				thumbUrl: null,
			});
		}
		if (!this.#activeId && items.length) this.select(items[0].id);
		this.#emit({ reason: 'add' });
	}

	remove(ids) {
		for (const id of ids) {
			const entry = this.#entries.get(id);
			if (entry?.thumbUrl) URL.revokeObjectURL(entry.thumbUrl);
			this.#entries.delete(id);
			this.#selection.delete(id);
		}
		if (!this.#entries.has(this.#activeId)) {
			this.#activeId = this.entries[0]?.id ?? null;
			if (this.#activeId) this.#selection.add(this.#activeId);
		}
		this.#emit({ reason: 'remove' });
	}

	/** mode : 'replace' (clic), 'toggle' (Ctrl), 'range' (Maj). */
	select(id, mode = 'replace') {
		if (mode === 'toggle') {
			if (this.#selection.has(id) && this.#selection.size > 1) this.#selection.delete(id);
			else this.#selection.add(id);
		} else if (mode === 'range' && this.#activeId) {
			const ids = this.entries.map((entry) => entry.id);
			const [from, to] = [ids.indexOf(this.#activeId), ids.indexOf(id)].sort((a, b) => a - b);
			for (const rangeId of ids.slice(from, to + 1)) this.#selection.add(rangeId);
		} else {
			this.#selection = new Set([id]);
		}
		this.#activeId = id;
		this.#emit({ reason: 'select' });
	}

	selectAll() {
		this.#selection = new Set(this.#entries.keys());
		this.#emit({ reason: 'select' });
	}

	update(id, patch, reason = 'update') {
		const entry = this.#entries.get(id);
		if (!entry) return;
		Object.assign(entry, patch);
		this.#emit({ id, reason });
	}

	/** Met à jour la recette ; `path` du type 'adjust.contrast'. */
	setRecipe(id, path, value) {
		const entry = this.#entries.get(id);
		if (!entry) return;
		const keys = path.split('.');
		const last = keys.pop();
		const target = keys.reduce((node, key) => node[key], entry.recipe);
		target[last] = value;
		if (entry.status === STATUS.DONE || entry.status === STATUS.ERROR) entry.status = STATUS.READY;
		this.#emit({ id, reason: 'recipe' });
	}

	resetRecipe(id) {
		const entry = this.#entries.get(id);
		if (!entry) return;
		entry.recipe = emptyRecipe(entry.recipe.output);
		this.#emit({ id, reason: 'recipe' });
	}

	/** Recopie la recette active sur la sélection, sauf les champs propres à chaque fichier et les sorties incompatibles. */
	applyToSelection() {
		const source = this.active;
		if (!source) return 0;
		let count = 0;
		for (const entry of this.selection) {
			if (entry.id === source.id) continue;
			const copy = structuredClone(source.recipe);
			for (const field of PER_FILE_FIELDS) copy[field] = entry.recipe[field];
			if (!outputsFor(entry.item.kind, entry.item.ext).includes(copy.output)) copy.output = entry.recipe.output;
			entry.recipe = copy;
			if (entry.status === STATUS.DONE) entry.status = STATUS.READY;
			count++;
		}
		this.#emit({ reason: 'recipe' });
		return count;
	}

	#emit(detail) {
		this.dispatchEvent(new CustomEvent('change', { detail }));
	}
}
