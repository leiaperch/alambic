import '@fontsource-variable/recursive/full.css';
import './styles.css';
import { Store, STATUS } from './store.js';
import { Runner } from './jobs.js';
import { Queue } from './ui/queue.js';
import { Stage } from './ui/stage.js';
import { Inspector } from './ui/inspector.js';
import { LinkBar } from './ui/links.js';
import { icon, ICONS } from './dom.js';

const store = new Store();
const runner = new Runner(store);
const queue = new Queue(store, runner);
new Stage(store);
new Inspector(store, runner);
const links = new LinkBar(store, runner);

const banner = document.getElementById('banner');
const engine = document.getElementById('engine-status');
const convertAll = document.getElementById('convert-all');
const summary = document.getElementById('dock-summary');
const veil = document.getElementById('dropveil');
const folderName = document.getElementById('output-folder-name');

async function addFromPicker() {
	const items = await window.alambic.pickFiles();
	if (items.length) runner.ingest(items);
}

function describeEngine(status) {
	const parts = [status.ffmpeg ? 'ffmpeg prêt' : 'ffmpeg absent'];
	const hardware = Object.values(status.hardware ?? {});
	if (hardware.length) parts.push(`accélération ${hardware[0].split('_').pop().toUpperCase()}`);
	parts.push(status.word ? 'Word prêt' : 'Word absent');
	parts.push(status.ytdlp ? 'yt-dlp prêt' : 'yt-dlp absent');
	return parts.join(' · ');
}

/** Récapitulatif du bas et état du bouton principal. */
function renderDock() {
	const entries = store.entries;
	const count = (status) => entries.filter((entry) => entry.status === status).length;
	const pending = count(STATUS.READY) + count(STATUS.ERROR);
	const running = count(STATUS.RUNNING) + count(STATUS.QUEUED);
	const done = count(STATUS.DONE);
	convertAll.disabled = pending === 0;
	convertAll.textContent = pending ? `Tout convertir (${pending})` : 'Tout convertir';
	const parts = [];
	if (running) parts.push(`${running} en cours`);
	if (done) parts.push(`${done} terminé${done > 1 ? 's' : ''}`);
	if (count(STATUS.ERROR)) parts.push(`${count(STATUS.ERROR)} en erreur`);
	summary.textContent = parts.join(' · ');
}

function bindDrop() {
	let depth = 0;
	window.addEventListener('dragenter', (event) => {
		if (!event.dataTransfer?.types.includes('Files')) return;
		depth++;
		veil.hidden = false;
	});
	window.addEventListener('dragleave', () => {
		depth = Math.max(0, depth - 1);
		if (depth === 0) veil.hidden = true;
	});
	window.addEventListener('dragover', (event) => event.preventDefault());
	window.addEventListener('drop', async (event) => {
		event.preventDefault();
		depth = 0;
		veil.hidden = true;
		const items = await window.alambic.addFiles([...event.dataTransfer.files]);
		if (items.length) runner.ingest(items);
		else banner.textContent = 'Aucun fichier pris en charge dans ce dépôt.';
		banner.hidden = items.length > 0;
	});
}

function bindOutputTarget() {
	for (const radio of document.querySelectorAll('input[name="output-target"]')) {
		radio.addEventListener('change', async () => {
			if (radio.value === 'beside') {
				store.outputDir = null;
				folderName.textContent = 'Dans un dossier…';
				return;
			}
			const folder = await window.alambic.pickFolder();
			if (folder) {
				store.outputDir = folder;
				folderName.textContent = folder.split(/[\\/]/).pop() || folder;
				folderName.title = folder;
			} else if (!store.outputDir) {
				document.querySelector('input[name="output-target"][value="beside"]').checked = true;
			}
		});
	}
}

async function start() {
	const addButton = document.getElementById('add-files');
	addButton.append(icon(ICONS.add));
	addButton.addEventListener('click', addFromPicker);
	document.getElementById('add-files-empty').addEventListener('click', addFromPicker);
	convertAll.addEventListener('click', () => runner.enqueue(store.entries.map((entry) => entry.id)));
	store.addEventListener('change', renderDock);
	bindDrop();
	bindOutputTarget();
	store.status = await window.alambic.status();
	engine.textContent = describeEngine(store.status);
	if (!store.status.ffmpeg) {
		banner.hidden = false;
		banner.textContent = 'ffmpeg est introuvable. Installe-le avec « winget install Gyan.FFmpeg » puis relance Alambic.';
	}
	if (!store.status.ytdlp) links.disable('yt-dlp est introuvable : installe-le avec « winget install yt-dlp.yt-dlp » puis relance Alambic.');
	queue.render();
	store.dispatchEvent(new CustomEvent('change', { detail: { reason: 'init' } }));
}

start();
