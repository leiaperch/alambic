/**
 * Séparation voix / musique par un modèle MDX-Net (UVR), reproduite d'après audio-separator :
 * STFT de Hann périodique, centrée avec réflexion, morceaux de dim_t trames et marges de n_fft/2 de chaque côté.
 * Aucune dépendance : testable sous Node, exécutée dans un worker par l'application.
 */

/** Réglages publiés par UVR pour « UVR-MDX-NET-Inst_HQ_3 » (empreinte UVR 55657dd7…). */
export const MDX = Object.freeze({
	nFft: 6144,
	hop: 1024,
	dimF: 3072,
	dimT: 256,
	compensate: 1.022,
	sampleRate: 44100,
	primary: 'instrumental',
});

const TWO_PI = 2 * Math.PI;

/** FFT complexe en place pour N = r × 2^k (r impair petit) : r FFT radix-2 entrelacées puis recombinaison directe. */
export class Fft {
	#n;
	#radix;
	#half;
	#cos;
	#sin;
	#bitrev;
	#subRe;
	#subIm;

	constructor(n) {
		let radix = n;
		while (radix % 2 === 0) radix /= 2;
		this.#n = n;
		this.#radix = radix;
		this.#half = n / radix;
		this.#cos = new Float64Array(n);
		this.#sin = new Float64Array(n);
		for (let k = 0; k < n; k++) {
			this.#cos[k] = Math.cos((TWO_PI * k) / n);
			this.#sin[k] = -Math.sin((TWO_PI * k) / n);
		}
		const m = this.#half;
		const bits = Math.log2(m);
		this.#bitrev = new Uint32Array(m);
		for (let i = 0; i < m; i++) {
			let reversed = 0;
			for (let b = 0; b < bits; b++) reversed |= ((i >> b) & 1) << (bits - 1 - b);
			this.#bitrev[i] = reversed;
		}
		this.#subRe = Array.from({ length: radix }, () => new Float64Array(m));
		this.#subIm = Array.from({ length: radix }, () => new Float64Array(m));
	}

	/** Transformée directe ; pour l'inverse, conjuguer avant et après puis diviser par N. */
	transform(re, im) {
		const { n, radix, m } = { n: this.#n, radix: this.#radix, m: this.#half };
		for (let r = 0; r < radix; r++) {
			const sr = this.#subRe[r];
			const si = this.#subIm[r];
			for (let i = 0; i < m; i++) {
				const source = this.#bitrev[i] * radix + r;
				sr[i] = re[source];
				si[i] = im[source];
			}
			this.#radix2(sr, si);
		}
		for (let k = 0; k < n; k++) {
			const km = k % m;
			let accRe = 0;
			let accIm = 0;
			for (let r = 0; r < radix; r++) {
				const twiddle = (r * k) % n;
				const c = this.#cos[twiddle];
				const s = this.#sin[twiddle];
				const xr = this.#subRe[r][km];
				const xi = this.#subIm[r][km];
				accRe += xr * c - xi * s;
				accIm += xr * s + xi * c;
			}
			re[k] = accRe;
			im[k] = accIm;
		}
	}

	/** Radix-2 itératif sur des données déjà permutées ; les facteurs de rotation sont ceux de N, sous-échantillonnés. */
	#radix2(re, im) {
		const m = this.#half;
		const step0 = this.#n / m;
		for (let size = 2; size <= m; size *= 2) {
			const halfSize = size / 2;
			const step = (m / size) * step0;
			for (let start = 0; start < m; start += size) {
				for (let j = 0; j < halfSize; j++) {
					const c = this.#cos[j * step];
					const s = this.#sin[j * step];
					const a = start + j;
					const b = a + halfSize;
					const tr = re[b] * c - im[b] * s;
					const ti = re[b] * s + im[b] * c;
					re[b] = re[a] - tr;
					im[b] = im[a] - ti;
					re[a] += tr;
					im[a] += ti;
				}
			}
		}
	}
}

export function hannPeriodic(n) {
	const window = new Float64Array(n);
	for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((TWO_PI * i) / n);
	return window;
}

/** Réflexion à la torch : x[-1] = x[1], sans répéter le bord. */
function reflect(signal, index) {
	const n = signal.length;
	let i = index;
	if (i < 0) i = -i;
	if (i >= n) i = 2 * (n - 1) - i;
	return signal[i];
}

/**
 * Spectrogramme d'un morceau stéréo au format du modèle : [4, dimF, dimT] = (G.re, G.im, D.re, D.im).
 * `chunk` : [gauche, droite], chacun de hop × (dimT - 1) échantillons.
 */
export function stft(chunk, { nFft, hop, dimF, dimT }, fft, window) {
	const out = new Float32Array(4 * dimF * dimT);
	const re = new Float64Array(nFft);
	const im = new Float64Array(nFft);
	const pad = nFft / 2;
	chunk.forEach((signal, channel) => {
		for (let t = 0; t < dimT; t++) {
			const origin = t * hop - pad;
			for (let i = 0; i < nFft; i++) {
				re[i] = reflect(signal, origin + i) * window[i];
				im[i] = 0;
			}
			fft.transform(re, im);
			const reBase = (channel * 2) * dimF * dimT;
			const imBase = (channel * 2 + 1) * dimF * dimT;
			for (let f = 0; f < dimF; f++) {
				out[reBase + f * dimT + t] = re[f];
				out[imBase + f * dimT + t] = im[f];
			}
		}
	});
	return out;
}

/** Inverse de `stft` : les bandes au-delà de dimF sont nulles ; addition-recouvrement normalisée par Σ fenêtre². */
export function istft(spec, { nFft, hop, dimF, dimT }, fft, window) {
	const length = hop * (dimT - 1);
	const pad = nFft / 2;
	const total = length + nFft;
	const re = new Float64Array(nFft);
	const im = new Float64Array(nFft);
	const norm = new Float64Array(total);
	for (let t = 0; t < dimT; t++) for (let i = 0; i < nFft; i++) norm[t * hop + i] += window[i] * window[i];
	return [0, 1].map((channel) => {
		const acc = new Float64Array(total);
		const reBase = (channel * 2) * dimF * dimT;
		const imBase = (channel * 2 + 1) * dimF * dimT;
		for (let t = 0; t < dimT; t++) {
			re.fill(0);
			im.fill(0);
			for (let f = 0; f < dimF; f++) {
				re[f] = spec[reBase + f * dimT + t];
				im[f] = -spec[imBase + f * dimT + t];
				if (f > 0) {
					re[nFft - f] = spec[reBase + f * dimT + t];
					im[nFft - f] = spec[imBase + f * dimT + t];
				}
			}
			// Spectre conjugué → FFT directe → conjugué / N : FFT inverse ; on ne garde que la partie réelle.
			fft.transform(re, im);
			for (let i = 0; i < nFft; i++) acc[t * hop + i] += (re[i] / nFft) * window[i];
		}
		const signal = new Float32Array(length);
		for (let i = 0; i < length; i++) {
			const weight = norm[i + pad];
			signal[i] = weight > 1e-11 ? acc[i + pad] / weight : 0;
		}
		return signal;
	});
}

/**
 * Sépare un signal stéréo. `infer(spec)` renvoie le spectrogramme prédit (même forme).
 * Renvoie { primary, secondary } : primary = sortie du modèle × compensate, secondary = mélange − primary.
 */
export async function separate([left, right], infer, onProgress = () => {}, params = MDX) {
	const { nFft, hop, dimT, compensate } = params;
	const fft = new Fft(nFft);
	const window = hannPeriodic(nFft);
	const chunkSize = hop * (dimT - 1);
	const trim = nFft / 2;
	const genSize = chunkSize - 2 * trim;
	const samples = left.length;
	const padEnd = genSize + trim - (samples % genSize);
	const padded = [left, right].map((signal) => {
		const out = new Float32Array(trim + samples + padEnd);
		out.set(signal, trim);
		return out;
	});
	const primary = [new Float32Array(samples), new Float32Array(samples)];
	const chunks = Math.ceil((samples + padEnd - trim) / genSize);
	for (let index = 0, start = 0; start + chunkSize <= padded[0].length; index++, start += genSize) {
		const chunk = padded.map((signal) => signal.subarray(start, start + chunkSize));
		const predicted = await infer(stft(chunk, params, fft, window));
		const waves = istft(predicted, params, fft, window);
		for (let channel = 0; channel < 2; channel++) {
			for (let i = 0; i < genSize; i++) {
				const target = start + i;
				if (target >= samples) break;
				primary[channel][target] = waves[channel][trim + i] * compensate;
			}
		}
		onProgress(Math.min(1, (index + 1) / chunks));
	}
	const secondary = [0, 1].map((channel) => {
		const mix = channel === 0 ? left : right;
		return Float32Array.from(mix, (value, i) => value - primary[channel][i]);
	});
	return { primary, secondary };
}
