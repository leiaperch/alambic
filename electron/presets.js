import { randomUUID } from 'node:crypto';
import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, basename } from 'node:path';

/** Champs propres à un fichier (coordonnées, durées, pages) ou internes : jamais enregistrés dans un préréglage. */
const EXCLUDED = ['crop', 'trim', 'frameTime', 'pages', 'pageOrder', 'blurZones', 'subtitleFile', 'stabilizeFile', 'noiseFloor'];
const MAX_NAME_LENGTH = 60;
const MAX_PRESETS = 100;

/**
 * Logos choisis par l'utilisateur : l'interface ne manipule qu'un identifiant, le chemin reste dans ce registre.
 * Les préréglages enregistrent le chemin, réenregistré au chargement.
 */
export class Logos {
	#paths = new Map();

	register(path) {
		for (const [id, known] of this.#paths) if (known === path) return { id, name: basename(path) };
		const id = randomUUID();
		this.#paths.set(id, path);
		return { id, name: basename(path) };
	}

	path(id) {
		return id ? this.#paths.get(id) ?? null : null;
	}
}

export class Presets {
	#file;
	#logos;

	constructor(file, logos) {
		this.#file = file;
		this.#logos = logos;
	}

	async #read() {
		try {
			const list = JSON.parse(await readFile(this.#file, 'utf8'));
			return Array.isArray(list) ? list : [];
		} catch {
			return [];
		}
	}

	async #write(list) {
		await mkdir(dirname(this.#file), { recursive: true });
		await writeFile(this.#file, JSON.stringify(list, null, '\t'), 'utf8');
	}

	/** Liste pour l'interface : le chemin du logo est remplacé par un identifiant du registre, s'il existe encore. */
	async list() {
		const list = await this.#read();
		return Promise.all(list.map(async ({ name, recipe, logoPath }) => {
			const copy = structuredClone(recipe);
			if (logoPath && await access(logoPath).then(() => true, () => false)) copy.logo = { ...copy.logo, ...this.#logos.register(logoPath) };
			else if (copy.logo) copy.logo = { ...copy.logo, id: null, name: '' };
			return { name, recipe: copy };
		}));
	}

	async save(name, recipe) {
		const clean = String(name ?? '').trim().slice(0, MAX_NAME_LENGTH);
		if (!clean) throw new Error('Donne un nom au préréglage');
		const stored = structuredClone(recipe);
		for (const field of EXCLUDED) delete stored[field];
		const logoPath = this.#logos.path(stored.logo?.id);
		if (stored.logo) stored.logo = { ...stored.logo, id: null };
		const list = (await this.#read()).filter((preset) => preset.name !== clean);
		if (list.length >= MAX_PRESETS) throw new Error(`Pas plus de ${MAX_PRESETS} préréglages`);
		list.push({ name: clean, recipe: stored, logoPath });
		list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
		await this.#write(list);
		return this.list();
	}

	async remove(name) {
		await this.#write((await this.#read()).filter((preset) => preset.name !== name));
		return this.list();
	}
}
