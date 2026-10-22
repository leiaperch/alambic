import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explain, explainFfmpeg } from '../electron/errors.js';
import { explainPdf, loadPdfLib } from '../src/engines/pdf-edit.js';

// Extraits réels de la sortie de ffmpeg 8.1 (relevés sur des fichiers d'essai).
const STDERR = {
	truncated: '[mov,mp4,m4a,3gp,3g2,mj2 @ 0000] moov atom not found\n[in#0 @ 0000] Error opening input: Invalid data found when processing input',
	noAudio: '[out#0/mp3 @ 0000] Output file does not contain any stream\nError opening output file o3.mp3.\nError opening output files: Invalid argument',
	missingFolder: '[image2 @ 0000] Could not open file : Z:/nexiste/pas/o.png\n[vost#0:0/png @ 0000] Error submitting a packet to the muxer: No such file or directory',
	protectedFolder: '[image2 @ 0000] Could not open file : C:/Windows/System32/x.png\n[vost#0:0/png @ 0000] Error submitting a packet to the muxer: Permission denied',
	diskFull: 'av_interleaved_write_frame(): No space left on device',
	qsv: '[h264_qsv @ 0000] Error initializing an internal MFX session: unsupported (-3)',
	unknown: 'Something odd happened\nTotally new failure',
};

test('ffmpeg : chaque cause connue a son message', () => {
	assert.match(explainFfmpeg(STDERR.truncated), /^Fichier illisible/);
	assert.match(explainFfmpeg(STDERR.noAudio), /ne contient pas la piste demandée/);
	assert.match(explainFfmpeg(STDERR.missingFolder), /dossier de sortie n’existe pas/);
	assert.match(explainFfmpeg(STDERR.protectedFolder), /^Accès refusé/);
	assert.match(explainFfmpeg(STDERR.diskFull), /^Disque plein/);
	assert.match(explainFfmpeg(STDERR.qsv), /Accélération matérielle/);
});

test('ffmpeg : cause inconnue, dernière ligne gardée comme indice', () => {
	assert.equal(explainFfmpeg(STDERR.unknown), 'ffmpeg a échoué : Totally new failure');
	assert.equal(explainFfmpeg(''), 'ffmpeg a échoué sans donner de raison.');
});

test('erreurs système et réseau traduites, messages d’Alambic laissés tels quels', () => {
	const fsError = Object.assign(new Error('EACCES: permission denied, open C:\\x'), { code: 'EACCES' });
	assert.match(explain(fsError), /^Accès refusé/);
	assert.match(explain(new Error('ENOSPC: no space left on device, write')), /^Disque plein/);
	assert.match(explain(new TypeError('fetch failed')), /Pas de connexion/);
	assert.equal(explain(new Error('Annulé')), 'Annulé');
	assert.equal(explain(new Error('Donne un nom au préréglage')), 'Donne un nom au préréglage');
});

test('PDF protégé ou abîmé', async () => {
	assert.match(explainPdf(Object.assign(new Error('Input document to `PDFDocument.load` is encrypted.'), { name: 'EncryptedPDFError' }), '« a.pdf »'), /« a\.pdf » est protégé par un mot de passe/);
	assert.match(explainPdf(Object.assign(new Error('No password given'), { name: 'PasswordException' })), /mot de passe/);
	await assert.rejects(loadPdfLib(new TextEncoder().encode('pas un pdf'), '« b.pdf »'), /« b\.pdf » est illisible/);
});
