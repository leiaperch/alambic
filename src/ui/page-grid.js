import { h, icon, ICONS } from '../dom.js';
import { pdfPageCount, pdfPagePreview } from '../engines/pdf.js';

const THUMB_WIDTH = 220;
const QUARTER_TURN = 90;
const FULL_TURN = 360;
const ICON_ROTATE = ICONS.rotateRight;

/**
 * Grille des pages d'un PDF : réordonner au glisser ou avec les boutons, tourner, retirer.
 * L'ordre est écrit dans recipe.pageOrder ([{ page, rotate }]).
 */
export class PageGrid {
	#store;
	#entryId;
	#item;
	#root = h('div', { class: 'pages' });
	#list = h('ol', { class: 'pages__list', 'aria-label': 'Pages du document' });
	#summary = h('p', { class: 'pages__summary', 'aria-live': 'polite' });
	#thumbs = new Map();
	#count = 0;
	#dragFrom = null;

	constructor(store, entry) {
		this.#store = store;
		this.#entryId = entry.id;
		this.#item = entry.item;
		this.#root.append(this.#summary, this.#list);
		this.#load();
	}

	get element() {
		return this.#root;
	}

	async #load() {
		this.#count = await pdfPageCount(this.#item);
		this.render();
		for (let page = 1; page <= this.#count; page++) {
			if (!this.#root.isConnected && page > 1) return;
			const blob = await pdfPagePreview(this.#item, page, THUMB_WIDTH);
			this.#thumbs.set(page, URL.createObjectURL(blob));
			const image = this.#list.querySelector(`#page-thumb-${page}`);
			if (image) image.src = this.#thumbs.get(page);
		}
	}

	dispose() {
		for (const url of this.#thumbs.values()) URL.revokeObjectURL(url);
		this.#thumbs.clear();
	}

	#order() {
		const recipe = this.#store.get(this.#entryId)?.recipe;
		return recipe?.pageOrder ?? Array.from({ length: this.#count }, (_, index) => ({ page: index + 1, rotate: 0 }));
	}

	#commit(order) {
		const identity = order.length === this.#count && order.every((entry, index) => entry.page === index + 1 && entry.rotate === 0);
		this.#store.setRecipe(this.#entryId, 'pageOrder', identity ? null : order);
	}

	render() {
		if (!this.#count) return;
		const order = this.#order();
		this.#summary.textContent = `${order.length} page${order.length > 1 ? 's' : ''} gardée${order.length > 1 ? 's' : ''} sur ${this.#count}`;
		this.#list.replaceChildren(...order.map((entry, index) => this.#card(entry, index, order.length)));
	}

	#card({ page, rotate }, index, total) {
		const image = h('img', { class: 'page__thumb', id: `page-thumb-${page}`, alt: '', src: this.#thumbs.get(page) ?? null, draggable: false });
		image.style.transform = `rotate(${rotate}deg)`;
		const button = (label, glyph, action, disabled = false) => h('button', {
			type: 'button', class: 'btn btn--icon btn--ghost page__btn', 'aria-label': `${label} (page ${page})`, title: label, disabled,
			on: { click: action },
		}, icon(glyph));
		const card = h('li', { class: 'page', draggable: true },
			h('div', { class: 'page__frame' }, image),
			h('div', { class: 'page__bar' },
				h('span', { class: 'page__label', text: `${index + 1}`, title: `Page ${page} de l’original` }),
				button('Avancer', ICONS.chevronLeft, () => this.#move(index, -1), index === 0),
				button('Reculer', ICONS.chevronRight, () => this.#move(index, 1), index === total - 1),
				button('Tourner', ICON_ROTATE, () => this.#rotate(index)),
				button('Retirer', ICONS.close, () => this.#remove(index), total === 1)));
		card.addEventListener('dragstart', (event) => {
			this.#dragFrom = index;
			event.dataTransfer.effectAllowed = 'move';
			card.classList.add('page--dragging');
		});
		card.addEventListener('dragend', () => card.classList.remove('page--dragging'));
		card.addEventListener('dragover', (event) => {
			if (this.#dragFrom === null) return;
			event.preventDefault();
			card.classList.add('page--target');
		});
		card.addEventListener('dragleave', () => card.classList.remove('page--target'));
		card.addEventListener('drop', (event) => {
			event.preventDefault();
			event.stopPropagation();
			const from = this.#dragFrom;
			this.#dragFrom = null;
			if (from !== null && from !== index) this.#moveTo(from, index);
		});
		return card;
	}

	#move(index, delta) {
		this.#moveTo(index, index + delta);
	}

	#moveTo(from, to) {
		const order = [...this.#order()];
		const [entry] = order.splice(from, 1);
		order.splice(to, 0, entry);
		this.#commit(order);
	}

	#rotate(index) {
		const order = this.#order().map((entry) => ({ ...entry }));
		order[index].rotate = (order[index].rotate + QUARTER_TURN) % FULL_TURN;
		this.#commit(order);
	}

	#remove(index) {
		const order = [...this.#order()];
		order.splice(index, 1);
		this.#commit(order);
	}
}
