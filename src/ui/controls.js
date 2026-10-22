import { h } from '../dom.js';

let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

/**
 * Contrôles de formulaire liés à un chemin de la recette.
 * Chaque fabrique renvoie { element, sync(value) } ; `onInput(value)` reçoit la valeur typée.
 */

export function field(label, control, hint = null) {
	const hintId = hint ? nextId('hint') : null;
	if (hintId) control.setAttribute('aria-describedby', hintId);
	return h('div', { class: 'field' },
		h('label', { class: 'field__label', for: control.id, text: label }),
		control,
		hint ? h('p', { class: 'field__hint', id: hintId, text: hint }) : null);
}

export function selectControl(label, groups, onInput) {
	const select = h('select', { class: 'input', id: nextId('select') },
		groups.map(({ label: groupLabel, options }) => {
			const items = options.map(({ value, label: text }) => h('option', { value, text }));
			return groupLabel ? h('optgroup', { label: groupLabel }, items) : items;
		}));
	select.addEventListener('change', () => onInput(select.value));
	return { element: field(label, select), sync: (value) => { select.value = String(value); } };
}

/** Champ numérique ; vide = null quand `nullable`. */
export function numberControl(label, { min, max, step = 1, unit = '', nullable = false, placeholder = '', hint = null }, onInput) {
	const input = h('input', {
		class: 'input input--number', id: nextId('number'), type: 'number', inputmode: 'decimal',
		min: min ?? null, max: max ?? null, step: String(step), placeholder,
	});
	input.addEventListener('change', () => {
		if (input.value === '' && nullable) return onInput(null);
		const value = Number(input.value);
		if (!Number.isFinite(value)) return undefined;
		const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));
		input.value = String(clamped);
		return onInput(clamped);
	});
	const element = field(label, input, hint);
	const wrap = h('div', { class: 'input-unit' });
	input.replaceWith(wrap);
	wrap.append(input, unit ? h('span', { class: 'input-unit__unit', 'aria-hidden': 'true', text: unit }) : '');
	return {
		element,
		sync: (value) => {
			if (document.activeElement !== input) input.value = value === null || value === undefined ? '' : String(value);
		},
	};
}

export function sliderControl(label, { min, max, step, neutral, format }, onInput) {
	const input = h('input', { class: 'slider', id: nextId('slider'), type: 'range', min: String(min), max: String(max), step: String(step) });
	const output = h('output', { class: 'slider__value', for: input.id });
	const reset = h('button', { type: 'button', class: 'slider__reset', text: 'Neutre', 'aria-label': `${label} : revenir au neutre` });
	const show = (value) => {
		output.textContent = format(value);
		input.setAttribute('aria-valuetext', format(value));
		reset.hidden = value === neutral;
	};
	input.addEventListener('input', () => {
		show(Number(input.value));
		onInput(Number(input.value));
	});
	reset.addEventListener('click', () => {
		input.value = String(neutral);
		show(neutral);
		onInput(neutral);
	});
	const element = h('div', { class: 'field field--slider' },
		h('div', { class: 'field__row' }, h('label', { class: 'field__label', for: input.id, text: label }), output, reset),
		input);
	return {
		element,
		sync: (value) => {
			input.value = String(value);
			show(value);
		},
	};
}

export function toggleControl(label, onInput, hint = null) {
	const input = h('input', { class: 'switch__input', id: nextId('toggle'), type: 'checkbox', role: 'switch' });
	input.addEventListener('change', () => onInput(input.checked));
	const element = h('div', { class: 'switch' },
		input,
		h('label', { class: 'switch__label', for: input.id }, h('span', { class: 'switch__track', 'aria-hidden': 'true' }), label),
		hint ? h('p', { class: 'field__hint', text: hint }) : null);
	return { element, sync: (value) => { input.checked = Boolean(value); } };
}

/** Groupe de boutons radio présenté en segments. */
export function segmentedControl(label, options, onInput) {
	const name = nextId('segment');
	const legendId = nextId('legend');
	const inputs = options.map(({ value, label: text }) => {
		const input = h('input', { type: 'radio', name, value: String(value) });
		input.addEventListener('change', () => input.checked && onInput(value));
		return { input, value, element: h('label', { class: 'segmented__option' }, input, h('span', { text })) };
	});
	const element = h('div', { class: 'field' },
		h('p', { class: 'field__label', id: legendId, text: label }),
		h('div', { class: 'segmented segmented--fill', role: 'radiogroup', 'aria-labelledby': legendId }, inputs.map((entry) => entry.element)));
	return {
		element,
		sync: (value) => {
			for (const entry of inputs) entry.input.checked = entry.value === value;
		},
	};
}

export function textareaControl(label, placeholder, onInput) {
	const input = h('textarea', { class: 'input input--area', id: nextId('text'), rows: '2', placeholder });
	input.addEventListener('input', () => onInput(input.value));
	return {
		element: field(label, input),
		sync: (value) => {
			if (document.activeElement !== input) input.value = value;
		},
	};
}

export function colorControl(label, onInput) {
	const input = h('input', { class: 'input input--color', id: nextId('color'), type: 'color' });
	input.addEventListener('input', () => onInput(input.value));
	return { element: field(label, input), sync: (value) => { input.value = value; } };
}
