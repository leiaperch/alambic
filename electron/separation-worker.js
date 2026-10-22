import { parentPort, workerData } from 'node:worker_threads';
import { readFile, writeFile } from 'node:fs/promises';
import { separate, MDX } from './separation.js';

const CHANNELS = 2;
const BATCH = 1;
const SPEC_CHANNELS = 4;
const CANCELLED = 'Annulé';

/** Échantillons float32 entrelacés (sortie f32le de ffmpeg) → [gauche, droite]. */
function deinterleave(buffer) {
	const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
	const frames = samples.length / CHANNELS;
	const left = new Float32Array(frames);
	const right = new Float32Array(frames);
	for (let i = 0; i < frames; i++) {
		left[i] = samples[i * CHANNELS];
		right[i] = samples[i * CHANNELS + 1];
	}
	return [left, right];
}

function interleave([left, right]) {
	const out = new Float32Array(left.length * CHANNELS);
	for (let i = 0; i < left.length; i++) {
		out[i * CHANNELS] = left[i];
		out[i * CHANNELS + 1] = right[i];
	}
	return Buffer.from(out.buffer);
}

/** Calcul lourd hors du processus principal : l'interface reste fluide pendant les minutes de séparation. */
async function main() {
	const { modelPath, input, instrumental, vocals, stop } = workerData;
	const stopFlag = new Int32Array(stop);
	const ort = await import('onnxruntime-node');
	const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });
	const shape = [BATCH, SPEC_CHANNELS, MDX.dimF, MDX.dimT];
	const infer = async (spec) => {
		if (Atomics.load(stopFlag, 0) === 1) throw new Error(CANCELLED);
		const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', spec, shape) });
		return result[session.outputNames[0]].data;
	};
	const mix = deinterleave(await readFile(input));
	const { primary, secondary } = await separate(mix, infer, (ratio) => parentPort.postMessage({ progress: ratio }));
	await writeFile(instrumental, interleave(primary));
	await writeFile(vocals, interleave(secondary));
	parentPort.postMessage({ done: true });
}

main().catch((error) => parentPort.postMessage(error.message === CANCELLED ? { cancelled: true } : { error: error.message }));
