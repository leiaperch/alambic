# Alambic

Alambic est une application Windows pour convertir et retoucher des vidéos, des sons, des images, des PDF et des documents Word. Tout se calcule sur l'ordinateur : aucun fichier n'est envoyé en ligne, sauf le téléchargement d'une vidéo par lien et celui des modèles d'IA au premier usage.

*English summary at the end of this page.*

## Installer

1. Télécharger `Alambic-Setup-x.y.z.exe` dans la page [Releases](https://github.com/leiaperch/alambic/releases).
2. Lancer l'installeur. L'application n'est pas signée, Windows affiche donc « Windows a protégé votre ordinateur » : cliquer sur « Informations complémentaires » puis sur « Exécuter quand même ».
3. Ouvrir Alambic et glisser des fichiers ou des dossiers dans la fenêtre, ou faire un clic droit sur un fichier dans l'Explorateur puis « Convertir avec Alambic ».

À partir de la version 0.2.0, Alambic télécharge ses mises à jour en arrière-plan et propose de redémarrer pour les installer. La version 0.1.0 n'avait pas cette fonction : il faut installer la 0.2.0 une fois à la main.

Configuration requise : Windows 10 ou 11 en 64 bits. ffmpeg et yt-dlp sont fournis avec l'installeur. Microsoft Word n'est nécessaire que pour convertir des documents DOCX, DOC, ODT ou RTF.

## Ce que fait Alambic

### Conversion

| Entrée | Sorties |
|---|---|
| Vidéo (MP4, MOV, MKV, WebM, AVI…) | MP4 en H.264, H.265 ou AV1, WebM, MOV, MKV, GIF, WebP animé, APNG, son seul, image fixe, une image par trame, planche de sprites, sous-titres |
| Animation (GIF, WebP animé, APNG) | les mêmes formats que la vidéo |
| Son (MP3, WAV, FLAC, OGG, M4A…) | MP3, M4A, OGG, Opus, FLAC, WAV, sous-titres, voix et musique séparées |
| Image (PNG, JPG, WebP, AVIF, SVG…) | PNG, JPG, WebP, AVIF, JPEG XL, BMP, TIFF, ICO, PDF, agrandissement ×2 ou ×4, fond transparent |
| PDF | une image par page, texte, pages choisies, PDF réorganisé, DOCX (par Word) |
| Documents Word, ODT, RTF | PDF, DOCX, ODT, RTF, texte, HTML (par Word) |

Plusieurs fichiers peuvent recevoir les mêmes réglages en une fois, et des images ou des PDF peuvent être assemblés en un seul PDF.

### Retouche

Le recadrage se fait à la souris ou au clavier, avec des proportions imposées si besoin. On peut aussi tourner, retourner, redimensionner, flouter des zones (visage, plaque), poser un logo, garder un passage sur la timeline, changer la vitesse avec un ralenti fluide, stabiliser une vidéo filmée à la main, lire à l'envers, faire un boomerang, ajouter des fondus, corriger la luminosité, le contraste, la saturation et la teinte, appliquer un filtre, incruster un texte, débruiter une voix, couper ou égaliser le son.

Une recette de réglages s'enregistre comme préréglage (« GIF Discord 480p », par exemple) et se réapplique en un choix. L'onglet « Rendu » affiche une image calculée par ffmpeg avec tous les réglages, identique au résultat.

### Outils repris de sites en ligne

- Compresser une vidéo pour Discord (moins de 10 Mo).
- Retirer les métadonnées (position GPS, appareil, dates).
- Télécharger depuis YouTube et d'autres sites avec yt-dlp, en MP4, en MP3 ou en meilleure qualité pour l'éditer.
- Sous-titrer automatiquement avec Whisper, en `.srt` ou incrustés dans la vidéo.
- Réordonner, tourner ou supprimer les pages d'un PDF, y ajouter un filigrane ou des numéros de page.
- Agrandir une image avec Real-ESRGAN.
- Retirer le fond d'une image avec BiRefNet.
- Séparer la voix et la musique d'un morceau avec un modèle UVR MDX-Net.

Les quatre derniers outils téléchargent leur modèle à la première utilisation, une seule fois, dans `%APPDATA%\alambic`. Les tailles vont de 45 à 574 Mo, et chaque fichier est contrôlé par son empreinte SHA-256 (Whisper : par sa taille).

## Usage responsable

Télécharger une vidéo YouTube sans l'accord de son auteur va contre les conditions d'utilisation de YouTube. Le téléchargement par lien est prévu pour vos propres vidéos, celles sous licence libre et celles dont l'auteur l'autorise.

## Construire depuis les sources

Il faut Node.js 22 et Windows.

```bash
npm ci
npm run vendor
npm test
npm start
```

`npm run vendor` télécharge ffmpeg et yt-dlp dans `vendor/` et vérifie leur empreinte. `npm start` construit l'interface et ouvre l'application. `npm run dist` produit l'installeur dans `release/`.

Structure du code :

- `electron/` : processus principal (ffmpeg, Word, yt-dlp, Whisper, Real-ESRGAN, détourage, séparation) ;
- `src/` : interface en JavaScript sans framework ;
- `shared/formats.js` : catalogue des formats et recette par défaut, commun aux deux ;
- `test/` : tests unitaires (`npm test`) et bancs Playwright décrits dans `test/README.md`.

## Licence

Alambic est distribué sous licence GPL-3.0 ou ultérieure (voir `LICENSE`). Les composants tiers et leurs licences sont listés dans `THIRD_PARTY_NOTICES.md`, recopié dans le dossier `resources\licenses` de l'installation.

## English summary

Alambic is a Windows desktop app (Electron + native ffmpeg) that converts and edits video, audio, images, PDF and Word documents locally. It also downloads media with yt-dlp, generates subtitles with Whisper, upscales images with Real-ESRGAN, removes backgrounds with BiRefNet and splits vocals from music with a UVR MDX-Net model. The interface is in French. Download the installer from the Releases page; the app is unsigned, so Windows SmartScreen asks for confirmation on first launch. Licensed under GPL-3.0-or-later.
