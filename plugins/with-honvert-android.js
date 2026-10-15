// Android-only settings that app.json cannot express. Runs on every `expo prebuild`, so the
// generated android/ folder (gitignored) always gets the same result.
const fs = require("fs");
const path = require("path");
const { withAppBuildGradle, withDangerousMod, withGradleProperties } = require("expo/config-plugins");

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

module.exports = (config) => withGradleMemory(withReleaseSigning(withDebugInternet(config)));
