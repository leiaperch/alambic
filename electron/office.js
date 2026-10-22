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

const WORD_ERRORS = [
	[/password|mot de passe/i, 'Document protégé par un mot de passe : ouvre-le dans Word, retire le mot de passe, enregistre, puis réessaie.'],
	[/being used by another|used by another process|verrouill|locked|en cours d.utilisation/i, 'Le document est ouvert ailleurs (Word, OneDrive…). Ferme-le puis réessaie.'],
	[/80040154|Cannot create ActiveX|Retrieving the COM class factory/i, 'Microsoft Word est introuvable ou mal installé sur ce poste.'],
	[/corrupt|endommag|cannot be opened|ne peut pas ouvrir/i, 'Word n’arrive pas à ouvrir ce document : il est peut-être endommagé.'],
	[/Command failed.*SaveAs|SaveAs2|denied|refus/i, 'Word n’a pas pu enregistrer le résultat. Vérifie que le dossier de sortie n’est pas protégé, ou choisis-en un autre.'],
];

/** Erreur de PowerShell/Word → message ; un délai dépassé signale presque toujours une boîte de dialogue ouverte dans Word. */
function explainWord(error) {
	if (error.killed) return 'Word n’a pas répondu en 3 minutes : une boîte de dialogue attend peut-être dans Word (document réparé, macros). Ouvre le document dans Word une fois, puis réessaie.';
	const text = `${error.stderr ?? ''} ${error.message ?? ''}`;
	for (const [pattern, message] of WORD_ERRORS) if (pattern.test(text)) return message;
	return 'Word n’a pas pu convertir ce document.';
}

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
		throw new Error(explainWord(error));
	}
}
