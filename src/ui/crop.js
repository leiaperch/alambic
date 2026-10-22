import { h } from '../dom.js';

const MIN_CROP = 8;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * Cadre de recadrage posé sur la zone affichée du média. Les coordonnées sont en pixels de la source.
 * Le glisser a son équivalent clavier dans l'inspecteur (champs X, Y, largeur, hauteur).
 */
export class CropOverlay {
	#root;
	#box;
	#shade;
	#source = { width: 1, height: 1 };
	#scale = 1;
	#crop = null;
	#aspect = null;
	#onChange;
	#drag = null;

	constructor(onChange) {
		this.#onChange = onChange;
		const handles = HANDLES.map((name) => h('div', {
			class: `crop__handle crop__handle--${name}`,
			'aria-hidden': 'true',
			on: { pointerdown: (event) => this.#start(event, name) },
		}));
		this.#box = h('div', { class: 'crop__box', hidden: true }, h('div', { class: 'crop__grid', 'aria-hidden': 'true' }), handles);
		this.#shade = h('div', { class: 'crop__shade', 'aria-hidden': 'true' });
		this.#root = h('div', { class: 'crop', title: 'Glisse pour recadrer' }, this.#shade, this.#box);
		this.#box.addEventListener('pointerdown', (event) => {
			if (event.target === this.#box || event.target.classList.contains('crop__grid')) this.#start(event, 'move');
		});
		this.#root.addEventListener('pointerdown', (event) => {
			if (event.target === this.#root || event.target === this.#shade) this.#start(event, 'new');
		});
		this.#root.addEventListener('pointermove', (event) => this.#move(event));
		this.#root.addEventListener('pointerup', () => this.#end());
		this.#root.addEventListener('pointercancel', () => this.#end());
	}

	get element() {
		return this.#root;
	}

	/** Place le calque sur le rectangle affiché du média (en px du conteneur). */
	layout(rect, source) {
		this.#source = source;
		this.#scale = rect.width / source.width;
		Object.assign(this.#root.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
		this.#paint();
	}

	set(crop, aspect) {
		this.#crop = crop ? { ...crop } : null;
		this.#aspect = aspect;
		this.#paint();
	}

	#paint() {
		const crop = this.#crop;
		this.#box.hidden = !crop;
		if (!crop) return;
		const s = this.#scale;
		Object.assign(this.#box.style, { left: `${crop.x * s}px`, top: `${crop.y * s}px`, width: `${crop.w * s}px`, height: `${crop.h * s}px` });
	}

	#point(event) {
		const bounds = this.#root.getBoundingClientRect();
		return {
			x: Math.min(this.#source.width, Math.max(0, (event.clientX - bounds.left) / this.#scale)),
			y: Math.min(this.#source.height, Math.max(0, (event.clientY - bounds.top) / this.#scale)),
		};
	}

	#start(event, mode) {
		event.preventDefault();
		event.stopPropagation();
		this.#root.setPointerCapture(event.pointerId);
		const origin = this.#point(event);
		const start = this.#crop ?? { x: origin.x, y: origin.y, w: 0, h: 0 };
		this.#drag = { mode, origin, start: { ...start } };
		if (mode === 'new') this.#crop = { ...start };
	}

	#move(event) {
		if (!this.#drag) return;
		const point = this.#point(event);
		const { mode, origin, start } = this.#drag;
		const dx = point.x - origin.x;
		const dy = point.y - origin.y;
		this.#crop = mode === 'move' ? this.#moved(start, dx, dy) : this.#resized(start, mode === 'new' ? 'se' : mode, dx, dy, origin);
		this.#paint();
	}

	#moved(start, dx, dy) {
		const { width, height } = this.#source;
		return {
			...start,
			x: Math.min(width - start.w, Math.max(0, start.x + dx)),
			y: Math.min(height - start.h, Math.max(0, start.y + dy)),
		};
	}

	/** Redimensionne depuis une poignée ; le bord opposé reste fixe. */
	#resized(start, handle, dx, dy) {
		const { width, height } = this.#source;
		let left = start.x;
		let top = start.y;
		let right = start.x + start.w;
		let bottom = start.y + start.h;
		if (handle.includes('w')) left = Math.min(right - MIN_CROP, Math.max(0, left + dx));
		if (handle.includes('e')) right = Math.max(left + MIN_CROP, Math.min(width, right + dx));
		if (handle.includes('n')) top = Math.min(bottom - MIN_CROP, Math.max(0, top + dy));
		if (handle.includes('s')) bottom = Math.max(top + MIN_CROP, Math.min(height, bottom + dy));
		let w = right - left;
		let hgt = bottom - top;
		if (this.#aspect) {
			if (handle === 'n' || handle === 's') w = hgt * this.#aspect;
			else hgt = w / this.#aspect;
			if (handle.includes('w')) left = right - w;
			if (handle.includes('n')) top = bottom - hgt;
			if (left < 0 || top < 0 || left + w > width || top + hgt > height) return this.#crop;
		}
		return { x: left, y: top, w, h: hgt };
	}

	#end() {
		if (!this.#drag) return;
		this.#drag = null;
		const crop = this.#crop;
		if (!crop || crop.w < MIN_CROP || crop.h < MIN_CROP) {
			this.#crop = null;
			this.#onChange(null);
		} else {
			this.#onChange({ x: Math.round(crop.x), y: Math.round(crop.y), w: Math.round(crop.w), h: Math.round(crop.h) });
		}
		this.#paint();
	}
}
