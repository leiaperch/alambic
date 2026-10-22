# Composants tiers

## Fournis avec l'installeur

| Composant | Version | Licence | Source |
|---|---|---|---|
| FFmpeg (build « full shared » de Gyan Doshi) | 8.1.2 | GPL-3.0-or-later | code : https://github.com/FFmpeg/FFmpeg (tag `n8.1.2`) ; build et configuration : https://www.gyan.dev/ffmpeg/builds/ et https://github.com/GyanD/codexffmpeg/releases/tag/8.1.2 |
| yt-dlp | 2026.10.21 | Unlicense | https://github.com/yt-dlp/yt-dlp |
| Electron (Chromium, Node.js) | 44.7.0 | MIT, plus les licences de Chromium listées dans `LICENSES.chromium.html` à côté de l'exécutable | https://github.com/electron/electron |
| PDF.js (`pdfjs-dist`) | 6.4.299 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| pdf-lib | 1.17.1 | MIT | https://github.com/Hopding/pdf-lib |
| electron-updater | 6.8.10 | MIT | https://github.com/electron-userland/electron-builder |
| ONNX Runtime (`onnxruntime-node`, `onnxruntime-common`) | 1.30.0 | MIT | https://github.com/microsoft/onnxruntime |
| Recursive (police, via `@fontsource-variable/recursive`) | 5.3.0 | SIL Open Font License 1.1 | https://github.com/arrowtype/recursive |

Les binaires FFmpeg et yt-dlp sont copiés sans modification dans `resources\bin`. Leurs textes de licence sont dans `resources\licenses`. Pour obtenir le code source exact de FFmpeg, suivre les liens ci-dessus : la configuration de compilation est affichée par `ffmpeg -version`.

## Téléchargés à la demande, au premier usage d'un outil

Ces fichiers ne font pas partie de l'installeur. Alambic les récupère depuis leur dépôt d'origine quand l'utilisateur clique sur « Télécharger », puis vérifie leur empreinte SHA-256 (taille seulement pour Whisper).

| Fichier | Licence | Origine |
|---|---|---|
| Modèles Whisper `ggml-base.bin`, `ggml-large-v3-turbo-q5_0.bin` | MIT (poids OpenAI Whisper, conversion whisper.cpp) | https://huggingface.co/ggerganov/whisper.cpp |
| Silero VAD `ggml-silero-v5.1.2.bin` | MIT | https://huggingface.co/ggml-org/whisper-vad, d'après https://github.com/snakers4/silero-vad |
| Real-ESRGAN ncnn-vulkan 20220424 | BSD-3-Clause | https://github.com/xinntao/Real-ESRGAN/releases/tag/v0.2.5.0 |
| BiRefNet general lite (ONNX) | MIT | https://github.com/ZhengPeng7/BiRefNet, export ONNX publié par https://github.com/danielgatis/rembg |
| UVR-MDX-NET Inst HQ 3 (ONNX) | aucune licence déclarée sur le dépôt de distribution ; modèle entraîné par le projet Ultimate Vocal Remover (application sous licence MIT) | https://github.com/TRvlvr/model_repo, https://github.com/Anjok07/ultimatevocalremovergui |
