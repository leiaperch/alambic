import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJob, outputDuration, outputHeight, spriteLayout } from '../electron/recipe.js';
import { emptyRecipe } from '../shared/formats.js';

const video = { path: 'in.mp4', kind: 'video', width: 1280, height: 720, duration: 6, hasAudio: true, fps: 30 };
const recipe = (patch) => ({ ...emptyRecipe(patch.output), ...patch });

test('la découpe lit l’entrée : -t précède -i', () => {
	const { args } = buildJob({ source: video, recipe: recipe({ output: 'mp4', trim: { start: 1, end: 4 } }), outputPath: 'o.mp4' });
	assert.ok(args.indexOf('-t') < args.indexOf('-i'));
	assert.deepEqual(args.slice(0, 4), ['-ss', '1', '-t', '3']);
});

test('durée de sortie : vitesse et boomerang', () => {
	assert.equal(outputDuration(video, recipe({ output: 'mp4', speed: 2 })), 3);
	assert.equal(outputDuration(video, recipe({ output: 'gif', trim: { start: 0, end: 2 }, boomerang: true })), 4);
});

test('hauteur finale : recadrage, quart de tour, largeur imposée', () => {
	assert.equal(outputHeight(video, recipe({ output: 'mp4', crop: { x: 0, y: 0, w: 400, h: 200 }, rotate: 90 })), 400);
	assert.equal(outputHeight(video, recipe({ output: 'mp4', width: 640 })), 360);
});

test('accélération matérielle seulement si demandée et détectée', () => {
	const hardware = { h264: 'h264_qsv' };
	const on = buildJob({ source: video, recipe: recipe({ output: 'mp4', gpu: true }), outputPath: 'o.mp4', hardware }).args;
	const off = buildJob({ source: video, recipe: recipe({ output: 'mp4', gpu: true }), outputPath: 'o.mp4', hardware: {} }).args;
	assert.ok(on.includes('h264_qsv'));
	assert.ok(off.includes('libx264'));
});

test('le texte est lu depuis un fichier, sans expansion des %', () => {
	const { args } = buildJob({ source: video, recipe: recipe({ output: 'png', text: { content: '100%', size: 8, color: '#ffffff', position: 'bottom' } }), outputPath: 'o.png' });
	const graph = args[args.indexOf('-vf') + 1];
	assert.match(graph, /textfile=text\.txt:expansion=none/);
	assert.doesNotMatch(graph, /100%/);
});

test('ICO en RGBA, GIF avec palette', () => {
	assert.ok(buildJob({ source: video, recipe: recipe({ output: 'ico' }), outputPath: 'o.ico' }).args.includes('rgba'));
	const gif = buildJob({ source: video, recipe: recipe({ output: 'gif' }), outputPath: 'o.gif' }).args;
	assert.match(gif[gif.indexOf('-filter_complex') + 1], /palettegen.*paletteuse/);
});

test('métadonnées : options placées avant le fichier de sortie', () => {
	const { args } = buildJob({ source: video, recipe: recipe({ output: 'mp4', stripMetadata: true }), outputPath: 'o.mp4' });
	assert.equal(args.at(-1), 'o.mp4');
	assert.deepEqual(args.slice(args.indexOf('-map_metadata'), args.indexOf('-map_metadata') + 2), ['-map_metadata', '-1']);
});

test('fondus calés sur la durée de sortie, normalisation suivie d’un rééchantillonnage', () => {
	const { args } = buildJob({ source: video, recipe: recipe({ output: 'mp3', speed: 2, fadeOut: 1, normalize: true }), outputPath: 'o.mp3' });
	const chain = args[args.indexOf('-af') + 1];
	assert.match(chain, /afade=t=out:st=2\.000:d=1/);
	assert.match(chain, /loudnorm=.*,aresample=48000$/);
});

test('planche de sprites presque carrée et bornée', () => {
	assert.deepEqual(spriteLayout(3, 8), { columns: 5, rows: 5, count: 24 });
	assert.deepEqual(spriteLayout(2, 10, 4), { columns: 4, rows: 5, count: 20 });
	assert.equal(spriteLayout(1000, 30).count, 400);
});
