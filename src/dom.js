/**
 * Crée un élément sans passer par innerHTML.
 * props : attributs, `class`, `text`, `on` (écouteurs), `dataset` interdit ; les valeurs null/false sont ignorées.
 */
export function h(tag, props = {}, ...children) {
	const element = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) {
		if (value === null || value === undefined || value === false) continue;
		if (key === 'class') element.className = value;
		else if (key === 'text') element.textContent = value;
		else if (key === 'on') for (const [type, listener] of Object.entries(value)) element.addEventListener(type, listener);
		else if (key in element && typeof value !== 'string') element[key] = value;
		else element.setAttribute(key, value === true ? '' : value);
	}
	element.append(...children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false));
	return element;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Icône au trait, 20×20, tracés fournis en attribut d. */
export function icon(paths, label = null) {
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('viewBox', '0 0 20 20');
	svg.setAttribute('class', 'icon');
	if (label) {
		svg.setAttribute('role', 'img');
		svg.setAttribute('aria-label', label);
	} else {
		svg.setAttribute('aria-hidden', 'true');
	}
	for (const d of [paths].flat()) {
		const path = document.createElementNS(SVG_NS, 'path');
		path.setAttribute('d', d);
		svg.append(path);
	}
	return svg;
}

export const ICONS = Object.freeze({
	add: 'M10 4v12M4 10h12',
	folder: 'M3 6.5V15a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-6L8.5 5H4a1 1 0 0 0-1 1.5Z',
	close: 'M5 5l10 10M15 5L5 15',
	play: 'M7 5l8 5-8 5Z',
	pause: ['M7 5v10', 'M13 5v10'],
	rotateLeft: ['M4 8a6 6 0 1 1 1.5 6', 'M4 3.5V8h4.5'],
	rotateRight: ['M16 8a6 6 0 1 0-1.5 6', 'M16 3.5V8h-4.5'],
	flipH: ['M10 3v14', 'M7 6 3 10l4 4Z', 'M13 6l4 4-4 4Z'],
	flipV: ['M3 10h14', 'M6 7l4-4 4 4Z', 'M6 13l4 4 4-4Z'],
	reveal: ['M11 3h6v6', 'M17 3 9 11', 'M15 12v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4'],
	check: 'M4 10.5 8 14.5 16 5.5',
	alert: ['M10 3 2 17h16Z', 'M10 8v4', 'M10 14.5v.5'],
	stop: 'M6 6h8v8H6Z',
	markIn: ['M6 4v12', 'M6 10h8', 'M11 7l3 3-3 3'],
	markOut: ['M14 4v12', 'M14 10H6', 'M9 7l-3 3 3 3'],
	chevronLeft: 'M12 4l-6 6 6 6',
	chevronRight: 'M8 4l6 6-6 6',
	reset: ['M4 10a6 6 0 1 0 2-4.5', 'M4 3v3.5h3.5'],
});

export function formatBytes(bytes) {
	const units = ['o', 'Ko', 'Mo', 'Go'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatTime(seconds) {
	if (!Number.isFinite(seconds)) return '–';
	const minutes = Math.floor(seconds / 60);
	const rest = seconds - minutes * 60;
	return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}

export function debounce(fn, delay) {
	let timer = null;
	return (...args) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delay);
	};
}
