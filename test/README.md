# Tests

`npm test` lance les tests unitaires (`*.test.mjs`) : construction des commandes ffmpeg, yt-dlp et Whisper, édition de PDF, FFT et STFT de la séparation, préparation du détourage. Ils ne lancent ni ffmpeg ni l'application.

## Bancs Playwright

`drive.mjs` ouvre l'application construite et exécute un scénario. Chaque banc ouvre une vraie fenêtre.

```bash
npm run build
ALAMBIC_SAMPLES=chemin/vers/echantillons ALAMBIC_OUT=chemin/vers/sorties node test/drive.mjs test/smoke.mjs
```

| Scénario | Ce qu'il fait |
|---|---|
| `smoke.mjs` | ajoute les échantillons et vérifie qu'ils sont tous lus |
| `convert.mjs` | convertit toute la file vers `ALAMBIC_OUT` |
| `edit.mjs` | recadre, tourne, accélère une vidéo et y incruste un texte, puis capture l’écran |

Le dossier `ALAMBIC_SAMPLES` doit contenir `clip.mp4`, `son.mp3`, `photo.png`, `sword-1.webp` (WebP animé), `anim.gif`, `logo.svg`, `vieux.avi`, `cahier.pdf` et `doc.docx`. Pour tester l'exécutable empaqueté, définir aussi `ALAMBIC_EXE=release/win-unpacked/Alambic.exe`.
