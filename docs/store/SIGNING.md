# Firma de la app para Google Play

El AAB que subes a Play debe estar firmado con tu **clave de subida** (upload key). Esa clave es secreta: no va en el repo ni en el chat. Después de inscribir la app en Play App Signing, Google guarda la clave de firma final y tu clave de subida solo autentica tus envíos.

## 1. Crear la clave de subida (una sola vez)

Guárdala fuera del repo, por ejemplo en una carpeta como `C:\Users\TU_USUARIO\.keys\`:

```bash
keytool -genkeypair -v -keystore "C:/Users/TU_USUARIO/.keys/honvert-upload.p12" -storetype PKCS12 -alias honvert-upload -keyalg RSA -keysize 2048 -validity 10000
```

Te pedirá una contraseña y tus datos (nombre, organización, país). Anota la contraseña en un gestor de contraseñas.

Haz una copia de seguridad del archivo `.p12` y de las contraseñas. Si la pierdes, puedes pedir a Play que restablezca la clave de subida, pero es un proceso con soporte y tarda.

## 2. Configurar Gradle (fuera del repo)

Agrega estas líneas a `gradle.properties` de tu carpeta de usuario (`~/.gradle/gradle.properties`, en Windows `C:\Users\TU_USUARIO\.gradle\`). La ruta del keystore tiene que ser absoluta, con barras `/`, porque Gradle no expande `~`:

```properties
honvertUploadStoreFile=C:/Users/TU_USUARIO/.keys/honvert-upload.p12
honvertUploadStorePassword=TU_CONTRASEÑA
honvertUploadKeyAlias=honvert-upload
honvertUploadKeyPassword=TU_CONTRASEÑA
```

El plugin `plugins/with-honvert-android.js` lee estas cuatro propiedades. Si faltan, el release se firma con la clave debug y Play lo rechaza.

## 3. Construir el AAB de publicación

Desde la carpeta `android` del proyecto:

```bash
./gradlew :app:bundleRelease
```

Resultado: `android/app/build/outputs/bundle/release/app-release.aab`.

Para probar en un teléfono, el APK firmado está en `android/app/build/outputs/apk/release/app-release.apk` (`./gradlew :app:assembleRelease`).

## 4. Verificar la firma

El certificado debe ser tuyo, no `Android Debug`:

```bash
jarsigner -verify -verbose -certs android/app/build/outputs/bundle/release/app-release.aab
```

Busca `CN=` con tu nombre o con el de tu clave. Si aparece `Android Debug`, la firma no está configurada.

## 5. Subir a Play Console

Sube el `.aab` en **Testing > Internal testing** primero. Después de probarlo, pasa a closed testing o producción.

## Recordatorios

- Sube `versionCode` en cada envío (está en `app.json`, ahora en 4; Play ya tiene la versión 1).
- Nunca subas `gradle.properties` ni el `.p12` al repo. El `.gitignore` de la raíz excluye la carpeta `/android` completa, y el `gradle.properties` con las contraseñas vive en tu carpeta de usuario, fuera del proyecto.
- Las pruebas de firma con una clave de prueba se hicieron con un keystore temporal fuera del repo; no se usaron para publicar.
