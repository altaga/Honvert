# Tests

Honvert's tests run entirely on your PC. They need no device, no emulator and no network, so you can run them as often as you like.

## Run them

| Command | What it runs |
| --- | --- |
| `npm test` | JavaScript unit and fuzz tests (Jest), 20 000 generated cases per fuzz property |
| `npm run test:native` | JVM unit and fuzz tests for the native repair code (JUnit 4), 3 000 cases per property |
| `npm run test:all` | Both of the above |
| `npm run test:deep` | One million cases per fuzz property, JavaScript and native. About 6 minutes for JavaScript (measured), and roughly 16 minutes for native (estimated from a 30 000-case run) |
| `npm run test:e2e` | Device check: repairs a damaged PDF in the app and saves it to Documents. Needs a device, see [On a device](#on-a-device) |
| `npm run lint` | ESLint over the app, the tests and the configs |

For another case count, set `HONVERT_FUZZ_ITERATIONS` first. In PowerShell, use `$env:HONVERT_FUZZ_ITERATIONS = "5000000"`. The Gradle daemon keeps the environment it was started with, so add `-- --no-daemon` to `npm run test:native` to make sure the value reaches the test JVM.

## What is covered

JavaScript (`tests/`):

- `unit/names.test.js`: file names and output extensions. Clips by UTF-8 bytes without splitting a character, removes characters a file system refuses, keeps a single extension, and picks the MP4 target for re-encoding.
- `unit/errors.test.js`: how FFmpeg and PDF failures become translation keys.
- `unit/media.test.js`: crop math, every FFmpeg command builder (exact arguments), probe parsing, and the hardware encoder check.
- `unit/options.test.js`: every category, control and default is complete and translated. Speeds stay inside the range FFmpeg accepts, and crops match the media module.
- `unit/option-builders.test.js`: every choice a user can pick builds a valid FFmpeg command, not only the defaults.
- `unit/i18n.test.js`: the ten languages have the same keys and placeholders, none is empty, every key the code uses exists, every key is used, and no key is built at runtime.
- `fuzz/*.test.js`: seeded random inputs for names and paths, crop and command builders, and interpolation.

Native (`modules/honvert-engine/android/src/test/`):

- `RepairToolsTest.kt`: file signature detection (including junk in front of the real header), JPEG and GIF end markers, ZIP rebuild (intact and cut short), H.264 recovery from an MP4 without its index, parameter sets from the `avcC` box, and fuzzing of each of these.

Not covered by these tests: PNG repair (it uses Android's `Bitmap`), PDF repair (it needs an Android `Context` and PDFBox), FFmpeg itself, and the screens. The device check below covers the PDF repair and the save flow.

## On a device

`npm run test:e2e` drives the installed app on a connected device or emulator:

1. Puts a damaged PDF into `Downloads` on the device.
2. Repairs it in the app, taps the download icon of the result, and saves the copy into `Documents`.
3. Checks that MediaStore lists the copy, that it starts with `%PDF-`, and that the app did not crash.

It needs `adb` on the PATH, one device or emulator, the app installed, and the device in English. Pass `--install` to install `android/app/build/outputs/apk/release/app-release.apk` first (app data is kept), or `--serial <id>` when several devices are connected, for example `npm run test:e2e -- --install --serial emulator-5554`.

The script finds each control by its visible text, taken from `src/i18n/locales/en.js`, so it follows wording changes. It leaves the damaged PDF and the saved copy on the device. Android does not accept the Download folder itself as a save target, so the script saves into Documents.

## When a fuzz test fails

The failing case is printed as JSON and the run stops there. The JavaScript fuzz tests use the seed in `HONVERT_FUZZ_SEED` (default `20261027`), so the same command replays the same cases. The native tests use fixed seeds in the code.

## Adding to the suite

- New option or choice: `options.test.js` and `option-builders.test.js` read it from `CATEGORIES` automatically. Add its translation keys to all ten locales. The i18n tests name any that are missing.
- New translated text: call `t("...")` with a literal key. Keys built at runtime are rejected by the i18n tests.
- New command builder: add exact-argument cases to `unit/media.test.js` and a property to `fuzz/media.fuzz.test.js`.
- New native repair step: keep the logic in plain Kotlin without Android types, so `RepairToolsTest.kt` can run it on the JVM.

## Offline

After `npm install` and the first Gradle build, the suite needs no network. The first `npm run test:native` downloads JUnit 4.13.2 once into Gradle's cache.
