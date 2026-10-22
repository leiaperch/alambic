/**
 * Traduit les erreurs techniques (Node, ffmpeg, Word, réseau, outils externes) en messages français
 * qui disent ce qui s'est passé et quoi faire. Le détail d'origine n'est gardé que s'il aide.
 */

/** Codes d'erreur système de Node. */
const SYSTEM = Object.freeze({
	ENOENT: 'Fichier ou dossier introuvable : il a peut-être été déplacé, renommé ou supprimé depuis son ajout.',
	EACCES: 'Accès refusé : Windows interdit d’écrire ici. Choisis un autre dossier de sortie (« Dans un dossier… »).',
	EPERM: 'Opération refusée par Windows : le fichier est peut-être en lecture seule ou protégé. Choisis un autre dossier de sortie.',
	EBUSY: 'Fichier déjà ouvert dans un autre programme. Ferme-le puis réessaie.',
	ENOSPC: 'Disque plein : libère de la place ou choisis un dossier sur un autre disque.',
	EROFS: 'Ce disque est en lecture seule. Choisis un autre dossier de sortie.',
	ENAMETOOLONG: 'Chemin trop long pour Windows. Choisis un dossier de sortie plus proche de la racine (par ex. C:\\Exports).',
	EMFILE: 'Trop de fichiers ouverts en même temps. Relance la conversion avec moins de fichiers.',
	ENOTFOUND: 'Pas de connexion à Internet, ou le site est injoignable.',
	EAI_AGAIN: 'Pas de connexion à Internet, ou le site est injoignable.',
	ECONNRESET: 'La connexion a été coupée en cours de route. Réessaie.',
	ECONNREFUSED: 'Le serveur a refusé la connexion. Réessaie plus tard.',
	ETIMEDOUT: 'Le serveur ne répond pas. Vérifie la connexion puis réessaie.',
	ERR_CHILD_PROCESS_STDIO_MAXBUFFER: 'Le fichier est trop gros pour cette opération. Découpe-le dans le temps (section Temps) puis réessaie.',
});

/**
 * Motifs reconnus dans la sortie d'erreur de ffmpeg ; le premier qui correspond gagne.
 * Les textes de ffmpeg sont en anglais et ne changent pas d'une version à l'autre pour ces cas.
 */
const FFMPEG = [
	[/No space left on device/i, SYSTEM.ENOSPC],
	[/Permission denied/i, SYSTEM.EACCES],
	[/No such file or directory/i, SYSTEM.ENOENT],
	[/Invalid data found when processing input|moov atom not found|could not find codec parameters|EBML header parsing failed/i,
		'Fichier illisible : il est corrompu, incomplet (téléchargement interrompu ?) ou dans un format que ffmpeg ne connaît pas.'],
	[/does not contain any stream|Output file does not contain any stream|matches no streams/i,
		'Ce fichier ne contient pas la piste demandée (par exemple pas de son pour une sortie audio).'],
	[/Stream specifier ':a:0'|Stream map '0:a:0'|0:a:0.*matches no/i, 'Ce fichier n’a pas de piste audio.'],
	[/(qsv|nvenc|amf|mfx|cuda).*(error|fail|not supported|unsupported)|Error (initializing|while opening) (an internal|encoder).*(qsv|nvenc|amf)/i,
		'L’accélération matérielle a échoué sur ce fichier. Désactive « Accélération matérielle » dans la section Sortie puis réessaie.'],
	[/height not divisible by 2|width not divisible by 2/i, 'Dimensions impaires refusées par ce format. Mets une largeur et une hauteur paires.'],
	[/vidstab|transforms\.trf|stab\.trf/i, 'La stabilisation a échoué sur ce passage. Désactive « Stabiliser » ou découpe un passage plus court.'],
	[/Cannot allocate memory|Out of memory|malloc of size/i,
		'Mémoire insuffisante. Pour l’inversion, le boomerang ou le ralenti fluide, découpe un passage plus court.'],
	[/Error opening output file|Could not open file .* for writing|Unable to open .* for writing/i,
		'Impossible de créer le fichier de sortie. Vérifie que le dossier existe et n’est pas protégé, ou choisis-en un autre.'],
	[/Too many packets buffered for output stream/i, 'Pistes désynchronisées dans la source. Essaie une autre sortie ou réencode d’abord en MP4.'],
	[/Decoder .* not found|Unknown decoder|unsupported codec/i, 'Codec de la source non pris en charge.'],
	[/textfile|drawtext.*font|Cannot find a valid font/i, 'Impossible d’incruster le texte : police introuvable sur ce poste.'],
	[/subtitles.*(Unable|fail)|libass/i, 'Impossible d’incruster les sous-titres.'],
	[/Conversion failed/i, 'La conversion a échoué.'],
];

const KILLED = 'Annulé';

/** Dernière ligne utile de la sortie d'erreur, pour l'afficher sous le message traduit. */
function lastLine(text) {
	return String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !/^\s*$/.test(line)).pop() ?? '';
}

/** Les erreurs d'ouverture du fichier de sortie citent les mêmes causes système que l'entrée : on les distingue d'abord. */
function explainOutput(stderr) {
	// « Error opening output files » suit aussi une sortie sans piste : ce cas-là n'est pas un problème de dossier.
	if (/does not contain any stream|matches no streams/i.test(stderr)) return null;
	if (!/Error opening output|Could not open file|Unable to open .* for writing|submitting a packet to the muxer/i.test(stderr)) return null;
	if (/No such file or directory/i.test(stderr)) return 'Le dossier de sortie n’existe pas ou plus. Choisis un autre dossier de sortie.';
	if (/Permission denied/i.test(stderr)) return SYSTEM.EACCES;
	if (/No space left/i.test(stderr)) return SYSTEM.ENOSPC;
	return 'Impossible de créer le fichier de sortie. Vérifie que le dossier existe et n’est pas protégé, ou choisis-en un autre.';
}

export function explainFfmpeg(stderr) {
	const output = explainOutput(stderr ?? '');
	if (output) return output;
	for (const [pattern, message] of FFMPEG) if (pattern.test(stderr)) return message;
	const detail = lastLine(stderr);
	return detail ? `ffmpeg a échoué : ${detail}` : 'ffmpeg a échoué sans donner de raison.';
}

/**
 * Message final pour l'interface. Une erreur déjà rédigée par Alambic (en français, sans code système)
 * est rendue telle quelle ; sinon on traduit selon son code ou son texte.
 */
export function explain(error) {
	if (!error) return 'Erreur inconnue.';
	if (error.message === KILLED) return KILLED;
	if (error.code && SYSTEM[error.code]) return SYSTEM[error.code];
	if (error.cause?.code && SYSTEM[error.cause.code]) return SYSTEM[error.cause.code];
	const message = String(error.message ?? error);
	if (/fetch failed|getaddrinfo|network/i.test(message)) return SYSTEM.ENOTFOUND;
	const code = /\b(E[A-Z]{3,}|ERR_[A-Z_]+)\b/.exec(message)?.[1];
	if (code && SYSTEM[code]) return SYSTEM[code];
	return message;
}
