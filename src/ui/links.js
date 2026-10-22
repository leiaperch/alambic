import { h, icon, ICONS } from '../dom.js';
import { STATUS } from '../store.js';

const PERCENT = 100;
const ERROR_PREFIX = /^Error invoking remote method '[^']+': (Error: )?/;

/**
 * Barre « Coller un lien » : yt-dlp télécharge, puis le fichier rejoint la file.
 * mp4 : le fichier téléchargé est le résultat ; mp3 : conversion lancée aussitôt ; edit : fichier ouvert pour l'éditer.
 */
export class LinkBar {
	#store;
	#runner;
	#form = document.getElementById('linkbar');
	#error = document.getElementById('link-error');
	#list = document.getElementById('downloads');
	#rows = new Map();
	#inFlight = new Set();
	#counter = 0;

	constructor(store, runner) {
		this.#store = store;
		this.#runner = runner;
		this.#form.addEventListener('submit', (event) => {
			event.preventDefault();
			this.#submit();
		});
		window.alambic.onDownload((jobId, payload) => this.#onEvent(jobId, payload));
	}

	disable(message) {
		for (const control of this.#form.elements) control.disabled = true;
		this.#showError(message);
	}

	#showError(message) {
		this.#error.textContent = message ?? '';
		this.#error.hidden = !message;
	}

	async #submit() {
		const fields = this.#form.elements;
		const url = fields.namedItem('url').value.trim();
		const mode = fields.namedItem('mode').value;
		if (this.#inFlight.has(url)) {
			this.#showError('Ce lien est déjà en cours de téléchargement.');
			return;
		}
		this.#showError(null);
		fields.namedItem('url').value = '';
		const jobId = `link-${++this.#counter}`;
		this.#inFlight.add(url);
		this.#rows.set(jobId, this.#createRow(jobId, url));
		try {
			const item = await window.alambic.download(jobId, url, mode);
			this.#rows.get(jobId)?.root.remove();
			this.#rows.delete(jobId);
			await this.#finish(item, mode);
		} catch (error) {
			this.#fail(jobId, error.message.replace(ERROR_PREFIX, ''));
		} finally {
			this.#inFlight.delete(url);
		}
	}

	async #finish(item, mode) {
		await this.#runner.ingest([item]);
		const entry = this.#store.get(item.id);
		if (!entry || entry.status !== STATUS.READY) return;
		if (mode === 'mp4') this.#store.update(item.id, { status: STATUS.DONE, outputs: [item.path] }, 'status');
		if (mode === 'mp3') {
			this.#store.setRecipe(item.id, 'output', 'mp3');
			this.#runner.enqueue([item.id]);
		}
		if (mode === 'edit') this.#store.select(item.id);
	}

	#createRow(jobId, url) {
		const title = h('p', { class: 'download__title', text: new URL(url).hostname.replace(/^www\./, '') });
		const state = h('p', { class: 'download__state', text: 'Préparation…' });
		const fill = h('div', { class: 'row__bar-fill' });
		const cancel = h('button', {
			type: 'button', class: 'btn btn--icon btn--ghost row__action', 'aria-label': 'Annuler le téléchargement', title: 'Annuler',
			on: { click: () => window.alambic.cancelDownload(jobId) },
		}, icon(ICONS.stop));
		const root = h('li', { class: 'download' },
			h('div', { class: 'download__body' }, title, state, h('div', { class: 'row__bar', 'aria-hidden': 'true' }, fill)),
			cancel);
		this.#list.append(root);
		return { root, title, state, fill, cancel };
	}

	#onEvent(jobId, { title, ratio }) {
		const row = this.#rows.get(jobId);
		if (!row) return;
		if (title) row.title.textContent = title;
		if (ratio !== undefined) {
			row.state.textContent = `Téléchargement ${Math.round(ratio * PERCENT)} %`;
			row.fill.style.transform = `scaleX(${ratio})`;
		}
	}

	#fail(jobId, message) {
		const row = this.#rows.get(jobId);
		if (!row) return;
		row.root.classList.add('download--error');
		row.state.textContent = message;
		row.state.setAttribute('role', 'alert');
		row.fill.parentElement.hidden = true;
		row.cancel.setAttribute('aria-label', 'Retirer ce téléchargement');
		row.cancel.title = 'Retirer';
		row.cancel.replaceChildren(icon(ICONS.close));
		row.cancel.addEventListener('click', () => {
			row.root.remove();
			this.#rows.delete(jobId);
		}, { once: true });
		if (this.#store.status?.ytdlpBundled) row.root.append(this.#updateButton());
	}

	/** Bouton désactivé pendant la mise à jour ; le résultat s'affiche dans la zone d'alerte de la barre. */
	#updateButton() {
		const button = h('button', { type: 'button', class: 'btn btn--small download__update', text: 'Mettre à jour yt-dlp' });
		button.addEventListener('click', async () => {
			button.disabled = true;
			try {
				const message = await window.alambic.updateYtdlp();
				this.#showError(`yt-dlp : ${message || 'à jour'}. Relance le téléchargement.`);
			} catch (error) {
				this.#showError(error.message.replace(ERROR_PREFIX, ''));
			} finally {
				button.disabled = false;
			}
		});
		return button;
	}
}
