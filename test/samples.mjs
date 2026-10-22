// Dossiers des bancs Playwright : ALAMBIC_SAMPLES contient les fichiers d'essai, ALAMBIC_OUT reçoit les sorties.
export function samplesDir() {
	if (!process.env.ALAMBIC_SAMPLES) throw new Error('Définis ALAMBIC_SAMPLES (dossier des fichiers d’essai, voir test/README.md).');
	return process.env.ALAMBIC_SAMPLES.replaceAll('\\', '/');
}

export function outputDir() {
	if (!process.env.ALAMBIC_OUT) throw new Error('Définis ALAMBIC_OUT (dossier de sortie des bancs).');
	return process.env.ALAMBIC_OUT.replaceAll('\\', '/');
}
