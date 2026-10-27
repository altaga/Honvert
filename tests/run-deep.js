// The deep run: one million generated cases per fuzz property, on the JavaScript side and the native side.
// It takes a while on a desktop. Pick another count with HONVERT_FUZZ_ITERATIONS=5000000 npm run test:deep.
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const env = { ...process.env, HONVERT_FUZZ_ITERATIONS: process.env.HONVERT_FUZZ_ITERATIONS || "1000000" };

const js = spawnSync("npx jest tests/fuzz", { cwd: root, stdio: "inherit", env, shell: true });
if (js.status !== 0) process.exit(js.status ?? 1);

// --no-daemon: a fresh Gradle process passes the environment on to the test JVM.
const wrapper = path.join(root, "android", process.platform === "win32" ? "gradlew.bat" : "gradlew");
const native = spawnSync(wrapper, [
  ":honvert-engine:testDebugUnitTest",
  "--console=plain",
  "--no-daemon",
], { cwd: path.join(root, "android"), stdio: "inherit", env, shell: true });
process.exit(native.status ?? 1);
