import { h, icon, ICONS } from '../dom.js';

const MIN_ZONE = 8;

/**
 * Calque des zones floutées, posé comme le cadre de recadrage sur la zone affichée du média.
 * Glisser crée une zone (coordonnées en pixels de la source) ; chaque zone a un bouton pour la retirer.
 * Équivalent clavier : champs et bouton « Ajouter » de la section Cadre.
 */
export class ZoneOverlay {
	#root = h('div', { class: 'zones', title: 'Glisse pour ajouter une zone floutée' });
	#draft = h('div', { class: 'zones__zone zones__zone--draft', hidden: true });
	#source = { width: 1, height: 1 };
	#scale = 1;
	#zones = [];
	#onChange;
	#origin = null;
	#current = null;

	constructor(onChange) {
		this.#onChange = onChange;
		this.#root.append(this.#draft);
		this.#root.addEventListener('pointerdown', (event) => this.#start(event));
		this.#root.addEventListener('pointermove', (event) => this.#move(event));
		this.#root.addEventListener('pointerup', () => this.#end());
		this.#root.addEventListener('pointercancel', () => this.#end());
	}

	get element() {
		return this.#root;
	}

	layout(rect, source) {
		this.#source = source;
		this.#scale = rect.width / source.width;
		Object.assign(this.#root.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
		this.#paint();
	}

	set(zones, active) {
		this.#zones = zones ?? [];
		this.#root.hidden = !active && !this.#zones.length;
		this.#root.classList.toggle('zones--active', active);
		this.#paint();
	}

	#place(element, zone) {
		const s = this.#scale;
		Object.assign(element.style, { left: `${zone.x * s}px`, top: `${zone.y * s}px`, width: `${zone.w * s}px`, height: `${zone.h * s}px` });
	}

	#paint() {
		for (const element of this.#root.querySelectorAll('.zones__zone:not(.zones__zone--draft)')) element.remove();
		this.#zones.forEach((zone, index) => {
			const remove = h('button', {
				type: 'button', class: 'zones__remove', 'aria-label': `Retirer la zone ${index + 1}`, title: 'Retirer cette zone',
				on: {
					pointerdown: (event) => event.stopPropagation(),
					click: () => this.#onChange(this.#zones.filter((_, i) => i !== index)),
				},
			}, icon(ICONS.close));
			const element = h('div', { class: 'zones__zone' }, h('span', { class: 'zones__label', text: String(index + 1) }), remove);
			this.#place(element, zone);
			this.#root.append(element);
		});
	}

	#point(event) {
		const bounds = this.#root.getBoundingClientRect();
		return {
			x: Math.min(this.#source.width, Math.max(0, (event.clientX - bounds.left) / this.#scale)),
			y: Math.min(this.#source.height, Math.max(0, (event.clientY - bounds.top) / this.#scale)),
		};
	}

	#start(event) {
		if (!this.#root.classList.contains('zones--active')) return;
		event.preventDefault();
		this.#root.setPointerCapture(event.pointerId);
		this.#origin = this.#point(event);
		this.#current = { ...this.#origin, w: 0, h: 0 };
		this.#draft.hidden = false;
		this.#place(this.#draft, this.#current);
	}

	#move(event) {
		if (!this.#origin) return;
		const point = this.#point(event);
		this.#current = {
			x: Math.min(point.x, this.#origin.x),
			y: Math.min(point.y, this.#origin.y),
			w: Math.abs(point.x - this.#origin.x),
			h: Math.abs(point.y - this.#origin.y),
		};
		this.#place(this.#draft, this.#current);
	}

	#end() {
		if (!this.#origin) return;
		const zone = this.#current;
		this.#origin = null;
		this.#draft.hidden = true;
		if (zone.w < MIN_ZONE || zone.h < MIN_ZONE) return;
		this.#onChange([...this.#zones, { x: Math.round(zone.x), y: Math.round(zone.y), w: Math.round(zone.w), h: Math.round(zone.h) }]);
	}
}
