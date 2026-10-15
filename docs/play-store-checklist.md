# Honvert: checklist para Google Play

Estado al 2026-10-15. **[x]** = hecho y comprobado en este repo o en el emulador. **[ ]** = pendiente. Lo que dice "tuyo" necesita tu cuenta, tus claves o tu decisión; no lo puedo hacer desde aquí.

Archivos de publicación: `docs/store/`. Firma: `docs/store/SIGNING.md`. Respuestas para la consola: `docs/store/play-console-answers.md`. Textos de la ficha: `docs/store/listing.md`.

## Build y firma

- [x] `applicationId` `com.honvert.app`. No se puede cambiar después de publicar.
- [x] `versionCode` 2 (la 1 ya la usó una subida anterior), `versionName` 0.1.0. Sube `versionCode` en cada envío.
- [x] `targetSdk` 36, `compileSdk` 36, `minSdk` 24 (vía `expo-build-properties`).
- [x] Release con R8 (minificación) y reducción de recursos (~230 KB menos, verificado).
- [ ] PNG crunch: el flag existe, pero el build no ejecuta esa tarea. Los PNG pesan 0.10 MB en total, así que el impacto es mínimo.
- [x] Firma con clave de subida probada con un keystore temporal fuera del repo: el certificado es el correcto y el AAB se genera (95 MB).
- [ ] **Tuyo:** crear tu clave de subida y agregar las cuatro propiedades al `gradle.properties` de tu carpeta de usuario. Guía en `docs/store/SIGNING.md`.
- [ ] **Tuyo:** inscribir la app en Play App Signing.
- [x] Se sube el `.aab`, no el `.apk`. Play genera un APK por dispositivo.

## Compatibilidad y tamaño

- [x] Páginas de 16 KB: `zipalign -c -P 16` pasa, y las bibliotecas nativas tienen alineación de segmento 0x4000.
- [x] `useLegacyPackaging=false`.
- [ ] Prueba en un teléfono físico con página de 16 KB. Solo verificado en emulador.
- [ ] Revisa el tamaño de descarga por dispositivo con `bundletool get-size total` sobre el `.aab`. Lo grande es FFmpeg: unos 46 MB de bibliotecas nativas en arm64.

## Permisos y privacidad

- [x] Release sin `INTERNET`, sin almacenamiento, sin `SYSTEM_ALERT_WINDOW`, no `debuggable`. `allowBackup` desactivado.
- [ ] El release trae `ACCESS_NETWORK_STATE` y `VIBRATE`, que vienen de dependencias. No son sensibles. Decide si los bloqueas con `blockedPermissions`.
- [x] `POST_NOTIFICATIONS` se pide en tiempo de ejecución en Android 13+.
- [x] Android 15+: `onTimeout` detiene la conversión antes del límite de 6 h de `dataSync`.
- [x] Justificación del servicio en primer plano redactada (`play-console-answers.md`, §8).
- [ ] **Tuyo:** video de demostración de 30 a 60 segundos del servicio en primer plano, con el build de publicación.
- [x] Respuestas de Data safety redactadas (§7): no se recopilan datos y no se comparten. No hay analítica ni SDK de anuncios (revisado en `package.json`).
- [x] Política de privacidad redactada en inglés y español: `docs/store/privacy-policy.html`.
- [ ] **Tuyo:** publicar esa página (por ejemplo en GitHub Pages) y pegar la URL en Play Console. Play la exige aunque la app no recopile datos.
- [x] Respuestas del cuestionario de clasificación redactadas (§4). Resultado esperado: Everyone.
- [ ] **Tuyo:** responder el cuestionario, Data safety y la declaración de exportación en la consola. La exportación depende de tu clasificación legal; el FFmpeg incluido tiene código TLS.

## Licencias

- [x] Pantalla de licencias en Ajustes (`src/app/licenses.js`): texto completo de LGPL-3.0, avisos de los 33 componentes y enlaces al código fuente de FFmpeg 8.1.3 y del build (fork de ffmpeg-kit).
- [x] Avisos generados desde el AAR de ffmpeg-kit con `scripts/generate-third-party-notices.js`, no escritos a mano.
- [x] FFmpeg está compilado con `--enable-version3` y sin `--enable-gpl` ni `--enable-nonfree` (verificado en el binario).
- [ ] libiconv: el AAR trae su licencia en versión GPL-3. No pude confirmar si está enlazado, porque los símbolos del `.so` de release están eliminados. Revísalo antes de publicar.
- [x] La app está bajo licencia MIT (`LICENSE` en el repo).
- [x] Las dependencias que se distribuyen tienen licencias permisivas (revisado en la auditoría).

## Seguridad de dependencias (`npm audit`)

- 37 → 24 vulnerabilidades (14 altas, 10 moderadas) con `overrides` acotados.
- Restantes sin fix upstream, en herramientas de build y desarrollo: `braces`/`micromatch` (Metro), `node-forge` (`@expo/cli`), `sprintf-js`/`js-yaml`/`argparse` (nyc).
- En runtime: `query-string`/`decode-uri-component` en expo-router (moderada, DoS con deep links malformados).
- La solución de fondo es subir el SDK de Expo. `npm audit fix --force` propone bajar a Expo 44; no lo uses.

## Tienda

- [x] Textos en inglés y español (`listing.md`), con los límites de Play revisados (nombre, descripción corta y larga).
- [x] Icono 512×512 (`graphics/icon-512.png`), gráfico de funciones 1024×500 (`graphics/feature-graphic-1024x500.png`) y 4 capturas de 1080×2160 (`graphics/screenshots/`), con relación 2:1, que Play acepta.
- [ ] **Tuyo:** revisar el nombre "Honvert". Una búsqueda web no encontró conflicto directo, pero hushvert es un conversor de privacidad del mismo nicho con un nombre parecido. Revisa USPTO, EUIPO y WIPO a mano y confirma el dominio en un registrador.
- [ ] **Tuyo:** si la cuenta es personal y nueva, Play exige una prueba cerrada con 12 testers durante 14 días antes de producción. Confírmalo en la consola.

## Verificación técnica

- [x] ESLint sin errores (corrida final).
- [x] E2E del motor en el emulador, sobre el build debug con el JS embebido: 31 conversiones y la cancelación, 32/32. Las salidas se decodificaron sin errores en el host.
- [ ] El harness no corrió sobre el APK de release, porque se borró antes de la publicación. El código del motor es el mismo.
- [x] Release instalado, arranca sin Metro, sin errores fatales. Renderizan la pantalla de inicio, Images, Ajustes y Licencias.
- [ ] UI en release: háptica, gesto atrás con `targetSdk` 36, RU/AR/HI/JA sin cortes.
- [ ] Cancelar desde la notificación en el build de release (verificado en debug).
- [ ] GPU real: `h264_mediacodec` no se ha probado en hardware. En el emulador cae a `libopenh264`.
- [ ] Killers de batería de fabricantes (Xiaomi, Huawei, etc.): sin probar.
