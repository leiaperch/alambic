import { h, icon, ICONS, formatTime, debounce } from '../dom.js';
import { KIND, OUTPUTS, emptyRecipe } from '../../shared/formats.js';
import { STATUS } from '../store.js';
import { CropOverlay } from './crop.js';
import { pdfPageCount, pdfPagePreview } from '../engines/pdf.js';
import { PageGrid } from './page-grid.js';

const PREVIEW_DELAY_MS = 220;
const TIME_STEP = 0.01;
const PREVIEW_PAGE_WIDTH = 1400;
const WAVEFORM_COLOR = '#c8763f';
const TAB = Object.freeze({ SOURCE: 'source', RENDER: 'render' });

const mediaUrl = (id) => `media://item/${id}`;
const pngUrl = (bytes) => URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
const visual = (kind) => kind === KIND.VIDEO || kind === KIND.ANIMATED || kind === KIND.IMAGE;
const timed = (kind) => kind === KIND.VIDEO || kind === KIND.AUDIO || kind === KIND.ANIMATED;

/** Zone centrale : source avec recadrage et timeline, ou rendu exact calculé par ffmpeg. */
export class Stage {
	#store;
	#root = document.getElementById('stage');
	#tab = TAB.SOURCE;
	#entryId = null;
	#media = null;
	#viewport = null;
	#crop = new CropOverlay((crop) => this.#store.active && this.#store.setRecipe(this.#store.active.id, 'crop', crop));
	#render = null;
	#renderUrl = null;
	#renderToken = 0;
	#timeline = null;
	#resize = new ResizeObserver(() => this.#layoutCrop());
	#page = 1;
	#grid = null;
	#gridMode = false;
	#pages = 0;
	#schedulePreview = debounce(() => this.#refreshRender(), PREVIEW_DELAY_MS);

	constructor(store) {
		this.#store = store;
		store.addEventListener('change', (event) => this.#onChange(event.detail));
	}

	#onChange({ id, reason }) {
		const active = this.#store.active;
		if (!active) {
			this.#entryId = null;
			this.#root.replaceChildren(h('div', { class: 'stage__empty' }, h('p', { text: 'Aucun fichier ouvert' })));
			return;
		}
		const ready = active.status !== STATUS.ANALYZING;
		if (active.id !== this.#entryId || (reason === 'analyzed' && id === active.id)) {
			this.#entryId = active.id;
			if (ready) this.#build(active);
			else this.#root.replaceChildren(h('div', { class: 'stage__empty' }, h('p', { text: 'Lecture du fichier…' })));
			return;
		}
		if (id !== active.id && reason !== 'ui') return;
		const gridMode = active.recipe.output === 'pdf-edit';
		if (active.item.ext === 'pdf' && gridMode !== this.#gridMode) {
			this.#build(active);
			return;
		}
		if (this.#grid && reason === 'recipe') this.#grid.render();
		if (reason === 'recipe' || reason === 'ui') {
			this.#crop.set(active.recipe.crop, this.#store.cropAspect);
			this.#syncTimeline();
			if (this.#tab === TAB.RENDER) this.#schedulePreview();
		}
	}

	#build(entry) {
		this.#resize.disconnect();
		this.#media?.pause?.();
		this.#media = null;
		this.#timeline = null;
		this.#grid?.dispose();
		this.#grid = null;
		this.#gridMode = entry.recipe.output === 'pdf-edit';
		const { item, info } = entry;
		const header = this.#header(entry);
		this.#viewport = h('div', { class: 'stage__viewport' });
		const children = [header, this.#viewport];
		if (item.kind === KIND.DOCUMENT) {
			this.#buildDocument(entry);
		} else {
			this.#buildSource(entry);
			if (timed(item.kind) && info?.duration) children.push(this.#buildTimeline(entry));
		}
		this.#root.replaceChildren(...children);
		this.#resize.observe(this.#viewport);
		this.#selectTab(this.#tab);
	}

	#header(entry) {
		const { item, info } = entry;
		const facts = [];
		if (info?.width) facts.push(`${info.width} × ${info.height}`);
		if (info?.duration) facts.push(formatTime(info.duration));
		if (info?.fps && item.kind === KIND.VIDEO) facts.push(`${Math.round(info.fps * 100) / 100} i/s`);
		if (info?.codec) facts.push(info.codec);
		const tabs = item.kind === KIND.DOCUMENT || item.kind === KIND.AUDIO ? null : h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Affichage' },
			this.#tabButton(TAB.SOURCE, 'Source'),
			this.#tabButton(TAB.RENDER, 'Rendu'));
		return h('div', { class: 'stage__head' },
			h('div', { class: 'stage__title' },
				h('h2', { class: 'stage__name', text: item.name }),
				h('p', { class: 'stage__facts', text: facts.join(' · ') })),
			tabs);
	}

	#tabButton(tab, label) {
		return h('button', {
			type: 'button', class: 'tabs__tab', role: 'tab', id: `tab-${tab}`, 'aria-controls': 'stage-viewport',
			on: { click: () => this.#selectTab(tab) },
		}, label);
	}

	#selectTab(tab) {
		this.#tab = tab;
		for (const button of this.#root.querySelectorAll('.tabs__tab')) {
			const selected = button.id === `tab-${tab}`;
			button.setAttribute('aria-selected', String(selected));
			button.tabIndex = selected ? 0 : -1;
		}
		this.#viewport.id = 'stage-viewport';
		this.#viewport.classList.toggle('stage__viewport--render', tab === TAB.RENDER);
		if (tab === TAB.RENDER) {
			this.#media?.pause?.();
			this.#refreshRender();
		}
	}

	#buildSource(entry) {
		const { item } = entry;
		const url = mediaUrl(item.id);
		if (item.kind === KIND.AUDIO) {
			this.#media = h('audio', { src: url, preload: 'auto' });
			const wave = h('img', { class: 'stage__wave', alt: 'Forme d’onde du son' });
			window.alambic.waveform(item.id, WAVEFORM_COLOR).then((bytes) => { wave.src = pngUrl(bytes); }, () => wave.remove());
			this.#viewport.append(h('div', { class: 'stage__audio' }, wave), this.#media);
			return;
		}
		const playable = item.kind === KIND.VIDEO;
		this.#media = playable
			? h('video', { class: 'stage__media', src: url, preload: 'auto', muted: false, playsInline: true })
			: h('img', { class: 'stage__media', src: url, alt: '' });
		if (playable) this.#media.addEventListener('error', () => this.#fallbackToFrames(entry), { once: true });
		this.#media.addEventListener(playable ? 'loadedmetadata' : 'load', () => this.#layoutCrop());
		this.#render = h('img', { class: 'stage__render', alt: 'Aperçu du rendu final' });
		this.#viewport.append(h('div', { class: 'stage__source' }, this.#media, this.#crop.element), this.#render,
			h('p', { class: 'stage__hint', text: 'Glisse sur l’image pour recadrer' }));
		this.#crop.set(entry.recipe.crop, this.#store.cropAspect);
	}

	/** Conteneur que Chromium ne sait pas lire (AVI, WMV…) : on affiche des images calculées par ffmpeg. */
	#fallbackToFrames(entry) {
		const still = h('img', { class: 'stage__media', alt: '' });
		still.addEventListener('load', () => this.#layoutCrop());
		this.#media.replaceWith(still);
		this.#media = still;
		this.#frameAt = async (time) => {
			const bytes = await window.alambic.preview(entry.id, emptyRecipe(entry.recipe.output), time);
			if (still.src) URL.revokeObjectURL(still.src);
			still.src = pngUrl(bytes);
		};
		this.#frameAt(this.#store.playhead);
	}

	#frameAt = null;

	#layoutCrop() {
		const active = this.#store.active;
		if (!active?.info?.width || !this.#media || this.#media.tagName === 'AUDIO') return;
		const host = this.#media.parentElement;
		if (!host) return;
		const box = host.getBoundingClientRect();
		const { width, height } = active.info;
		const scale = Math.min(box.width / width, box.height / height);
		const rect = { width: width * scale, height: height * scale };
		rect.left = (box.width - rect.width) / 2;
		rect.top = (box.height - rect.height) / 2;
		this.#crop.layout(rect, { width, height });
	}

	async #refreshRender() {
		const active = this.#store.active;
		if (!active || !this.#render || this.#tab !== TAB.RENDER || !visual(active.item.kind)) return;
		const token = ++this.#renderToken;
		const { recipe } = active;
		const time = OUTPUTS[recipe.output]?.still ? recipe.frameTime : Math.max(this.#store.playhead, recipe.trim?.start ?? 0);
		this.#viewport.classList.add('stage__viewport--busy');
		try {
			const bytes = await window.alambic.preview(active.id, recipe, time);
			if (token !== this.#renderToken) return;
			if (this.#renderUrl) URL.revokeObjectURL(this.#renderUrl);
			this.#renderUrl = pngUrl(bytes);
			this.#render.src = this.#renderUrl;
		} catch (error) {
			if (token === this.#renderToken) this.#render.alt = `Aperçu impossible : ${error.message}`;
		} finally {
			if (token === this.#renderToken) this.#viewport.classList.remove('stage__viewport--busy');
		}
	}

	#buildTimeline(entry) {
		const duration = entry.info.duration;
		const range = (label, value) => h('input', {
			type: 'range', class: 'timeline__range', min: '0', max: String(duration), step: String(TIME_STEP), value: String(value), 'aria-label': label,
		});
		const start = range('Début du passage gardé', entry.recipe.trim?.start ?? 0);
		const end = range('Fin du passage gardé', entry.recipe.trim?.end ?? duration);
		const head = h('div', { class: 'timeline__head', 'aria-hidden': 'true' });
		const span = h('div', { class: 'timeline__span', 'aria-hidden': 'true' });
		const track = h('div', { class: 'timeline__track' }, span, head, start, end);
		const clock = h('span', { class: 'timeline__clock', 'aria-live': 'off' });
		const kept = h('span', { class: 'timeline__kept' });
		const play = this.#media && this.#media.tagName !== 'IMG'
			? h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Lire', on: { click: () => this.#togglePlay() } }, icon(ICONS.play))
			: null;
		const markIn = h('button', { type: 'button', class: 'btn btn--small', on: { click: () => this.#setTrim('start', this.#store.playhead) } }, icon(ICONS.markIn), 'Début ici');
		const markOut = h('button', { type: 'button', class: 'btn btn--small', on: { click: () => this.#setTrim('end', this.#store.playhead) } }, icon(ICONS.markOut), 'Fin ici');
		start.addEventListener('input', () => this.#setTrim('start', Number(start.value)));
		end.addEventListener('input', () => this.#setTrim('end', Number(end.value)));
		track.addEventListener('pointerdown', (event) => {
			if (event.target !== track && event.target !== span) return;
			const bounds = track.getBoundingClientRect();
			this.#seek(((event.clientX - bounds.left) / bounds.width) * duration);
		});
		this.#timeline = { start, end, head, span, clock, kept, play, duration };
		if (this.#media && this.#media.tagName !== 'IMG') {
			this.#media.addEventListener('timeupdate', () => this.#onTime());
			this.#media.addEventListener('play', () => this.#syncPlay());
			this.#media.addEventListener('pause', () => this.#syncPlay());
		}
		this.#syncTimeline();
		return h('div', { class: 'timeline' },
			h('div', { class: 'timeline__controls' }, play, clock, h('span', { class: 'timeline__spacer' }), kept, markIn, markOut),
			track);
	}

	#setTrim(edge, value) {
		const active = this.#store.active;
		const duration = this.#timeline?.duration;
		if (!active || !duration) return;
		const trim = { start: active.recipe.trim?.start ?? 0, end: active.recipe.trim?.end ?? duration };
		trim[edge] = Math.round(value / TIME_STEP) * TIME_STEP;
		if (edge === 'start') trim.start = Math.min(trim.start, trim.end - TIME_STEP);
		else trim.end = Math.max(trim.end, trim.start + TIME_STEP);
		const full = trim.start <= 0 && trim.end >= duration;
		this.#store.setRecipe(active.id, 'trim', full ? null : trim);
	}

	#syncTimeline() {
		const t = this.#timeline;
		const active = this.#store.active;
		if (!t || !active) return;
		const start = active.recipe.trim?.start ?? 0;
		const end = active.recipe.trim?.end ?? t.duration;
		t.start.value = String(start);
		t.end.value = String(end);
		t.span.style.left = `${(start / t.duration) * 100}%`;
		t.span.style.width = `${((end - start) / t.duration) * 100}%`;
		t.kept.textContent = `Gardé : ${formatTime(end - start)}`;
		this.#onTime();
	}

	#onTime() {
		const t = this.#timeline;
		const active = this.#store.active;
		if (!t || !active) return;
		const media = this.#media;
		const current = media && media.tagName !== 'IMG' && Number.isFinite(media.currentTime) ? media.currentTime : this.#store.playhead;
		const end = active.recipe.trim?.end ?? t.duration;
		if (media && !media.paused && current >= end) media.currentTime = active.recipe.trim?.start ?? 0;
		this.#store.playhead = current;
		t.head.style.left = `${(current / t.duration) * 100}%`;
		t.clock.textContent = `${formatTime(current)} / ${formatTime(t.duration)}`;
	}

	#seek(time) {
		const active = this.#store.active;
		const clamped = Math.min(this.#timeline.duration, Math.max(0, time));
		this.#store.playhead = clamped;
		if (this.#media && this.#media.tagName !== 'IMG' && this.#media.currentTime !== undefined) this.#media.currentTime = clamped;
		this.#frameAt?.(clamped);
		if (active && OUTPUTS[active.recipe.output]?.still) this.#store.setRecipe(active.id, 'frameTime', clamped);
		this.#onTime();
		if (this.#tab === TAB.RENDER) this.#schedulePreview();
	}

	#togglePlay() {
		const media = this.#media;
		if (!media?.play) return;
		if (this.#tab === TAB.RENDER) this.#selectTab(TAB.SOURCE);
		if (media.paused) media.play();
		else media.pause();
	}

	#syncPlay() {
		const button = this.#timeline?.play;
		if (!button) return;
		const playing = !this.#media.paused;
		button.setAttribute('aria-label', playing ? 'Pause' : 'Lire');
		button.replaceChildren(icon(playing ? ICONS.pause : ICONS.play));
	}

	async #buildDocument(entry) {
		const { item } = entry;
		if (item.ext !== 'pdf') {
			this.#viewport.append(h('div', { class: 'stage__doc' },
				h('p', { class: 'stage__doc-ext', text: item.ext.toUpperCase() }),
				h('p', { class: 'stage__doc-text', text: this.#store.status?.word
					? 'Converti par Microsoft Word, mise en page conservée.'
					: 'Microsoft Word est introuvable : la conversion de ce document est impossible.' })));
			return;
		}
		if (this.#gridMode) {
			this.#grid = new PageGrid(this.#store, entry);
			this.#viewport.classList.add('stage__viewport--grid');
			this.#viewport.append(this.#grid.element);
			return;
		}
		const page = h('img', { class: 'stage__page', alt: '' });
		const label = h('span', { class: 'pager__label', 'aria-live': 'polite' });
		const prev = h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Page précédente', on: { click: () => this.#showPage(entry, this.#page - 1, page, label) } }, icon(ICONS.chevronLeft));
		const next = h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Page suivante', on: { click: () => this.#showPage(entry, this.#page + 1, page, label) } }, icon(ICONS.chevronRight));
		this.#viewport.append(h('div', { class: 'stage__pdf' }, page), h('div', { class: 'pager' }, prev, label, next));
		this.#pages = await pdfPageCount(item);
		this.#showPage(entry, 1, page, label);
	}

	async #showPage(entry, number, image, label) {
		if (number < 1 || number > this.#pages) return;
		this.#page = number;
		label.textContent = `Page ${number} sur ${this.#pages}`;
		const blob = await pdfPagePreview(entry.item, number, PREVIEW_PAGE_WIDTH);
		if (image.src) URL.revokeObjectURL(image.src);
		image.src = URL.createObjectURL(blob);
		image.alt = `Page ${number}`;
	}
}
