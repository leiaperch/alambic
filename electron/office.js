import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const WORD_TIMEOUT_MS = 180_000;
const WORD_CHECK_TIMEOUT_MS = 10_000;

/** Codes WdSaveFormat de Word. */
export const WORD_FORMAT = Object.freeze({
	'office-pdf': 17,
	'office-docx': 16,
	'office-odt': 23,
	'office-rtf': 6,
	'office-txt': 2,
	'office-html': 10,
	'pdf-docx': 16,
});

// Chemins passés par variables d'environnement : aucun contenu utilisateur n'entre dans le script.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
try {
	$word.Visible = $false
	$word.DisplayAlerts = 0
	$doc = $word.Documents.Open($env:ALAMBIC_IN, $false, $true, $false)
	try { $doc.SaveAs2($env:ALAMBIC_OUT, [int]$env:ALAMBIC_FORMAT, $false, '', $false, '', $false, $false, $false, $false, $false, 65001) }
	finally { $doc.Close(0) }
} finally {
	$word.Quit()
	[void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
`;

const run = (script, env, timeout) => execFileAsync(
	'powershell.exe',
	['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
	{ env: { ...process.env, ...env }, timeout, windowsHide: true },
);

export async function isWordAvailable() {
	try {
		const { stdout } = await run("[bool]([Type]::GetTypeFromProgID('Word.Application'))", {}, WORD_CHECK_TIMEOUT_MS);
		return stdout.trim() === 'True';
	} catch {
		return false;
	}
}

export async function convertWithWord(inputPath, outputPath, outputId) {
	const format = WORD_FORMAT[outputId];
	if (format === undefined) throw new Error(`Sortie Word inconnue : ${outputId}`);
	try {
		await run(SCRIPT, { ALAMBIC_IN: inputPath, ALAMBIC_OUT: outputPath, ALAMBIC_FORMAT: String(format) }, WORD_TIMEOUT_MS);
	} catch (error) {
		const detail = (error.stderr || error.message || '').trim().split('\n').slice(0, 2).join(' ');
		throw new Error(`Word n'a pas pu convertir le fichier. ${detail}`);
	}
}
