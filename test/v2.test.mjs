import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildJob, joinChain, buildNoiseFloorArgs, parseNoiseFloor } from '../electron/recipe.js';
import { Logos, Presets } from '../electron/presets.js';
import { emptyRecipe } from '../shared/formats.js';

const video = { path: 'in.mp4', kind: 'video', width: 1280, height: 720, duration: 6, hasAudio: true, fps: 30 };
const recipe = (patch) => ({ ...emptyRecipe(patch.output), ...patch });
const graphOf = (args) => args[args.indexOf('-filter_complex') + 1];

test('joinChain colle les fragments libellés sans virgule', () => {
	assert.equal(joinChain([]), 'null');
	assert.equal(joinChain(['a', 'b']), 'a,b');
	assert.equal(joinChain(['a', '[x];[1:v]b[y];[x][y]overlay', 'c']), 'a[x];[1:v]b[y];[x][y]overlay,c');
	assert.equal(joinChain(['[x];[1:v]b[y];[x][y]overlay']), 'null[x];[1:v]b[y];[x][y]overlay');
});

test('logo : seconde entrée bouclée, taille relative à la largeur finale', () => {
	const { args } = buildJob({ source: { ...video, logoPath: 'C:/l.png' }, recipe: recipe({ output: 'mp4', width: 640, logo: { id: 'a', position: 'br', size: 10, opacity: 0.5 } }), outputPath: 'o.mp4' });
	assert.deepEqual(args.slice(args.indexOf('-loop'), args.indexOf('-loop') + 4), ['-loop', '1', '-i', 'C:/l.png']);
	assert.match(graphOf(args), /\[1:v\]scale=64:-1,format=rgba,colorchannelmixer=aa=0\.5/);
});

test('logo ignoré sans fichier résolu par le processus principal', () => {
	const { args } = buildJob({ source: video, recipe: recipe({ output: 'png', logo: { id: 'a', position: 'br', size: 10, opacity: 1 } }), outputPath: 'o.png' });
	assert.ok(!args.includes('-loop'));
});

test('zone floutée : rayon borné par la moitié du plus petit côté', () => {
	const { args } = buildJob({ source: video, recipe: recipe({ output: 'png', blurZones: [{ x: 10, y: 20, w: 30, h: 12 }], blurStrength: 40 }), outputPath: 'o.png' });
	assert.match(graphOf(args), /crop=30:12:10:20,boxblur=5:2/);
});

test('stabilisation et ralenti fluide placés aux bons endroits', () => {
	const { args } = buildJob({ source: video, recipe: recipe({ output: 'mp4', stabilizeFile: 'stab.trf', speed: 0.5, smoothMotion: true }), outputPath: 'o.mp4' });
	const graph = graphOf(args);
	assert.match(graph, /^\[0:v\]vidstabtransform=input=stab\.trf/);
	assert.match(graph, /setpts=PTS\/0\.5,minterpolate=fps=30/);
});

test('débruitage calé sur le plancher mesuré', () => {
	assert.equal(parseNoiseFloor('[Parsed_astats_1] Noise floor dB: -28.370533'), -28.370533);
	const { args } = buildJob({ source: video, recipe: recipe({ output: 'mp3', denoise: 'strong', noiseFloor: -28.37 }), outputPath: 'o.mp3' });
	assert.match(args[args.indexOf('-af') + 1], /^highpass=f=80,afftdn=nr=24:nf=-25\.4/);
	assert.ok(buildNoiseFloorArgs(video, recipe({ output: 'mp3' })).includes('-vn'));
});

test('préréglages : champs propres au fichier exclus, logo retrouvé par son chemin', async () => {
	const logos = new Logos();
	const presets = new Presets(join(mkdtempSync(join(tmpdir(), 'alambic-')), 'presets.json'), logos);
	const logo = logos.register(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
	const list = await presets.save('GIF Discord', recipe({ output: 'gif', crop: { x: 1, y: 1, w: 9, h: 9 }, blurZones: [{ x: 0, y: 0, w: 9, h: 9 }], width: 480, logo: { ...emptyRecipe('gif').logo, ...logo } }));
	assert.equal(list.length, 1);
	assert.equal(list[0].recipe.width, 480);
	assert.equal(list[0].recipe.crop, undefined);
	assert.equal(list[0].recipe.blurZones, undefined);
	assert.equal(list[0].recipe.logo.id, logo.id);
	await assert.rejects(presets.save('  ', recipe({ output: 'gif' })), /nom/);
	assert.equal((await presets.remove('GIF Discord')).length, 0);
});
