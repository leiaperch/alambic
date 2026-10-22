import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

const FULL_TURN = 360;
const WATERMARK_ANGLE = 45;
const WATERMARK_GRAY = 0.5;
const NUMBER_SIZE = 10;
const NUMBER_MARGIN = 24;
const NUMBER_GRAY = 0.25;
const PERCENT = 100;

/** pdf-lib refuse les PDF chiffrés et lève des erreurs anglaises pour les fichiers abîmés. */
export function explainPdf(error, name = 'ce PDF') {
	const text = `${error?.name ?? ''} ${error?.message ?? ''}`;
	if (/Password|encrypted/i.test(text)) return `${name} est protégé par un mot de passe. Retire la protection (dans le lecteur PDF qui l’a créé) puis réessaie.`;
	if (/Invalid ?PDF|Failed to parse|No PDF header|Missing PDF|startxref|Unexpected/i.test(text)) return `${name} est illisible : fichier abîmé ou pas vraiment un PDF.`;
	return error?.message ?? String(error);
}

export async function loadPdfLib(bytes, name) {
	try {
		return await PDFDocument.load(bytes);
	} catch (error) {
		throw new Error(explainPdf(error, name));
	}
}

/**
 * Applique la grille de pages (ordre, rotation, suppression), un filigrane et des numéros de page.
 * `pages` : [{ page: n (1-based), rotate: 0|90|180|270 }] dans l'ordre voulu ; null = toutes, sans changement.
 * Fonction sans dépendance au navigateur : testable sous Node.
 */
export async function editPdfBytes(bytes, { pages = null, watermark = null, pageNumbers = false, name } = {}) {
	const source = await loadPdfLib(bytes, name);
	const plan = pages ?? source.getPageIndices().map((index) => ({ page: index + 1, rotate: 0 }));
	if (!plan.length) throw new Error('Toutes les pages ont été retirées.');
	const target = await PDFDocument.create();
	const copies = await target.copyPages(source, plan.map(({ page }) => page - 1));
	copies.forEach((copy, index) => {
		const extra = plan[index].rotate ?? 0;
		copy.setRotation(degrees((copy.getRotation().angle + extra) % FULL_TURN));
		target.addPage(copy);
	});
	const font = await target.embedFont(StandardFonts.HelveticaBold);
	if (watermark?.text?.trim()) drawWatermark(target, font, watermark);
	if (pageNumbers) drawNumbers(target, font);
	return target.save();
}

/** Texte en diagonale au centre de chaque page, taille relative à la plus petite dimension. */
function drawWatermark(doc, font, { text, opacity, size }) {
	const label = text.trim();
	// Les polices standard du PDF ne couvrent que l'alphabet latin (WinAnsi).
	try {
		font.encodeText(label);
	} catch {
		throw new Error('Le filigrane contient des caractères non pris en charge (emoji, alphabet non latin).');
	}
	for (const page of doc.getPages()) {
		const { width, height } = page.getSize();
		const fontSize = (Math.min(width, height) * size) / PERCENT;
		const textWidth = font.widthOfTextAtSize(label, fontSize);
		const radians = (WATERMARK_ANGLE * Math.PI) / (FULL_TURN / 2);
		page.drawText(label, {
			x: width / 2 - (textWidth / 2) * Math.cos(radians) + (fontSize / 2) * Math.sin(radians),
			y: height / 2 - (textWidth / 2) * Math.sin(radians) - (fontSize / 2) * Math.cos(radians),
			size: fontSize,
			font,
			color: rgb(WATERMARK_GRAY, WATERMARK_GRAY, WATERMARK_GRAY),
			opacity,
			rotate: degrees(WATERMARK_ANGLE),
		});
	}
}

/** « n / total » centré en bas ; sur une page tournée, le bas affiché n'est pas le bas du repère PDF. */
function drawNumbers(doc, font) {
	const pages = doc.getPages();
	pages.forEach((page, index) => {
		const label = `${index + 1} / ${pages.length}`;
		const { width, height } = page.getSize();
		const textWidth = font.widthOfTextAtSize(label, NUMBER_SIZE);
		const angle = page.getRotation().angle % FULL_TURN;
		const color = rgb(NUMBER_GRAY, NUMBER_GRAY, NUMBER_GRAY);
		const spots = {
			0: { x: (width - textWidth) / 2, y: NUMBER_MARGIN, rotate: 0 },
			90: { x: width - NUMBER_MARGIN, y: (height - textWidth) / 2, rotate: 90 },
			180: { x: (width + textWidth) / 2, y: height - NUMBER_MARGIN, rotate: 180 },
			270: { x: NUMBER_MARGIN, y: (height + textWidth) / 2, rotate: 270 },
		};
		const spot = spots[angle] ?? spots[0];
		page.drawText(label, { x: spot.x, y: spot.y, size: NUMBER_SIZE, font, color, rotate: degrees(spot.rotate) });
	});
}
