import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { editPdfBytes } from '../src/engines/pdf-edit.js';

async function sample(count) {
	const doc = await PDFDocument.create();
	for (let n = 1; n <= count; n++) doc.addPage([200 + n, 300]);
	return doc.save();
}

test('ordre, rotation et suppression suivent la grille', async () => {
	const bytes = await editPdfBytes(await sample(4), { pages: [{ page: 3, rotate: 90 }, { page: 1, rotate: 0 }, { page: 4, rotate: 270 }] });
	const doc = await PDFDocument.load(bytes);
	assert.deepEqual(doc.getPages().map((p) => p.getWidth()), [203, 201, 204]);
	assert.deepEqual(doc.getPages().map((p) => p.getRotation().angle), [90, 0, 270]);
});

test('filigrane et numéros ajoutent du contenu sans changer le nombre de pages', async () => {
	const plain = await editPdfBytes(await sample(2));
	const marked = await editPdfBytes(await sample(2), { watermark: { text: 'CONFIDENTIEL – brouillon', opacity: 0.2, size: 12 }, pageNumbers: true });
	assert.equal((await PDFDocument.load(marked)).getPageCount(), 2);
	assert.ok(marked.length > plain.length);
});

test('grille vide refusée', async () => {
	await assert.rejects(editPdfBytes(await sample(1), { pages: [] }), /retirées/);
});
