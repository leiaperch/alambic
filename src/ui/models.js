import { h } from '../dom.js';

const PERCENT = 100;
const ERROR_PREFIX = /^Error invoking remote method '[^']+': (Error: )?/;
const TOOLS = new Set(['upscale', 'matting', 'stems']);

/** Ce que l'encadré affiche pour chaque ressource téléchargeable. */
const DESCRIPTORS = Object.freeze({
	base: { ready: 'Modèle « Rapide » installé. Tout reste sur ce poste.', missing: 'La reconnaissance vocale a besoin d’un modèle à télécharger une fois (148 Mo).' },
	turbo: { ready: 'Modèle « Précis » installé. Tout reste sur ce poste.', missing: 'La reconnaissance vocale a besoin d’un modèle à télécharger une fois (574 Mo).' },
	upscale: { ready: 'Real-ESRGAN installé, calcul sur la carte graphique.', missing: 'L’agrandissement utilise Real-ESRGAN, à télécharger une fois (45 Mo).' },
	stems: { ready: 'Modèle UVR MDX-Net installé. Compter un peu moins que la durée du morceau.', missing: 'La séparation utilise un modèle UVR MDX-Net, à télécharger une fois (67 Mo).' },
	matting: { ready: 'Modèle BiRefNet installé. Environ 20 s par image sur un portable récent.', missing: 'Le détourage utilise le modèle BiRefNet, à télécharger une fois (224 Mo).' },
});

/**
 * Modèles Whisper et outils téléchargeables (Real-ESRGAN), partagés par toutes les sections qui en dépendent.
 * Émet `change` quand une ressource arrive, quand une progression bouge ou quand un téléchargement échoue.
 */
export class Models extends EventTarget {
	#status = {};
	#progress = new Map();
	#errors = new Map();

	constructor() {
		super();
		const onProgress = (name, ratio) => {
			this.#progress.set(name, ratio);
			this.#emit();
		};
		window.alambic.onModelProgress(onProgress);
		window.alambic.onToolProgress(onProgress);
		this.refresh();
	}

	async refresh() {
		const [models, tools] = await Promise.all([window.alambic.modelStatus(), window.alambic.toolStatus()]);
		this.#status = { ...models, ...tools };
		this.#emit();
	}

	has(name) {
		return TOOLS.has(name) ? Boolean(this.#status[name]) : Boolean(this.#status[name] && this.#status.vad);
	}

	progress(name) {
		return this.#progress.get(name) ?? null;
	}

	error(name) {
		return this.#errors.get(name) ?? null;
	}

	async download(name) {
		this.#errors.delete(name);
		this.#progress.set(name, 0);
		this.#emit();
		try {
			const status = TOOLS.has(name) ? await window.alambic.installTool(name) : await window.alambic.downloadModel(name);
			this.#status = { ...this.#status, ...status };
		} catch (error) {
			this.#errors.set(name, error.message.replace(ERROR_PREFIX, ''));
		} finally {
			this.#progress.delete(name);
			this.#emit();
		}
	}

	cancel(name) {
		if (TOOLS.has(name)) window.alambic.cancelTool(name);
		else window.alambic.cancelModel(name);
	}

	#emit() {
		this.dispatchEvent(new Event('change'));
	}
}

/** Encadré : prêt, bouton de téléchargement, ou progression avec annulation. */
export function modelPanel(models, name) {
	const root = h('div', { class: 'model', 'aria-live': 'polite' });
	const text = DESCRIPTORS[name];
	const render = () => {
		const progress = models.progress(name);
		if (models.has(name)) {
			root.replaceChildren(h('p', { class: 'model__ready', text: text.ready }));
			return;
		}
		if (progress !== null) {
			const bar = h('div', { class: 'row__bar' }, h('div', { class: 'row__bar-fill' }));
			bar.firstChild.style.transform = `scaleX(${progress})`;
			root.replaceChildren(
				h('p', { class: 'model__text', text: `Téléchargement… ${Math.round(progress * PERCENT)} %` }),
				bar,
				h('button', { type: 'button', class: 'btn btn--small btn--ghost', text: 'Annuler', on: { click: () => models.cancel(name) } }));
			return;
		}
		const error = models.error(name);
		root.replaceChildren(
			h('p', { class: 'model__text', text: text.missing }),
			error ? h('p', { class: 'notice notice--error', role: 'alert', text: error }) : null,
			h('button', { type: 'button', class: 'btn btn--small btn--primary', text: 'Télécharger', on: { click: () => models.download(name) } }));
	};
	models.addEventListener('change', render);
	render();
	return { element: root, dispose: () => models.removeEventListener('change', render) };
}
