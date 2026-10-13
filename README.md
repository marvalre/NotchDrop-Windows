# NotchDrop para Windows

La isla dinámica de NotchDrop, en Windows: una pastilla negra arriba al centro de la pantalla que se abre al pasar el mouse o con **Ctrl + Alt + N**.

Versión MVP, hecha con Tauri 2 (Rust + interfaz web). La versión de Mac vive en [marvalre/NotchDrop](https://github.com/marvalre/NotchDrop).

## Qué incluye

- **Player** — lo que suena en Spotify, el navegador o el Reproductor multimedia (vía *System Media Transport Controls*, lo mismo que usa el control de volumen de Windows): carátula, progreso, anterior / pausa / siguiente.
- **Tools**
  - Historial del portapapeles (texto). Las copias que los gestores de contraseñas marcan como privadas nunca se guardan.
  - Varias alarmas a la vez, con tono real en loop y notificación de Windows. Una alarma que vence con la PC dormida se marca como perdida en vez de sonar tarde.
  - Cronómetro.
- **Notes** — notas rápidas guardadas en la app (Windows no tiene Apple Notes).
- **Currency** — 30 monedas con tasas del BCE (Frankfurter) y calculadora: escribe `19.99*3`.
- **Ajustes** — abrir al iniciar Windows, abrir al pasar el mouse, recordar el portapapeles.

Aún no: descargas de videos, conversión de archivos, Shelf, onda de audio en vivo, control de volumen y actualización automática.

## Desarrollo

```bash
npm install
npm test                 # lógica (calculadora, alarmas, portapapeles)
cd src-tauri && cargo test
npm run tauri dev        # en Windows
```

Los instaladores (`.exe` y `.msi`) los compila GitHub Actions en una máquina Windows (`.github/workflows/windows.yml`).

## Licencia

MIT.
