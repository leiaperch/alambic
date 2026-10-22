import updaterPackage from 'electron-updater';

/** Délai avant la première vérification, pour ne pas ralentir l'ouverture de la fenêtre. */
const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Mises à jour depuis les releases GitHub (latest.yml publié avec l'installeur).
 * Téléchargement en arrière-plan ; l'installation attend que l'utilisateur la demande, ou se fait à la fermeture.
 * Toute erreur (hors ligne, release sans latest.yml) est ignorée : l'application reste utilisable.
 */
export class Updater {
	#timer = null;

	/** autoUpdater n'est lu qu'ici : son accesseur instancie l'outil de mise à jour, qui exige l'application Electron. */
	start(onReady) {
		const { autoUpdater } = updaterPackage;
		autoUpdater.autoDownload = true;
		autoUpdater.autoInstallOnAppQuit = true;
		autoUpdater.on('update-downloaded', (info) => onReady({ version: info.version }));
		autoUpdater.on('error', () => {});
		const check = () => autoUpdater.checkForUpdates().catch(() => {});
		this.#timer = setTimeout(() => {
			check();
			this.#timer = setInterval(check, CHECK_INTERVAL_MS);
		}, FIRST_CHECK_DELAY_MS);
	}

	install() {
		clearTimeout(this.#timer);
		clearInterval(this.#timer);
		updaterPackage.autoUpdater.quitAndInstall(false, true);
	}
}
