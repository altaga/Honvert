// End-to-end check on a connected Android device or emulator. It repairs a damaged PDF inside the app, taps the
// download icon of the result, saves the copy into Documents, and checks that the file really arrived with a PDF
// header. The steps are found by their visible English text, read from src/i18n/locales/en.js, so the check follows
// any wording change. It leaves the saved copy on the device.
//
// Usage: node tests/e2e/run.js [--serial emulator-5554] [--install]
//   --install  install android/app/build/outputs/apk/release/app-release.apk first (keeps the app's data)
//
// Needs adb on PATH, one device or emulator, and the app installed (or --install with a release build).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const PACKAGE = "com.honvert.app";
const APK = path.join(ROOT, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
const SOURCE_NAME = "honvert-e2e-damaged.pdf";
const DEVICE_SOURCE = `/sdcard/Download/${SOURCE_NAME}`;
const TIMEOUT_MS = 30000;

const args = process.argv.slice(2);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const serial = valueOf("--serial") ?? "emulator-5554";
const install = args.includes("--install");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "honvert-e2e-"));

// Labels come from the app's own English strings, so the check follows any change of wording.
const en = new Function(
  fs.readFileSync(path.join(ROOT, "src", "i18n", "locales", "en.js"), "utf8").replace(/^export default/m, "return"),
)();

const adb = (...parts) => execFileSync("adb", ["-s", serial, ...parts], { encoding: "utf8", maxBuffer: 1 << 26 });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const log = (message) => console.log(`[e2e] ${message}`);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// A PDF whose cross-reference table is wrong, the kind of damage the repair tool exists for.
function damagedPdf() {
  let body = "%PDF-1.4\n";
  body += "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  body += "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n";
  body += "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n";
  body += "xref\n0 4\n0000000000 65535 f \n0000000001 00000 n \n0000000002 00000 n \n0000000003 00000 n \n";
  body += "trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n5\n%%EOF\n";
  return Buffer.from(body, "latin1");
}

const decode = (text) =>
  text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// One snapshot of the screen as a flat list of nodes with their visible text and centers.
function readScreen() {
  adb("shell", "uiautomator", "dump", "/sdcard/honvert-e2e.xml");
  const xml = adb("exec-out", "cat", "/sdcard/honvert-e2e.xml");
  return [...xml.matchAll(/<node ([^>]*)>/g)].map(([, attributes]) => {
    const attribute = (name) => decode(attributes.match(new RegExp(` ${name}="([^"]*)"`))?.[1] ?? "");
    const [x1, y1, x2, y2] = (attribute("bounds").match(/\d+/g) ?? [0, 0, 0, 0]).map(Number);
    return {
      text: attribute("text"),
      desc: attribute("content-desc"),
      pkg: attribute("package"),
      enabled: attribute("enabled") === "true",
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
    };
  });
}

function waitFor(description, test, timeout = TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  let screen = [];
  while (Date.now() < deadline) {
    screen = readScreen();
    const found = screen.find(test);
    if (found) return found;
    sleep(500);
  }
  const dump = path.join(work, "last-screen.txt");
  fs.writeFileSync(dump, screen.map((node) => `${node.pkg} | ${node.text} | ${node.desc}`).join("\n"));
  throw new Error(`timed out waiting for ${description}; the last screen is in ${dump}`);
}

// Scrolls a list down until the node shows up. The home list is longer than the screen.
function scrollTo(description, test, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const found = readScreen().find(test);
    if (found) return found;
    adb("shell", "input", "swipe", "672", "2000", "672", "900", "400");
    sleep(600);
  }
  throw new Error(`could not scroll to ${description}`);
}

// A node can be in the dump while it sits behind the bottom bar, so scroll until it is clearly above that bar.
function scrollUntilVisible(description, test, maxY = 2520, attempts = 8) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const found = readScreen().find((node) => test(node) && node.y < maxY);
    if (found) return found;
    adb("shell", "input", "swipe", "672", "2000", "672", "1200", "400");
    sleep(600);
  }
  throw new Error(`could not scroll ${description} into view`);
}

const tap = (node) => adb("shell", "input", "tap", String(node.x), String(node.y));
const is = (label) => (node) => same(node.text, label) || same(node.desc, label);
const startsWith = (prefix) => (node) => node.desc.toLowerCase().startsWith(prefix.toLowerCase());
const includes = (part) => (node) => node.text.toLowerCase().includes(part.toLowerCase());
const inApp = (test) => (node) => node.pkg === PACKAGE && test(node);
const inPicker = (test) => (node) => node.pkg.includes("documentsui") && test(node);

// The drawer button of the system pickers. Its label varies by Android version, so match a few known words.
const drawerButton = (screen) =>
  screen.find((node) => node.pkg.includes("documentsui") && /navigation|roots|menu/i.test(node.desc)) ?? { x: 84, y: 225 };

// Opens the roots drawer and waits for its slide-in animation to end, so the next tap lands on an item.
function openRoots() {
  tap(drawerButton(readScreen()));
  sleep(900);
}

function tryFor(test, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = readScreen().find(test);
    if (found) return found;
    sleep(500);
  }
  return null;
}

// Opens a root from the picker drawer and waits for its file list (its header reads "Files in <root>").
// A tap can be lost while the drawer animates, so the drawer is opened again when the list did not change.
function openRootList(root) {
  for (let attempt = 0; attempt < 3; attempt++) {
    openRoots();
    const item = readScreen().find(inPicker(is(root)));
    if (item) {
      tap(item);
      // Roots read "Files on <root>", folders read "Files in <folder>".
      if (tryFor(inPicker((node) => is(`Files on ${root}`)(node) || is(`Files in ${root}`)(node)), 8000)) return;
    }
  }
  throw new Error(`could not open the ${root} list in the picker`);
}

function main() {
  if (!execFileSync("adb", ["devices"], { encoding: "utf8" }).includes(`${serial}\tdevice`)) {
    throw new Error(`no device ${serial}; check adb devices`);
  }
  if (install) {
    adb("install", "-r", APK);
    log("installed the release APK");
  }
  try {
    adb("shell", "pm", "grant", PACKAGE, "android.permission.POST_NOTIFICATIONS");
  } catch {
    // Not installed yet, or the permission is not declared: the conversion still runs.
  }

  const source = path.join(work, SOURCE_NAME);
  fs.writeFileSync(source, damagedPdf());
  adb("push", source, DEVICE_SOURCE);
  log("put a damaged PDF in Downloads");

  adb("shell", "am", "force-stop", PACKAGE);
  adb("shell", "am", "start", "-n", `${PACKAGE}/.MainActivity`);
  tap(scrollTo("the Repair category", inApp(is(en["cat.repair.title"]))));

  tap(waitFor("the Choose files button", inApp(is(en["file.chooseMany"]))));
  waitFor("the document picker", (node) => node.pkg.includes("documentsui"));
  openRootList("Downloads");
  tap(waitFor("the damaged PDF", inPicker(is(SOURCE_NAME))));
  // Some picker versions wait for a confirm button after a tap; take it when it is there.
  const confirm = readScreen().find(inPicker((node) => is("Select")(node) || is("Done")(node)));
  if (confirm) tap(confirm);
  waitFor("the picked file on the repair screen", inApp(is(SOURCE_NAME)));
  log("picked the damaged PDF");

  tap(waitFor("the Convert button", inApp(is(en["action.convert"]))));
  waitFor("the finished result", inApp(includes(en["file.done"])));
  log("repair finished");

  const download = scrollUntilVisible("the download icon of the result", inApp(startsWith(`${en["action.download"]}: `)));
  tap(download);
  scrollUntilVisible("the save editor", inApp(is(en["save.nameLabel"])));
  log("opened the save editor with the default name");

  tap(scrollUntilVisible("the choose-folder button", inApp(is(en["save.choose"]))));
  waitFor("the folder picker", (node) => node.pkg.includes("documentsui"));
  openRootList("SDCARD");
  tap(waitFor("the Documents folder", inPicker(is("Documents"))));
  tap(waitFor("the use-folder button", inPicker((node) => is("USE THIS FOLDER")(node) && node.enabled)));

  // The first save into a folder asks for access; later saves skip this dialog.
  sleep(1500);
  const allow = readScreen().find(inPicker(is("ALLOW")));
  if (allow) tap(allow);

  waitFor("the save confirmation", inApp(includes(en["save.done"])));
  log("the app reports the save");

  const rows = adb("shell", "content", "query", "--uri", "content://media/external/file", "--projection", "_display_name:_data")
    .split("\n")
    .filter((line) => line.includes(`_display_name=${SOURCE_NAME.replace(".pdf", "")}-repaired-`) && line.includes(".pdf"));
  const dataPath = rows.length ? /_data=([^\s,]+)/.exec(rows.at(-1))?.[1] : undefined;
  if (!dataPath) throw new Error("the saved copy is not in MediaStore: check the Documents folder on the device");

  const pulled = path.join(work, "saved.pdf");
  adb("pull", dataPath, pulled);
  const header = fs.readFileSync(pulled).subarray(0, 5).toString("latin1");
  if (header !== "%PDF-") throw new Error(`the saved file does not start with %PDF- (found ${JSON.stringify(header)})`);

  if (adb("logcat", "-d", "-b", "crash").includes(PACKAGE)) throw new Error("the app crashed during the run");
  log(`PASS: saved ${dataPath} (valid PDF header, ${fs.statSync(pulled).size} bytes)`);
}

try {
  main();
} catch (error) {
  console.error(`[e2e] FAIL: ${error.message}`);
  process.exitCode = 1;
}
