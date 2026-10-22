/**
 * Récupère ffmpeg (build « full shared » de Gyan, GPLv3) et yt-dlp dans vendor/ avant `npm run dist`.
 * Les empreintes sont figées ici ; yt-dlp est vérifié contre le SHA2-256SUMS de sa publication.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor');
const FFMPEG = Object.freeze({
	version: '8.1.2',
	url: 'https://github.com/GyanD/codexffmpeg/releases/download/8.1.2/ffmpeg-8.1.2-full_build-shared.zip',
	sha256: '274923c68904a9b76c73b908f57923dafba81155856cd742138515ded570d066',
});
const YTDLP = Object.freeze({ version: '2026.10.21', base: 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.21' });
const SKIPPED = new Set(['ffplay.exe']);

async function fetchBytes(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url} : HTTP ${response.status}`);
	return Buffer.from(await response.arrayBuffer());
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fetchFfmpeg() {
	const zip = await fetchBytes(FFMPEG.url);
	const digest = sha256(zip);
	if (FFMPEG.sha256 && digest !== FFMPEG.sha256) throw new Error(`Empreinte ffmpeg inattendue : ${digest}`);
	const temp = join(VENDOR, 'ffmpeg-download');
	await rm(temp, { recursive: true, force: true });
	await mkdir(temp, { recursive: true });
	await writeFile(join(temp, 'ffmpeg.zip'), zip);
	execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
		'Expand-Archive -LiteralPath $env:ZIP -DestinationPath $env:DEST -Force'], { env: { ...process.env, ZIP: join(temp, 'ffmpeg.zip'), DEST: temp } });
	const [folder] = (await readdir(temp, { withFileTypes: true })).filter((entry) => entry.isDirectory());
	const bin = join(VENDOR, 'bin');
	for (const file of await readdir(join(temp, folder.name, 'bin'))) {
		if (!SKIPPED.has(file)) await cp(join(temp, folder.name, 'bin', file), join(bin, file));
	}
	await cp(join(temp, folder.name, 'LICENSE'), join(VENDOR, 'licenses', 'ffmpeg-LICENSE.txt'));
	await rm(temp, { recursive: true, force: true });
	return digest;
}

async function fetchYtdlp() {
	const sums = (await fetchBytes(`${YTDLP.base}/SHA2-256SUMS`)).toString('utf8');
	const expected = sums.split('\n').find((line) => line.trim().endsWith(' yt-dlp.exe'))?.split(/\s+/)[0];
	const exe = await fetchBytes(`${YTDLP.base}/yt-dlp.exe`);
	if (!expected || sha256(exe) !== expected) throw new Error('Empreinte yt-dlp différente du SHA2-256SUMS publié');
	await writeFile(join(VENDOR, 'bin', 'yt-dlp.exe'), exe);
	await writeFile(join(VENDOR, 'licenses', 'yt-dlp-LICENSE.txt'), await fetchBytes('https://raw.githubusercontent.com/yt-dlp/yt-dlp/master/LICENSE'));
}

await rm(join(VENDOR, 'bin'), { recursive: true, force: true });
await mkdir(join(VENDOR, 'bin'), { recursive: true });
await mkdir(join(VENDOR, 'licenses'), { recursive: true });
const digest = await fetchFfmpeg();
await fetchYtdlp();
await writeFile(join(VENDOR, 'VERSIONS.txt'), `ffmpeg ${FFMPEG.version} (Gyan full_build-shared, sha256 ${digest})\nyt-dlp ${YTDLP.version}\n`);
console.log((await readFile(join(VENDOR, 'VERSIONS.txt'), 'utf8')).trim());
