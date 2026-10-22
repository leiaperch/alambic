import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fft, separate, MDX } from '../electron/separation.js';

test('FFT 6144 = 3 × 2^11 identique à une DFT directe', () => {
	const n = 6144;
	const re = Float64Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + (i % 7) * 0.1);
	const im = new Float64Array(n);
	const input = Float64Array.from(re);
	new Fft(n).transform(re, im);
	for (const k of [0, 1, 5, 1000, 3071, 3072, 6143]) {
		let sr = 0;
		let si = 0;
		for (let t = 0; t < n; t++) {
			sr += input[t] * Math.cos((2 * Math.PI * k * t) / n);
			si -= input[t] * Math.sin((2 * Math.PI * k * t) / n);
		}
		assert.ok(Math.abs(sr - re[k]) < 1e-6 && Math.abs(si - im[k]) < 1e-6, `bin ${k}`);
	}
});

test('modèle identité : STFT puis iSTFT redonne le signal, sur toute sa longueur', async () => {
	const params = { ...MDX, compensate: 1 };
	const samples = 600_000;
	// Bande limitée sous dimF : les bandes coupées par le modèle ne doivent pas fausser la comparaison.
	const tone = (f) => Float32Array.from({ length: samples }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / MDX.sampleRate));
	const left = tone(440);
	const right = tone(1234);
	const { primary, secondary } = await separate([left, right], async (spec) => spec, () => {}, params);
	let worst = 0;
	for (let i = 0; i < samples; i++) worst = Math.max(worst, Math.abs(primary[0][i] - left[i]), Math.abs(primary[1][i] - right[i]));
	assert.ok(worst < 1e-3, `écart max ${worst}`);
	assert.ok(Math.abs(secondary[0][samples - 1]) < 1e-3);
});

test('détourage : normalisation de rembg et masque en sigmoïde min-max', async () => {
	const { toTensorData, toMask } = await import('../electron/matting.js');
	const size = 1024 * 1024;
	const rgb = new Uint8Array(size * 3).fill(100);
	rgb[0] = 200;
	const data = toTensorData(rgb, [0.5, 0.5, 0.5], [1, 1, 1]);
	assert.ok(Math.abs(data[0] - 0.5) < 1e-6, 'max ramené à 1 puis - 0,5');
	assert.ok(Math.abs(data[1] - 0) < 1e-6, '100 / 200 - 0,5');
	assert.deepEqual([...toMask(Float32Array.of(-10, 0, 10))], [0, 128, 255]);
});
