import smoke from './smoke.mjs';
import { outputDir } from './samples.mjs';

const OUT = outputDir();
export default async function (ctx) {
	const { app, page } = ctx;
	await smoke(ctx);
	await app.evaluate(({ dialog }, out) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [out] }); }, OUT);
	await page.click('input[name="output-target"][value="folder"]');
	await page.waitForTimeout(300);
	const t0 = Date.now();
	await page.click('#convert-all');
	while (Date.now() - t0 < 240_000) {
		const states = await page.$$eval('.row__state', (els) => els.map((e) => e.textContent));
		if (states.every((s) => s === 'Terminé' || s === 'Erreur')) break;
		await page.waitForTimeout(500);
	}
	console.log('elapsed', Date.now() - t0, 'ms');
	console.log((await page.$$eval('.row', (els) => els.map((e) => `${e.querySelector('.row__name').textContent} -> ${e.querySelector('.row__state').textContent}`))).join('\n'));
	console.log('dock:', await page.textContent('#dock-summary'));
	for (const row of await page.$$('.row--status-error')) {
		await row.click();
		await page.waitForTimeout(200);
		console.log('ERR', await row.$eval('.row__name', (e) => e.textContent), await page.$eval('.notice--error', (e) => e.textContent).catch(() => '?'));
	}
}
