import { samplesDir, outputDir } from './samples.mjs';

const IN = samplesDir();
const OUT = outputDir();
const SHOTS = OUT;
export default async function ({ app, page }) {
	await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }); }, [`${IN}/clip.mp4`, `${IN}/sword-1.webp`, `${IN}/son.mp3`, `${IN}/cahier.pdf`]);
	await page.click('#add-files-empty');
	await page.waitForFunction(() => [...document.querySelectorAll('.row__state')].length === 4 && [...document.querySelectorAll('.row__state')].every((e) => e.textContent === 'Prêt'), null, { timeout: 60000 });
	await page.click('.row >> nth=0');
	await page.waitForSelector('.timeline');
	const label = async (text) => page.locator('.inspector .field', { hasText: text }).first();
	await page.locator('.segmented__option', { hasText: '1:1' }).click();
	await page.getByRole('button', { name: 'Tourner à droite' }).click();
	await page.locator('summary', { hasText: 'Mouvement' }).click();
	await page.getByLabel('Vitesse').selectOption('2');
	await page.locator('summary', { hasText: 'Texte' }).click();
	await page.getByLabel('Texte incrusté').fill('Alambic 100% test');
	await page.locator('summary', { hasText: 'Couleur' }).click();
	await page.getByLabel('Filtre').selectOption('warm');
	await page.getByLabel('Début', { exact: true }).fill('1');
	await page.getByLabel('Début', { exact: true }).press('Tab');
	await page.getByLabel('Fin', { exact: true }).fill('5');
	await page.getByLabel('Fin', { exact: true }).press('Tab');
	await page.getByRole('tab', { name: 'Source' }).click();
	await page.waitForTimeout(800);
	await page.screenshot({ path: `${SHOTS}/shot-source.png` });
	await page.getByRole('tab', { name: 'Rendu' }).click();
	await page.waitForTimeout(1500);
	await page.screenshot({ path: `${SHOTS}/shot-render.png` });
	console.log('render img:', await page.$eval('.stage__render', (e) => `${e.naturalWidth}x${e.naturalHeight} ${e.alt}`));
	await app.evaluate(({ dialog }, out) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [out] }); }, OUT);
	await page.click('input[name="output-target"][value="folder"]');
	await page.waitForTimeout(300);
	await page.getByRole('button', { name: /Convertir ce fichier/ }).click();
	await page.waitForFunction(() => /Terminé|Erreur/.test(document.querySelector('.row__state').textContent), null, { timeout: 120000 });
	console.log('state:', await page.textContent('.row__state'), await page.$eval('.inspector__footer', (e) => e.textContent));
}
