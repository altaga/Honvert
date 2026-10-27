// Android-only settings that app.json cannot express. Runs on every `expo prebuild`, so the
// generated android/ folder (gitignored) always gets the same result.
const fs = require("fs");
const path = require("path");
const { withAppBuildGradle, withDangerousMod, withGradleProperties, withProjectBuildGradle } = require("expo/config-plugins");

// Debug builds need the network for Metro and the dev client. The release manifest does not
// request INTERNET (see "blockedPermissions" in app.json), so this file only exists for debug.
const DEBUG_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.INTERNET" />
</manifest>
`;

function withDebugInternet(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "debug");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "AndroidManifest.xml"), DEBUG_MANIFEST);
      return cfg;
    },
  ]);
}

// Release signing reads the upload key from Gradle properties kept outside the repo
// (~/.gradle/gradle.properties). Without them the release build falls back to the debug key,
// which Play Console rejects, so the upload key must be configured before publishing.
const RELEASE_SIGNING_CONFIG = `        release {
            if (project.hasProperty("honvertUploadStoreFile")) {
                storeFile file(project.property("honvertUploadStoreFile"))
                storePassword project.property("honvertUploadStorePassword")
                keyAlias project.property("honvertUploadKeyAlias")
                keyPassword project.property("honvertUploadKeyPassword")
            }
        }
`;

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes("honvertUploadStoreFile")) return cfg;

    const closeSigningConfigs = "    }\n    buildTypes {";
    const insertAt = gradle.indexOf(closeSigningConfigs);
    if (insertAt === -1) throw new Error("with-honvert-android: signingConfigs block not found");
    gradle = gradle.slice(0, insertAt) + RELEASE_SIGNING_CONFIG + gradle.slice(insertAt);

    const buildTypesAt = gradle.indexOf("buildTypes {");
    const releaseAt = gradle.indexOf("release {", buildTypesAt);
    const debugSigning = "signingConfig signingConfigs.debug";
    const signingAt = gradle.indexOf(debugSigning, releaseAt);
    if (signingAt === -1) throw new Error("with-honvert-android: release signingConfig not found");
    gradle =
      gradle.slice(0, signingAt) +
      'signingConfig project.hasProperty("honvertUploadStoreFile") ? signingConfigs.release : signingConfigs.debug' +
      gradle.slice(signingAt + debugSigning.length);

    cfg.modResults.contents = gradle;
    return cfg;
  });
}

// R8 runs out of metaspace with the template default of 512 MB, so the Gradle JVM gets more room.
const GRADLE_JVM_ARGS = "-Xmx4096m -XX:MaxMetaspaceSize=1024m";

function withGradleMemory(config) {
  return withGradleProperties(config, (cfg) => {
    const item = cfg.modResults.find((p) => p.type === "property" && p.key === "org.gradle.jvmargs");
    if (item) item.value = GRADLE_JVM_ARGS;
    else cfg.modResults.push({ type: "property", key: "org.gradle.jvmargs", value: GRADLE_JVM_ARGS });
    return cfg;
  });
}

// Play's analysis asks for AGP 9+, which enables optimized resource shrinking. Expo's template
// leaves the plugin unversioned, so pin it here and point the wrapper at the Gradle version AGP 9 needs.
const AGP_VERSION = "9.0.1";
const GRADLE_VERSION = "9.4.1";

function withAgpVersion(config) {
  return withProjectBuildGradle(config, (cfg) => {
    const from = "classpath('com.android.tools.build:gradle')";
    if (cfg.modResults.contents.includes(from)) {
      cfg.modResults.contents = cfg.modResults.contents.replace(from, `classpath('com.android.tools.build:gradle:${AGP_VERSION}')`);
    }
    return cfg;
  });
}

function withGradleWrapperVersion(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, "gradle", "wrapper", "gradle-wrapper.properties");
      const text = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, text.replace(/gradle-[\d.]+-bin\.zip/, `gradle-${GRADLE_VERSION}-bin.zip`));
      return cfg;
    },
  ]);
}

// Windows limits paths to 260 characters. The CMake build folder (and the codegen folders inside it)
// must sit near the drive root, so Windows gets a short staging folder. Every platform pins CMake 4.1.2,
// the version the release was tested with, so CI on Linux builds with the same toolchain.
function withShortNativeBuild(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes('version = "4.1.2"')) return cfg;
    const staging = process.platform === "win32" ? '\n            buildStagingDirectory = file("C:/rc")' : "";
    cfg.modResults.contents += `
android {
    externalNativeBuild {
        cmake {${staging}
            version = "4.1.2"
        }
    }
}
`;
    return cfg;
  });
}

// PDFBox's JPEG 2000 filter references two optional classes that the app does not ship. R8 stops on them
// unless told to ignore them. Repair only loads and saves PDFs, so that filter is never run.
const PDFBOX_RULES = "\n# PDFBox: optional JPEG 2000 codec (not shipped)\n-dontwarn com.gemalto.jp2.**\n";

function withPdfboxRules(config) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
      const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
      if (!current.includes("com.gemalto.jp2")) fs.writeFileSync(file, current + PDFBOX_RULES);
      return cfg;
    },
  ]);
}

module.exports = (config) => withPdfboxRules(withShortNativeBuild(withGradleWrapperVersion(withAgpVersion(withGradleMemory(withReleaseSigning(withDebugInternet(config)))))));
