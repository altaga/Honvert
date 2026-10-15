# Respuestas para Play Console

Cada bloque trae el texto para copiar (en inglés, como lo pide la consola) y una nota en español. Revisa los marcados con `[...]`.

## 1. Política de privacidad

**URL:** `[PRIVACY_POLICY_URL]`

Nota: sale de `docs/store/privacy-policy.html`. Publícala en GitHub Pages y pon la URL aquí.

## 2. Acceso a la app (App access)

All functionality is available without special access. The app has no accounts, no sign-in and no restricted areas.

## 3. Anuncios (Ads)

No, my app does not contain ads.

## 4. Clasificación de contenido (IARC)

Category: Utility, productivity, communication or other.

- Violence: No
- Sexual content or nudity: No
- Language: No
- Controlled substances: No
- Gambling or simulated gambling: No
- User-generated content or sharing with other users: No
- Sharing the user's location: No
- Sharing personal information: No
- Purchases in the app or digital goods: No

Resultado esperado: Everyone (PEGI 3 / equivalente). Play calcula la clasificación final con tus respuestas.

## 5. Público objetivo (Target audience)

Age groups: 13 and over. Not designed for children.

Nota: si eliges menores de 13, Play aplica obligaciones adicionales para apps familiares. Elige 13 o más.

## 6. Declaraciones de contenido

- News app: No
- COVID-19 contact tracing or status app: No
- Government app: No
- Financial features: No
- Health features: No

## 7. Seguridad de los datos (Data safety)

- Does your app collect or share any of the required user data types? **No**
- Is all of the user data collected by your app encrypted in transit? **Not applicable**: the app collects no data and sends none.
- Do you provide a way for users to request that their data be deleted? **Not applicable**: the app collects no data. Uninstalling removes all data stored on the device.
- Has your app been independently validated against a global security standard? **No**

Nota: "No datos recopilados" es verdad para esta versión porque el APK de publicación no pide INTERNET y no tiene analítica ni SDK de anuncios (verificado en `package.json` y en el manifest).

## 8. Servicio en primer plano (Foreground service)

Play pide una declaración para cada tipo de servicio en primer plano. Tipo: **Data sync** (`dataSync`).

Justification (copy):

> Honvert runs a foreground service of type dataSync only while the user has started a file conversion. The service processes the files the user selected, entirely on the device, and keeps the conversion running when the user switches to another app. A notification shows the progress and a Cancel action. The service stops when the conversion finishes, when the user cancels it, or when Android's dataSync time limit is reached: the app handles the onTimeout callback and stops the conversion immediately.

Video demo (obligatorio): graba 30 a 60 segundos del build de publicación. Muestra cómo el usuario inicia una conversión larga, cambia a otra app y ve la notificación con progreso y el botón Cancelar. Súbela como enlace de YouTube no listado o a Drive con acceso público.

Nota: ya tienes la ruta para grabar: `adb shell screenrecord` en el emulador, o la grabadora del teléfono. Para la grabación real, usa el AAB o el APK firmado con tu clave de subida.

## 9. Cumplimiento de exportación (Export compliance)

Does your app use encryption? **Yes**, but only standard encryption. The bundled FFmpeg libraries include TLS code for HTTPS, which the app never uses (no network permission). Your app does not implement custom cryptography.

Nota: las respuestas de exportación son tu responsabilidad legal. Si no estás seguro de la clasificación, revísalo con alguien que lo sepa. Muchas apps como esta califican para la excepción de mercado masivo, pero no lo doy por hecho.

## 10. Ficha de la tienda (Store listing)

Textos completos en `docs/store/listing.md`. Gráficos en `docs/store/graphics/`:

- Icono 512 × 512: `icon-512.png`
- Gráfico de funciones 1024 × 500: `feature-graphic-1024x500.png`
- Capturas de teléfono: `screenshots/01-home.png`, `02-images.png`, `03-settings.png`, `04-licenses.png` (1080 × 2160, relación 2:1 que Play acepta)

## 11. Pista de prueba antes de producción

Si tu cuenta es personal y se creó recientemente, Play exige una prueba cerrada con 12 testers durante 14 días antes de dar acceso a producción. Esta regla cambia; confírmala en la consola antes de planear la fecha de lanzamiento.

## 12. Revisión final antes de enviar

- [ ] AAB firmado con tu clave de subida (ver `SIGNING.md`).
- [ ] Política de privacidad publicada y URL pegada.
- [ ] Declaración de servicio en primer plano y video de demostración.
- [ ] Capturas, icono y gráfico de funciones subidos.
- [ ] Nombre, descripción y notas de la versión revisados por ti.
