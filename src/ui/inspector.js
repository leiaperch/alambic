import { h, icon, ICONS } from '../dom.js';
import { KIND, OUTPUTS, QUALITY, FILTERS, TEXT_POSITIONS, DISCORD_PRESET, SUB_LANGUAGES, SUB_MODELS, UPSCALE_STYLES, outputsFor } from '../../shared/formats.js';
import { Models, modelPanel } from './models.js';
import { STATUS } from '../store.js';
import {
	selectControl, numberControl, sliderControl, toggleControl, segmentedControl, textareaControl, colorControl,
} from './controls.js';

const LOSSY = new Set(['mp4', 'mp4-hevc', 'mp4-av1', 'webm', 'mov', 'mkv', 'gif', 'webp-anim', 'mp3', 'm4a', 'ogg', 'opus', 'jpg', 'webp', 'avif', 'jxl', 'pdf-jpg']);
const VIDEO_CODEC = { mp4: 'h264', mov: 'h264', mkv: 'h264', 'mp4-hevc': 'hevc', 'mp4-av1': 'av1' };
const ANIMATED_OUTPUTS = new Set(['gif', 'webp-anim', 'apng']);
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const ASPECTS = [
	{ value: 0, label: 'Libre' }, { value: 1, label: '1:1' }, { value: 4 / 3, label: '4:3' },
	{ value: 16 / 9, label: '16:9' }, { value: 9 / 16, label: '9:16' },
];
const DPIS = [72, 150, 300];
const FULL_TURN = 360;
const QUARTER_TURN = 90;
const MAX_DIMENSION = 16384;
const TIME_STEP = 0.01;
const MAX_FPS = 120;
const MAX_TARGET_MB = 100_000;
const PERCENT = 100;
const MAX_FADE_SECONDS = 30;
const MAX_SPRITE_COLUMNS = 64;
const GROUPS = [
	['Vidéo', (o) => o.motion && !ANIMATED_OUTPUTS.has(o.id)],
	['Animation', (o) => ANIMATED_OUTPUTS.has(o.id)],
	['Audio', (o) => o.audioOnly],
	['Image', (o) => o.still],
	['Document', (o) => o.engine === 'pdf' || o.engine === 'office'],
];

const signed = (value, digits = 2) => `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
const factor = (value) => `× ${value.toFixed(2)}`;

/** Panneau de droite : réglages de la recette du fichier ouvert, par sections repliables. */
export class Inspector {
	#store;
	#runner;
	#root = document.getElementById('inspector');
	#bindings = [];
	#builtFor = null;
	#openSections = new Set(['Sortie', 'Sous-titres', 'Agrandissement', 'Détourage', 'Séparation', 'Cadre', 'Temps', 'Pages']);
	#footer = null;
	#models = new Models();
	#disposers = [];

	constructor(store, runner) {
		this.#store = store;
		this.#runner = runner;
		store.addEventListener('change', (event) => this.#onChange(event.detail));
	}

	#onChange({ id, reason }) {
		const active = this.#store.active;
		const key = active ? `${active.id}|${active.recipe.output}|${active.status === STATUS.ANALYZING}` : null;
		if (key !== this.#builtFor || reason === 'analyzed') {
			this.#builtFor = key;
			this.#build(active);
			return;
		}
		if (!active || (id && id !== active.id)) return;
		this.#sync(active);
		this.#renderFooter(active);
	}

	#build(entry) {
		this.#bindings = [];
		for (const dispose of this.#disposers.splice(0)) dispose();
		if (!entry || entry.status === STATUS.ANALYZING) {
			this.#root.replaceChildren(h('div', { class: 'inspector__empty' }, h('p', { text: entry ? 'Lecture du fichier…' : 'Ouvre un fichier pour régler sa conversion.' })));
			return;
		}
		const sections = [this.#outputSection(entry)];
		const output = OUTPUTS[entry.recipe.output];
		const { kind } = entry.item;
		const isVisual = [KIND.VIDEO, KIND.ANIMATED, KIND.IMAGE].includes(kind) && !output.audioOnly
			&& (output.engine === 'ffmpeg' || output.burn || output.engine === 'upscale' || output.engine === 'matting');
		if (isVisual) sections.push(this.#frameSection(entry));
		if ([KIND.VIDEO, KIND.AUDIO, KIND.ANIMATED].includes(kind) && entry.info?.duration) sections.push(this.#timeSection(entry, output));
		if ((kind === KIND.VIDEO || kind === KIND.ANIMATED || kind === KIND.AUDIO) && !output.still) sections.push(this.#motionSection(entry, output));
		if (isVisual) sections.push(this.#colorSection(), this.#textSection());
		const audioOut = output.audio || output.audioOnly || output.engine === 'stems';
		if ((kind === KIND.VIDEO && entry.info?.hasAudio && audioOut) || (kind === KIND.AUDIO && output.engine !== 'whisper')) sections.push(this.#audioSection(kind, output));
		if (entry.item.ext === 'pdf' && output.engine === 'pdf') sections.push(this.#pagesSection(entry));
		if (output.engine === 'whisper') sections.splice(1, 0, this.#subtitleSection(entry));
		if (output.engine === 'upscale') sections.splice(1, 0, this.#upscaleSection());
		if (output.engine === 'matting') sections.splice(1, 0, this.#mattingSection());
		if (output.engine === 'stems') sections.splice(1, 0, this.#stemsSection());
		this.#footer = h('div', { class: 'inspector__footer' });
		this.#root.replaceChildren(h('div', { class: 'inspector__scroll' }, sections), this.#footer);
		this.#sync(entry);
		this.#renderFooter(entry);
	}

	#section(title, ...children) {
		const details = h('details', { class: 'section', open: this.#openSections.has(title) },
			h('summary', { class: 'section__title', text: title }),
			h('div', { class: 'section__body' }, children));
		details.addEventListener('toggle', () => {
			if (details.open) this.#openSections.add(title);
			else this.#openSections.delete(title);
		});
		return details;
	}

	/** Lie un contrôle à un chemin de recette ; `read` permet d'afficher une valeur dérivée. */
	#bind(control, path, read = null) {
		this.#bindings.push({ control, read: read ?? ((recipe) => path.split('.').reduce((node, key) => node?.[key], recipe)) });
		return control.element;
	}

	#set(path, value) {
		const active = this.#store.active;
		if (active) this.#store.setRecipe(active.id, path, value);
	}

	#sync(entry) {
		for (const { control, read } of this.#bindings) control.sync(read(entry.recipe));
	}

	#outputSection(entry) {
		const { kind, ext } = entry.item;
		const available = outputsFor(kind, ext).map((id) => ({ id, ...OUTPUTS[id] }));
		const groups = GROUPS
			.map(([label, test]) => ({ label, options: available.filter(test).map((o) => ({ value: o.id, label: o.label })) }))
			.filter((group) => group.options.length);
		const id = entry.recipe.output;
		const children = [];
		if (kind === KIND.VIDEO || kind === KIND.ANIMATED) {
			children.push(h('button', { type: 'button', class: 'btn btn--small preset', on: { click: () => this.#applyDiscord() } },
				'Compresser pour Discord', h('span', { class: 'preset__hint', text: `MP4 sous ${Math.ceil(DISCORD_PRESET.targetSizeMb)} Mo` })));
		}
		children.push(this.#bind(selectControl('Format de sortie', groups, (value) => this.#set('output', value)), 'output'));
		if (LOSSY.has(id)) {
			children.push(this.#bind(segmentedControl('Qualité', QUALITY.map((q) => ({ value: q.id, label: q.label })), (value) => this.#set('quality', value)), 'quality'));
		}
		if (VIDEO_CODEC[id] || id === 'webm') {
			children.push(this.#bind(numberControl('Poids visé', { min: 0.1, max: MAX_TARGET_MB, step: 0.1, unit: 'Mo', nullable: true, placeholder: 'libre', hint: 'Remplace le réglage de qualité.' }, (value) => this.#set('targetSizeMb', value)), 'targetSizeMb'));
		}
		const hardware = this.#store.status?.hardware?.[VIDEO_CODEC[id]];
		if (hardware) {
			children.push(this.#bind(toggleControl('Accélération matérielle', (value) => this.#set('gpu', value), `Encodeur ${hardware}, plus rapide mais un peu plus lourd.`), 'gpu'));
		}
		if (ANIMATED_OUTPUTS.has(id)) children.push(this.#bind(toggleControl('Lecture en boucle', (value) => this.#set('loop', value)), 'loop'));
		if (id === 'sprite') {
			children.push(this.#bind(numberControl('Colonnes de la planche', { min: 1, max: MAX_SPRITE_COLUMNS, nullable: true, placeholder: 'auto' }, (value) => this.#set('spriteColumns', value)), 'spriteColumns'));
		}
		if (OUTPUTS[id].engine === 'ffmpeg') {
			children.push(this.#bind(toggleControl('Retirer les métadonnées', (value) => this.#set('stripMetadata', value), 'Position GPS, appareil, dates et chapitres.'), 'stripMetadata'));
		}
		if (OUTPUTS[id].engine === 'office' && !this.#store.status?.word) {
			children.push(h('p', { class: 'notice notice--error', role: 'alert', text: 'Microsoft Word est introuvable sur ce poste.' }));
		}
		return this.#section('Sortie', children);
	}

	/** MP4 H.264 sous la limite d'envoi de Discord ; la largeur n'est réduite que si la source dépasse le plafond. */
	#applyDiscord() {
		const active = this.#store.active;
		if (!active) return;
		const tooWide = (active.info?.width ?? 0) > DISCORD_PRESET.maxWidth;
		this.#set('output', DISCORD_PRESET.output);
		this.#set('targetSizeMb', DISCORD_PRESET.targetSizeMb);
		if (tooWide && !active.recipe.width && !active.recipe.height) this.#set('width', DISCORD_PRESET.maxWidth);
	}

	#frameSection(entry) {
		const { width, height } = entry.info ?? {};
		const crop = (key) => numberControl(key === 'x' ? 'X' : key === 'y' ? 'Y' : key === 'w' ? 'Largeur' : 'Hauteur',
			{ min: 0, max: key === 'x' || key === 'w' ? width : height, unit: 'px', nullable: true },
			(value) => this.#setCropField(key, value));
		const aspect = segmentedControl('Proportions du cadre', ASPECTS, (value) => this.#setAspect(value));
		this.#bindings.push({ control: aspect, read: () => ASPECTS.find((a) => a.value === (this.#store.cropAspect ?? 0))?.value ?? 0 });
		const clear = h('button', { type: 'button', class: 'btn btn--small', on: { click: () => this.#set('crop', null) } }, icon(ICONS.reset), 'Retirer le recadrage');
		const rotation = h('output', { class: 'rotation__value' });
		this.#bindings.push({ control: { sync: (value) => { rotation.textContent = `${value}°`; } }, read: (recipe) => recipe.rotate });
		const turn = (delta) => () => this.#set('rotate', (this.#store.active.recipe.rotate + delta + FULL_TURN) % FULL_TURN);
		return this.#section('Cadre',
			aspect.element,
			h('div', { class: 'grid-2' }, ['x', 'y', 'w', 'h'].map((key) => this.#bind(crop(key), `crop.${key}`))),
			clear,
			h('div', { class: 'rotation' },
				h('p', { class: 'field__label', text: 'Rotation' }),
				h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Tourner à gauche', on: { click: turn(-QUARTER_TURN) } }, icon(ICONS.rotateLeft)),
				rotation,
				h('button', { type: 'button', class: 'btn btn--icon', 'aria-label': 'Tourner à droite', on: { click: turn(QUARTER_TURN) } }, icon(ICONS.rotateRight))),
			this.#bind(toggleControl('Miroir horizontal', (value) => this.#set('flipH', value)), 'flipH'),
			this.#bind(toggleControl('Miroir vertical', (value) => this.#set('flipV', value)), 'flipV'),
			h('div', { class: 'grid-2' },
				this.#bind(numberControl('Largeur finale', { min: 1, max: MAX_DIMENSION, unit: 'px', nullable: true, placeholder: 'auto' }, (value) => this.#set('width', value)), 'width'),
				this.#bind(numberControl('Hauteur finale', { min: 1, max: MAX_DIMENSION, unit: 'px', nullable: true, placeholder: 'auto' }, (value) => this.#set('height', value)), 'height')),
			h('p', { class: 'field__hint', text: 'Une seule dimension remplie garde les proportions.' }));
	}

	#setCropField(key, value) {
		const active = this.#store.active;
		const { width, height } = active.info;
		const crop = active.recipe.crop ?? { x: 0, y: 0, w: width, h: height };
		if (value === null) return;
		const next = { ...crop, [key]: value };
		next.w = Math.min(next.w, width - next.x);
		next.h = Math.min(next.h, height - next.y);
		this.#set('crop', next);
	}

	/** Choisir des proportions pose aussitôt le plus grand cadre centré qui les respecte. */
	#setAspect(value) {
		const ratio = value || null;
		this.#store.setUi({ cropAspect: ratio });
		const active = this.#store.active;
		if (!ratio || !active?.info?.width) return;
		const { width, height } = active.info;
		const w = Math.min(width, height * ratio);
		const hgt = w / ratio;
		this.#set('crop', { x: Math.round((width - w) / 2), y: Math.round((height - hgt) / 2), w: Math.round(w), h: Math.round(hgt) });
	}

	#timeSection(entry, output) {
		const duration = entry.info.duration;
		const trim = (edge) => numberControl(edge === 'start' ? 'Début' : 'Fin', { min: 0, max: duration, step: TIME_STEP, unit: 's' }, (value) => {
			const current = this.#store.active.recipe.trim ?? { start: 0, end: duration };
			const next = { ...current, [edge]: value };
			if (next.end <= next.start) return;
			this.#set('trim', next.start <= 0 && next.end >= duration ? null : next);
		});
		const children = [
			h('div', { class: 'grid-2' },
				this.#bind(trim('start'), 'trim.start', (recipe) => recipe.trim?.start ?? 0),
				this.#bind(trim('end'), 'trim.end', (recipe) => recipe.trim?.end ?? Number(duration.toFixed(2)))),
		];
		if (output.motion || output.audioOnly) {
			const fade = (path, label) => this.#bind(numberControl(label, { min: 0, max: MAX_FADE_SECONDS, step: 0.1, unit: 's' }, (value) => this.#set(path, value)), path);
			children.push(h('div', { class: 'grid-2' }, fade('fadeIn', 'Fondu d’entrée'), fade('fadeOut', 'Fondu de sortie')));
		}
		if (output.still) {
			children.push(this.#bind(numberControl('Image exportée à', { min: 0, max: duration, step: TIME_STEP, unit: 's', hint: 'Ou place la tête de lecture sur la timeline.' }, (value) => this.#set('frameTime', value)), 'frameTime'));
		}
		return this.#section('Temps', children);
	}

	#motionSection(entry, output) {
		const visual = entry.item.kind !== KIND.AUDIO;
		const visualMotion = output.motion && visual;
		const children = [
			this.#bind(selectControl('Vitesse', [{ options: SPEEDS.map((s) => ({ value: String(s), label: s === 1 ? 'Normale' : `× ${s}` })) }], (value) => this.#set('speed', Number(value))), 'speed', (r) => String(r.speed)),
			this.#bind(toggleControl('Lire à l’envers', (value) => this.#set('reverse', value)), 'reverse'),
		];
		if (visualMotion) children.push(this.#bind(toggleControl('Boomerang', (value) => this.#set('boomerang', value), 'Aller puis retour, sans le son.'), 'boomerang'));
		if (visualMotion || output.sequence || output.sprite) {
			const hint = output.sequence ? 'Vide : toutes les images de la source.' : null;
			children.push(this.#bind(numberControl('Images par seconde', { min: 0.1, max: MAX_FPS, step: 0.1, nullable: true, placeholder: 'auto', hint }, (value) => this.#set('fps', value)), 'fps'));
		}
		return this.#section('Mouvement', children);
	}

	#colorSection() {
		const slider = (label, path, options) => this.#bind(sliderControl(label, options, (value) => this.#set(path, value)), path);
		return this.#section('Couleur',
			slider('Luminosité', 'adjust.brightness', { min: -0.5, max: 0.5, step: 0.01, neutral: 0, format: (v) => signed(v) }),
			slider('Contraste', 'adjust.contrast', { min: 0.5, max: 2, step: 0.01, neutral: 1, format: factor }),
			slider('Saturation', 'adjust.saturation', { min: 0, max: 3, step: 0.01, neutral: 1, format: factor }),
			slider('Gamma', 'adjust.gamma', { min: 0.5, max: 2, step: 0.01, neutral: 1, format: factor }),
			slider('Teinte', 'adjust.hue', { min: -180, max: 180, step: 1, neutral: 0, format: (v) => `${signed(v, 0)}°` }),
			this.#bind(selectControl('Filtre', [{ options: FILTERS.map((f) => ({ value: f.id, label: f.label })) }], (value) => this.#set('filter', value)), 'filter'));
	}

	#textSection() {
		return this.#section('Texte',
			this.#bind(textareaControl('Texte incrusté', 'Aucun texte', (value) => this.#set('text.content', value)), 'text.content'),
			this.#bind(sliderControl('Taille', { min: 2, max: 25, step: 0.5, neutral: 8, format: (v) => `${v} % de la hauteur` }, (value) => this.#set('text.size', value)), 'text.size'),
			h('div', { class: 'grid-2' },
				this.#bind(colorControl('Couleur', (value) => this.#set('text.color', value)), 'text.color'),
				this.#bind(selectControl('Position', [{ options: TEXT_POSITIONS.map((p) => ({ value: p.id, label: p.label })) }], (value) => this.#set('text.position', value)), 'text.position')));
	}

	#audioSection(kind, output) {
		const children = [];
		if (kind === KIND.VIDEO && !output.audioOnly) children.push(this.#bind(toggleControl('Couper le son', (value) => this.#set('mute', value)), 'mute'));
		children.push(this.#bind(toggleControl('Égaliser le volume', (value) => this.#set('normalize', value), 'Norme EBU R128 à -16 LUFS, comme les plateformes de streaming.'), 'normalize'));
		children.push(this.#bind(sliderControl('Volume', { min: 0, max: 2, step: 0.05, neutral: 1, format: (v) => `${Math.round(v * PERCENT)} %` }, (value) => this.#set('volume', value)), 'volume'));
		return this.#section('Audio', children);
	}

	#subtitleSection(entry) {
		const panel = modelPanel(this.#models, entry.recipe.subModel);
		this.#disposers.push(panel.dispose);
		const model = segmentedControl('Modèle', SUB_MODELS.map((m) => ({ value: m.id, label: m.label })), (value) => {
			this.#set('subModel', value);
			this.#builtFor = null;
			this.#onChange({ reason: 'analyzed' });
		});
		const detail = SUB_MODELS.find((m) => m.id === entry.recipe.subModel)?.detail ?? '';
		return this.#section('Sous-titres',
			this.#bind(selectControl('Langue parlée', [{ options: SUB_LANGUAGES.map((l) => ({ value: l.id, label: l.label })) }], (value) => this.#set('subLanguage', value)), 'subLanguage'),
			this.#bind(model, 'subModel'),
			h('p', { class: 'field__hint', text: detail }),
			panel.element);
	}

	#upscaleSection() {
		const panel = modelPanel(this.#models, 'upscale');
		this.#disposers.push(panel.dispose);
		return this.#section('Agrandissement',
			this.#bind(segmentedControl('Type d’image', UPSCALE_STYLES.map((s) => ({ value: s.id, label: s.label })), (value) => this.#set('upscaleModel', value)), 'upscaleModel'),
			h('p', { class: 'field__hint', text: 'Les retouches (cadre, couleur, texte) sont appliquées avant l’agrandissement. Une largeur finale remplace le facteur.' }),
			panel.element);
	}

	#mattingSection() {
		const panel = modelPanel(this.#models, 'matting');
		this.#disposers.push(panel.dispose);
		return this.#section('Détourage',
			h('p', { class: 'field__hint', text: 'Garde le sujet principal et rend le fond transparent. Les retouches et le recadrage sont appliqués avant.' }),
			panel.element);
	}

	#stemsSection() {
		const panel = modelPanel(this.#models, 'stems');
		this.#disposers.push(panel.dispose);
		return this.#section('Séparation',
			h('p', { class: 'field__hint', text: 'Produit deux fichiers : « - voix » et « - musique ». La découpe dans le temps est respectée.' }),
			panel.element);
	}

	#pagesSection(entry) {
		if (entry.recipe.output === 'pdf-edit') return this.#pdfEditSection();
		const pages = textareaControl('Pages', 'Toutes (ex. 1-3, 5, 8-)', (value) => this.#set('pages', value));
		const children = [this.#bind(pages, 'pages')];
		if (['pdf-png', 'pdf-jpg'].includes(entry.recipe.output)) {
			children.push(this.#bind(segmentedControl('Résolution', DPIS.map((d) => ({ value: d, label: `${d} dpi` })), (value) => this.#set('dpi', value)), 'dpi'));
		}
		return this.#section('Pages', children);
	}

	#pdfEditSection() {
		const reset = h('button', { type: 'button', class: 'btn btn--small', on: { click: () => this.#set('pageOrder', null) } }, icon(ICONS.reset), 'Rétablir toutes les pages');
		return this.#section('Pages',
			h('p', { class: 'field__hint', text: 'Glisse les pages pour les réordonner, ou utilise les flèches sous chaque page.' }),
			reset,
			this.#bind(textareaControl('Filigrane', 'Aucun (ex. CONFIDENTIEL)', (value) => this.#set('watermark.text', value)), 'watermark.text'),
			this.#bind(sliderControl('Opacité du filigrane', { min: 0.05, max: 0.6, step: 0.01, neutral: 0.18, format: (v) => `${Math.round(v * PERCENT)} %` }, (value) => this.#set('watermark.opacity', value)), 'watermark.opacity'),
			this.#bind(sliderControl('Taille du filigrane', { min: 4, max: 30, step: 1, neutral: 12, format: (v) => `${v} %` }, (value) => this.#set('watermark.size', value)), 'watermark.size'),
			this.#bind(toggleControl('Numéroter les pages', (value) => this.#set('pageNumbers', value), '« 3 / 12 » en bas de chaque page.'), 'pageNumbers'));
	}

	#renderFooter(entry) {
		if (!this.#footer) return;
		const busy = entry.status === STATUS.RUNNING || entry.status === STATUS.QUEUED;
		const convert = h('button', { type: 'button', class: 'btn btn--primary btn--block', disabled: busy || entry.status === STATUS.ANALYZING },
			busy ? 'Conversion en cours…' : entry.status === STATUS.DONE ? 'Reconvertir ce fichier' : 'Convertir ce fichier');
		convert.addEventListener('click', () => this.#runner.enqueue([entry.id]));
		const reset = h('button', { type: 'button', class: 'btn btn--ghost btn--small', on: { click: () => this.#store.resetRecipe(entry.id) } }, icon(ICONS.reset), 'Tout remettre à zéro');
		const result = [];
		if (entry.status === STATUS.ERROR && entry.error) result.push(h('p', { class: 'notice notice--error', role: 'alert' }, icon(ICONS.alert), entry.error));
		if (entry.status === STATUS.DONE) {
			for (const path of entry.outputs.slice(0, 3)) {
				result.push(h('button', { type: 'button', class: 'notice notice--ok', on: { click: () => window.alambic.reveal(path) } },
					icon(ICONS.check), h('span', { class: 'notice__path', text: path.split(/[\\/]/).pop() }), h('span', { class: 'notice__action', text: 'Afficher' })));
			}
			if (entry.outputs.length > 3) result.push(h('p', { class: 'field__hint', text: `et ${entry.outputs.length - 3} autres fichiers` }));
		}
		this.#footer.replaceChildren(...result, convert, reset);
	}
}
