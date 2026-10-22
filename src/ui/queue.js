import { h, icon, ICONS, formatBytes } from '../dom.js';
import { KIND, KIND_LABEL, OUTPUTS } from '../../shared/formats.js';
import { STATUS } from '../store.js';

const PERCENT = 100;
const STATUS_LABEL = {
	[STATUS.ANALYZING]: 'Lecture…',
	[STATUS.READY]: 'Prêt',
	[STATUS.QUEUED]: 'En attente',
	[STATUS.RUNNING]: 'Conversion',
	[STATUS.DONE]: 'Terminé',
	[STATUS.ERROR]: 'Erreur',
};

/** Liste des fichiers : sélection souris (Ctrl, Maj) et clavier (flèches, Ctrl+A, Suppr). */
export class Queue {
	#store;
	#runner;
	#list = document.getElementById('queue-list');
	#empty = document.getElementById('queue-empty');
	#bulk = document.getElementById('queue-bulk');
	#rows = new Map();

	constructor(store, runner) {
		this.#store = store;
		this.#runner = runner;
		this.#list.addEventListener('keydown', (event) => this.#onKey(event));
		store.addEventListener('change', (event) => this.#onChange(event.detail));
	}

	#onChange({ id, reason }) {
		if (reason === 'ui') return;
		if (reason === 'progress' && id) {
			this.#updateRow(id);
			return;
		}
		if (id && this.#rows.has(id) && reason !== 'select') this.#updateRow(id);
		else this.render();
	}

	render() {
		const entries = this.#store.entries;
		this.#empty.hidden = entries.length > 0;
		this.#list.hidden = entries.length === 0;
		for (const [id, row] of this.#rows) {
			if (!this.#store.get(id)) {
				row.root.remove();
				this.#rows.delete(id);
			}
		}
		for (const entry of entries) {
			if (!this.#rows.has(entry.id)) this.#rows.set(entry.id, this.#createRow(entry));
			this.#list.append(this.#rows.get(entry.id).root);
			this.#updateRow(entry.id);
		}
		const active = this.#store.active;
		this.#list.setAttribute('aria-activedescendant', active ? `row-${active.id}` : '');
		this.#renderBulk();
	}

	#createRow(entry) {
		const thumb = h('div', { class: 'row__thumb' });
		const name = h('p', { class: 'row__name', text: entry.item.name, title: entry.item.path });
		const meta = h('p', { class: 'row__meta' });
		const state = h('span', { class: 'row__state' });
		const bar = h('div', { class: 'row__bar', 'aria-hidden': 'true' }, h('div', { class: 'row__bar-fill' }));
		const action = h('button', { type: 'button', class: 'btn btn--icon btn--ghost row__action' });
		const root = h('li', {
			id: `row-${entry.id}`,
			class: 'row',
			role: 'option',
			on: { click: (event) => this.#onClick(event, entry.id) },
		}, thumb, h('div', { class: 'row__body' }, name, meta, bar), h('div', { class: 'row__side' }, state, action));
		action.addEventListener('click', (event) => {
			event.stopPropagation();
			this.#onAction(entry.id);
		});
		return { root, thumb, meta, state, bar, action };
	}

	#updateRow(id) {
		const entry = this.#store.get(id);
		const row = this.#rows.get(id);
		if (!entry || !row) return;
		const { item, status, progress, recipe } = entry;
		row.root.classList.toggle('row--selected', this.#store.isSelected(id));
		row.root.classList.toggle('row--active', this.#store.active?.id === id);
		row.root.setAttribute('aria-selected', String(this.#store.isSelected(id)));
		row.root.className = row.root.className.replace(/\brow--status-\w+/g, '').trim() + ` row--status-${status}`;
		if (entry.thumbUrl && row.thumb.firstChild?.tagName !== 'IMG') row.thumb.replaceChildren(h('img', { src: entry.thumbUrl, alt: '' }));
		if (!entry.thumbUrl && !row.thumb.firstChild) row.thumb.append(h('span', { class: 'row__kind', text: item.ext.toUpperCase() }));
		const target = OUTPUTS[recipe.output]?.label ?? '';
		row.meta.textContent = `${KIND_LABEL[item.kind]} · ${formatBytes(item.size)} → ${target}`;
		const showProgress = status === STATUS.RUNNING || (status === STATUS.ANALYZING && progress > 0);
		row.state.textContent = showProgress ? `${Math.round(progress * PERCENT)} %` : STATUS_LABEL[status];
		row.bar.hidden = !showProgress;
		row.bar.firstChild.style.transform = `scaleX(${progress})`;
		this.#updateAction(row.action, entry);
	}

	#updateAction(button, entry) {
		const busy = entry.status === STATUS.RUNNING || entry.status === STATUS.QUEUED;
		const done = entry.status === STATUS.DONE && entry.outputs.length;
		const [label, glyph] = busy ? ['Annuler', ICONS.stop] : done ? ['Afficher le résultat', ICONS.reveal] : ['Retirer de la liste', ICONS.close];
		if (button.getAttribute('aria-label') === `${label} : ${entry.item.name}`) return;
		button.setAttribute('aria-label', `${label} : ${entry.item.name}`);
		button.title = label;
		button.replaceChildren(icon(glyph));
	}

	#onAction(id) {
		const entry = this.#store.get(id);
		if (entry.status === STATUS.RUNNING || entry.status === STATUS.QUEUED) this.#runner.cancel(id);
		else if (entry.status === STATUS.DONE && entry.outputs.length) window.alambic.reveal(entry.outputs[0]);
		else this.remove([id]);
	}

	remove(ids) {
		const removable = ids.filter((id) => ![STATUS.RUNNING, STATUS.QUEUED].includes(this.#store.get(id)?.status));
		for (const id of removable) window.alambic.removeFile(id);
		this.#store.remove(removable);
	}

	#onClick(event, id) {
		const mode = event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
		this.#store.select(id, mode);
		this.#list.focus();
	}

	#onKey(event) {
		const entries = this.#store.entries;
		const index = entries.findIndex((entry) => entry.id === this.#store.active?.id);
		const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
		if (move && entries.length) {
			event.preventDefault();
			const next = entries[Math.min(entries.length - 1, Math.max(0, index + move))];
			this.#store.select(next.id, event.shiftKey ? 'range' : 'replace');
			this.#rows.get(next.id)?.root.scrollIntoView({ block: 'nearest' });
		} else if (event.key === 'a' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			this.#store.selectAll();
		} else if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			this.remove(this.#store.selection.map((entry) => entry.id));
		}
	}

	/** Actions de lot : assembler des images en PDF, fusionner des PDF, recopier les réglages. */
	#renderBulk() {
		const selection = this.#store.selection;
		this.#bulk.replaceChildren();
		this.#bulk.hidden = selection.length < 2;
		if (selection.length < 2) return;
		const images = selection.filter((entry) => entry.item.kind === KIND.IMAGE && entry.info);
		const pdfs = selection.filter((entry) => entry.item.ext === 'pdf');
		const report = h('span', { class: 'queue__bulk-report', role: 'status' });
		const run = (button, task) => async () => {
			button.disabled = true;
			try {
				const path = await task();
				report.textContent = 'Fichier créé.';
				window.alambic.reveal(path);
			} catch (error) {
				report.textContent = error.message;
			} finally {
				button.disabled = false;
			}
		};
		this.#bulk.append(h('p', { class: 'queue__bulk-title', text: `${selection.length} fichiers sélectionnés` }));
		const apply = h('button', { type: 'button', class: 'btn btn--small', text: 'Leur appliquer les réglages du fichier ouvert' });
		apply.addEventListener('click', () => {
			const count = this.#store.applyToSelection();
			report.textContent = `Réglages recopiés sur ${count} fichier${count > 1 ? 's' : ''}.`;
		});
		this.#bulk.append(apply);
		if (images.length === selection.length) {
			const button = h('button', { type: 'button', class: 'btn btn--small', text: 'Assembler en un PDF' });
			button.addEventListener('click', run(button, () => this.#runner.combine('images', images)));
			this.#bulk.append(button);
		}
		if (pdfs.length === selection.length) {
			const button = h('button', { type: 'button', class: 'btn btn--small', text: 'Fusionner les PDF' });
			button.addEventListener('click', run(button, () => this.#runner.combine('merge', pdfs)));
			this.#bulk.append(button);
		}
		this.#bulk.append(report);
	}
}
