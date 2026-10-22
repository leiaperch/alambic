import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUrl, buildDownloadArgs } from '../electron/ytdlp.js';

test('seuls les liens http(s) passent', () => {
	assert.equal(validateUrl('  https://youtu.be/aqz-KE-bpKQ '), 'https://youtu.be/aqz-KE-bpKQ');
	assert.throws(() => validateUrl('file:///C:/Windows/win.ini'), /http/);
	assert.throws(() => validateUrl('--exec calc'), /lien/);
	assert.throws(() => validateUrl(''), /vide/);
});

test('l’URL arrive après --, jamais lue comme une option', () => {
	const args = buildDownloadArgs('https://example.com/v', 'mp3', { directory: 'D', ffmpegDir: null });
	assert.deepEqual(args.slice(-2), ['--', 'https://example.com/v']);
	assert.ok(args.includes('--progress'));
});

test('MP4 privilégie H.264 + AAC', () => {
	const args = buildDownloadArgs('https://example.com/v', 'mp4', { directory: 'D', ffmpegDir: 'F' });
	assert.match(args[args.indexOf('-f') + 1], /^bv\*\[vcodec\^=avc1\]\+ba\[acodec\^=mp4a\]/);
	assert.throws(() => buildDownloadArgs('https://example.com/v', 'flv', { directory: 'D' }), /inconnu/);
});
