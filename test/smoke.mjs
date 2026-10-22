import { samplesDir } from './samples.mjs';

const IN = samplesDir();
const FILES = ['clip.mp4', 'son.mp3', 'photo.png', 'sword-1.webp', 'anim.gif', 'logo.svg', 'vieux.avi', 'cahier.pdf', 'doc.docx'].map((f) => `${IN}/${f}`);
export default async function ({ app, page }) {
	await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, FILES);
	await page.click('#add-files-empty');
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		const states = await page.$$eval('.row__state', (els) => els.map((e) => e.textContent));
		if (states.length === FILES.length && states.every((s) => s !== 'Lecture…' && !s.endsWith('%'))) break;
		await page.waitForTimeout(500);
	}
	const rows = await page.$$eval('.row', (els) => els.map((e) => `${e.querySelector('.row__name').textContent} | ${e.querySelector('.row__meta').textContent} | ${e.querySelector('.row__state').textContent} | thumb:${Boolean(e.querySelector('.row__thumb img'))}`));
	console.log(rows.join('\n'));
	console.log('engine:', await page.textContent('#engine-status'));
	await errors(page);
}
export async function errors(page) {
	for (const row of await page.$$('.row--status-error')) {
		await row.click();
		await page.waitForTimeout(300);
		const name = await row.$eval('.row__name', (e) => e.textContent);
		console.log('ERR', name, '=>', await page.$eval('.notice--error', (e) => e.textContent).catch(() => '?'));
	}
}
