# Publicar una versión de NotchDrop para Windows

## La llave de firma de las actualizaciones (léelo una vez)

Cada versión lleva una firma. La app instalada solo acepta una actualización si su firma coincide con la llave pública que trae dentro (`plugins.updater.pubkey` en `src-tauri/tauri.conf.json`). Así nadie puede colarte un instalador falso aunque entrara a tu GitHub.

- **Dónde vive el secreto:**
  - En los *secrets* del repo en GitHub: `TAURI_SIGNING_PRIVATE_KEY` y `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Ahí la usa la compilación.
  - Respaldo en el Llavero de tu Mac: "NotchDrop Windows updater key" y "NotchDrop Windows updater key password".
- **No está en el repo.** Nunca la pegues en un archivo, chat o correo.
- **Si se pierde:** las apps instaladas siguen funcionando, pero ya no podrán actualizarse solas. Habría que reinstalar a mano con una llave nueva.

### Respaldo (una vez)

En Terminal de la Mac, copia cada valor al portapapeles y guárdalo en la app **Contraseñas** como dos entradas, "NotchDrop Windows llave" y "NotchDrop Windows contraseña de la llave":

```bash
security find-generic-password -a NotchDrop-Windows -s "NotchDrop Windows updater key" -w | pbcopy
security find-generic-password -a NotchDrop-Windows -s "NotchDrop Windows updater key password" -w | pbcopy
```

Copia cualquier otra cosa al final para limpiar el portapapeles.

### Si hay que volver a poner los secretos en GitHub

```bash
security find-generic-password -a NotchDrop-Windows -s "NotchDrop Windows updater key" -w | gh secret set TAURI_SIGNING_PRIVATE_KEY --repo marvalre/NotchDrop-Windows
security find-generic-password -a NotchDrop-Windows -s "NotchDrop Windows updater key password" -w | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo marvalre/NotchDrop-Windows
```

## Publicar

1. Sube la versión en `package.json`, `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml`.
2. Haz commit y crea el tag: `git tag -a v0.4.1 -m "…"`, luego `git push origin main v0.4.1`.
3. GitHub Actions compila en Windows, corre las pruebas y firma el instalador. Después publica el Release con `…-setup.exe`, su `.sig`, el `.msi` y `latest.json`. Las apps instaladas leen `latest.json` para ofrecer **Actualizar**.
