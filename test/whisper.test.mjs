import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidySrt, srtToText, filterPath, buildWhisperArgs } from '../electron/whisper.js';

const RAW = `0
00:00:06,500 --> 00:00:13,500
Deuxième phrase.

1
00:00:00,000 --> 00:00:02,000
Première phrase.

2
00:00:12,900 --> 00:00:14,900
Fin.
`;

test('renumérote à partir de 1, trie et coupe les chevauchements', () => {
	const srt = tidySrt(RAW);
	assert.match(srt, /^1\n00:00:00,000 --> 00:00:02,000\nPremière phrase\./);
	assert.match(srt, /2\n00:00:06,500 --> 00:00:12,900\nDeuxième phrase\./);
	assert.equal(srtToText(srt), 'Première phrase.\nDeuxième phrase.\nFin.');
});

test('chemin de modèle relatif, sans lettre de lecteur', () => {
	assert.equal(filterPath(String.raw`C:\data\models\m.bin`, String.raw`C:\tmp\work`), '../../data/models/m.bin');
	assert.throws(() => filterPath(String.raw`D:\models\m.bin`, String.raw`C:\tmp`), /même disque/);
});

test('langue hors liste ramenée à la détection automatique', () => {
	const args = buildWhisperArgs({ input: 'in.mp4', trim: null, language: 'xx:evil', modelPath: 'm.bin', vadPath: 'v.bin', destination: 'o.srt' });
	assert.match(args[args.indexOf('-af') + 1], /language=auto:/);
});
