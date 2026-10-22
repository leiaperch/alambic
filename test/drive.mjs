// Pilote l'app Electron construite : node test/drive.mjs <script.mjs>
import { _electron as electron } from 'playwright-core';
import { pathToFileURL } from 'node:url';
const app = await electron.launch(process.env.ALAMBIC_EXE ? { executablePath: process.env.ALAMBIC_EXE } : { args: ['.'], cwd: process.cwd() });
app.process().stderr.on('data', (d) => process.stderr.write('[main] ' + d));
app.process().stdout.on('data', (d) => process.stdout.write('[main] ' + d));
const page = await app.firstWindow();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.waitForLoadState('domcontentloaded');
try {
	const script = await import(pathToFileURL(process.argv[2]).href);
	await script.default({ app, page, logs });
} catch (error) {
	console.log('SCRIPT ERROR', error.message);
} finally {
	console.log('--- console ---\n' + logs.slice(-30).join('\n'));
	await app.close();
}
