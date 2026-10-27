// Runs the JVM unit and fuzz tests of the native repair code. No device or emulator is needed.
// Extra arguments go to Gradle, for example `npm run test:native -- --no-daemon` so that
// HONVERT_FUZZ_ITERATIONS reaches the test JVM.
const path = require("path");
const { spawnSync } = require("child_process");

const androidDir = path.resolve(__dirname, "..", "android");
// An absolute path: cmd.exe does not always search the working folder for the .bat wrapper.
const wrapper = path.join(androidDir, process.platform === "win32" ? "gradlew.bat" : "gradlew");
const result = spawnSync(wrapper, [":honvert-engine:testDebugUnitTest", "--console=plain", ...process.argv.slice(2)], {
  cwd: androidDir,
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
