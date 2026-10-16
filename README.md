# NotchDrop para Windows

La isla dinámica de NotchDrop, en Windows: una pastilla negra arriba al centro de la pantalla que se abre al pasar el mouse o con **Ctrl + Alt + N**.

Versión MVP, hecha con Tauri 2 (Rust + interfaz web). La versión de Mac vive en [marvalre/NotchDrop](https://github.com/marvalre/NotchDrop).

## Qué incluye

- **Player** — igual que en la Mac: carátula, anterior / pausa / siguiente, barra para adelantar, **volumen con silenciar**, botón de **salida de audio** (en lugar de AirPlay) y **espejo de cámara**. Funciona con Spotify, el navegador o el Reproductor multimedia (vía *System Media Transport Controls*). La pastilla cerrada muestra una **onda en vivo** que sigue el audio real de la PC (solo mide el nivel; no graba nada).
- **Shelf** — arrastra archivos a la isla para tenerlos a la mano y vuelve a arrastrarlos a cualquier app. Pega un link de TikTok, Instagram, X, YouTube o Reddit y bájalo en **MP4** (H.264, se abre en todos lados) o **MP3**; los archivos van a Descargas.
- **Convert** — cambia el formato de video (MP4, MOV, WebM, GIF, MP3, M4A, WAV), audio (MP3, M4A, WAV, FLAC) e imágenes (PNG, JPG, WebP, BMP, TIFF, GIF), o comprímelos al 90 / 75 / 50 / 30 % del tamaño. Nunca sobrescribe el original.
- **Tools**
  - Historial del portapapeles con **texto e imágenes**. Las copias que los gestores de contraseñas marcan como privadas nunca se guardan, y las imágenes nunca se escriben en disco.
  - Varias alarmas a la vez, con tono real en loop y notificación de Windows. Una alarma que vence con la PC dormida se marca como perdida en vez de sonar tarde.
  - Cronómetro.
- **Notes** — notas rápidas guardadas en la app (Windows no tiene Apple Notes).
- **Currency** — 30 monedas con tasas del BCE (Frankfurter) y calculadora: escribe `19.99*3`.
- **Ajustes** — iniciar con Windows, abrir al pasar el mouse, tamaño del panel (Compacto / Estándar / Amplio), recordar el portapapeles, cookies del navegador para descargas, estado del audio en vivo y carpeta de descargas.

**Herramientas con un clic.** Descargar y convertir video/audio usan [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense) y las compilaciones estáticas de ffmpeg de [eugeneware/ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) (GPL). No vienen dentro de la app: el botón **Instalar herramientas** las descarga (~75 MB) a la carpeta de la app, sin Terminal ni permisos de administrador, y verifica cada una con SHA-256 antes de guardarla (las de ffmpeg con hashes fijados en el código; la de yt-dlp con el `SHA2-256SUMS` de su release). Si ya las tienes en el PATH, usa esas.

**Actualizaciones con un clic.** Desde la 0.4.0 la app revisa una vez al día (se puede apagar) si hay una versión nueva y avisa; en **Ajustes → Actualizaciones**, **Actualizar** la descarga, verifica su firma contra la llave pública incluida en la app, la instala y reinicia. Nunca se instala nada sin que lo pulses. Cómo se firma y se publica: [RELEASING.md](RELEASING.md).

Aún no: PDF a imágenes, HEIC, AirDrop (no existe en Windows), botón "Detener" dentro de la notificación de alarma.

## Desarrollo

```bash
npm install
npm test                 # lógica (calculadora, alarmas, portapapeles, cronómetro…)
cd src-tauri && cargo test
# conversiones reales con ffmpeg: NOTCHDROP_FFMPEG=… NOTCHDROP_FFPROBE=… cargo test
npm run tauri dev        # en Windows
```

Los instaladores (`.exe` y `.msi`) los compila GitHub Actions en una máquina Windows (`.github/workflows/windows.yml`).

## Licencia

MIT.
