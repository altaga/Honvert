// Device test matrix: drives the real app on an emulator or phone through every tool, every setting value, every
// kind of input file, internal storage and the SD card, batches, errors, and a restart while the picker is open.
// Each result is auto-saved by the app (DCIM/Honvert or Download/Honvert), pulled back, and checked from its own
// bytes with tests/e2e/inspect_media.py: type, size in pixels, length, channels, frames, pages, encryption.
//
// Usage: node tests/e2e/matrix.js [--serial emulator-5554] [--only image,audio] [--match <regex>] [--fixtures <dir>] [--py <dir>]
//   --match     run only the cases whose name matches, for example --match "AAC|extract|compress"
//   --fixtures  where tests/e2e/fixtures.py wrote the input files (it is run when the folder is missing)
//   --py        extra PYTHONPATH for pillow-heif, lameenc, tinytag and hachoir
// Needs adb, Python 3 with those packages, a device with an SD card (the emulator has one), and the app installed.
// Writes a JSON report next to the fixtures and exits non-zero when any case fails.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const PACKAGE = "com.honvert.app";
const args = process.argv.slice(2);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const serial = valueOf("--serial") ?? "emulator-5554";
const only = valueOf("--only")?.split(",");
const match = valueOf("--match") ? new RegExp(valueOf("--match"), "i") : null;
const fixtures = path.resolve(valueOf("--fixtures") ?? path.join(os.tmpdir(), "honvert-matrix-fixtures"));
const pyPath = valueOf("--py");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "honvert-matrix-"));

const en = new Function(
  fs.readFileSync(path.join(ROOT, "src", "i18n", "locales", "en.js"), "utf8").replace(/^export default/m, "return"),
)();
const ERROR_TEXTS = Object.entries(en)
  .filter(([key]) => key.startsWith("error.") || key === "pick.failed" || key === "save.autoFailed" || key === "open.noApp")
  .map(([key, text]) => [key, text.toLowerCase()]);

const adb = (...parts) => execFileSync("adb", ["-s", serial, ...parts], { encoding: "utf8", maxBuffer: 1 << 26 });
const shell = (command) => adb("shell", command);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const log = (message) => console.log(`[matrix] ${message}`);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const python = (script, ...rest) =>
  execFileSync("python", [path.join(__dirname, script), ...rest], {
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: [pyPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
    maxBuffer: 1 << 26,
  });

// ---------------------------------------------------------------- screen helpers (same approach as run.js)
const decode = (text) =>
  text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// uiautomator refuses to dump while the screen animates ("could not get idle state"), so retry a few times.
function readScreen() {
  let xml = "";
  for (let attempt = 0; attempt < 6 && !xml.includes("<hierarchy"); attempt++) {
    try {
      // One adb call: the tree is printed straight to the output instead of a file on the device.
      xml = adb("exec-out", "uiautomator", "dump", "/dev/tty");
    } catch {
      sleep(500);
    }
  }
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
      top: y1,
      bottom: y2,
    };
  });
}

function waitFor(description, test, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = readScreen().find(test);
    if (found) return found;
    sleep(400);
  }
  throw new Error(`timed out waiting for ${description}`);
}

const tap = (node) => shell(`input tap ${node.x} ${node.y}`);
const longPress = (node) => shell(`input swipe ${node.x} ${node.y} ${node.x} ${node.y} 900`);
// Swipes run along the left margin, which scrolls the screen without touching a control: a swipe that starts
// on a text field focuses it and the keyboard then hides half the screen.
const SWIPE_X = 36;
const swipeUp = (distance = 900) => shell(`input swipe ${SWIPE_X} 2200 ${SWIPE_X} ${2200 - distance} 450`);
const swipeDown = (distance = 900) => shell(`input swipe ${SWIPE_X} 900 ${SWIPE_X} ${900 + distance} 450`);
const keyboardShown = () => /mInputShown=true/.test(shell("dumpsys input_method | grep mInputShown || true"));
function hideKeyboard() {
  if (keyboardShown()) {
    shell("input keyevent KEYCODE_BACK");
    sleep(400);
  }
}
const is = (label) => (node) => same(node.text, label) || same(node.desc, label);
const inApp = (test) => (node) => node.pkg === PACKAGE && test(node);
const inPicker = (test) => (node) => node.pkg.includes("documentsui") && test(node);

function scrollToTop() {
  for (let i = 0; i < 3; i++) shell(`input swipe ${SWIPE_X} 700 ${SWIPE_X} 2700 120`);
  sleep(400);
}

// Scrolls the converter until a node is in the clear area between the header and the bottom bar. What is
// already on screen is checked first, so nothing scrolls when the control is in view.
function scrollIntoView(description, test, { from = "top" } = {}) {
  hideKeyboard();
  const here = readScreen();
  const visible = here.find(test);
  if (visible && visible.y > 520 && visible.y < 2000) return { found: visible, screen: here };
  if (from === "top") scrollToTop();
  let lastY = null;
  for (let attempt = 0; attempt < 14; attempt++) {
    const screen = readScreen();
    const found = screen.find(test);
    if (found && found.y > 520 && found.y < 2000) return { found, screen };
    // A short screen cannot scroll its last control any higher: take it if it is above the bottom bar.
    if (found && lastY !== null && Math.abs(found.y - lastY) <= 12 && found.y < 2520) return { found, screen };
    lastY = found?.y ?? null;
    if (found && found.y <= 520) swipeDown(500);
    else swipeUp(700);
    sleep(350);
  }
  // The layout can still be settling (a file was just picked): use the control if it is in view at all.
  const screen = readScreen();
  const found = screen.find(test);
  if (found && found.y > 300 && found.y < 2520) return { found, screen };
  throw new Error(`could not scroll to ${description}`);
}

// ---------------------------------------------------------------- app navigation
function launch() {
  shell(`am force-stop ${PACKAGE}`);
  shell(`am start -n ${PACKAGE}/.MainActivity`);
  waitFor("the home screen", inApp(is(en["cat.image.title"])), 20000);
}

function openTool(kind) {
  launch();
  const title = en[`cat.${kind}.title`];
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = readScreen().find(inApp(is(title)));
    if (row && row.y < 2600) {
      tap(row);
      waitFor(`the ${kind} screen`, inApp((node) => node.text === title && node.y < 500), 10000);
      return;
    }
    swipeUp(900);
    sleep(400);
  }
  throw new Error(`no ${kind} row on the home screen`);
}

// Opens a root of the system picker. The drawer slides in, so wait for the root's row inside the drawer (not the
// breadcrumb with the same name), tap it, and confirm the picker now lists that root.
function openRoot(root) {
  // The toolbar title names the open folder ("Downloads", or "m-image" inside it); the list header does not
  // change in subfolders, and the picker reopens the last folder used, so only the title proves where we are.
  const listing = inPicker((node) => node.text === root && node.y < 300);
  for (let attempt = 0; attempt < 5; attempt++) {
    const drawer = readScreen().find((node) => node.pkg.includes("documentsui") && /show roots|navigation|menu/i.test(node.desc));
    if (drawer) tap(drawer);
    let item = null;
    for (let wait = 0; wait < 8 && !item; wait++) {
      sleep(400);
      item = readScreen().find(inPicker((node) => same(node.text, root) && node.x > 300 && node.y > 450));
    }
    if (item) {
      tap(item);
      for (let wait = 0; wait < 10; wait++) {
        sleep(500);
        if (readScreen().find(listing)) return;
      }
    }
  }
  throw new Error(`no ${root} in the picker`);
}

function openFolder(name) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const folder = readScreen().find(inPicker(is(name)));
    if (folder) {
      tap(folder);
      // The toolbar title switches to the folder's name.
      waitFor(`folder ${name}`, inPicker((node) => node.text === name && node.y < 300), 8000);
      return;
    }
    shell("input swipe 672 2400 672 1400 400");
    sleep(500);
  }
  throw new Error(`no folder ${name} in the picker`);
}

function findInPicker(name) {
  for (let attempt = 0; attempt < 6; attempt++) {
    // Grid tiles of pictures carry the name only in their description: "photo.jpg, 56 kB, 7:10 PM".
    const file = readScreen().find(inPicker((node) => node.text === name || node.desc.startsWith(`${name}, `)));
    if (file) return file;
    shell("input swipe 672 2400 672 1500 400");
    sleep(500);
  }
  throw new Error(`no ${name} in the picker`);
}

// Where test files live on the device. "internal" is Download/m-<tool>; "sd" is the SD card's Download/sd-<tool>.
// The names differ because the picker's Downloads root lists both cards' Download folders together.
const sdRoot = () => shell("ls /storage").split(/\s+/).find((name) => /^[0-9A-F]{4}-[0-9A-F]{4}$/.test(name));
const folderName = (location, folder) => (location === "sd" ? folder.replace(/^m-/, "sd-") : folder);
const deviceFolder = (location, folder) =>
  location === "sd" ? `/storage/${sdRoot()}/Download/${folderName(location, folder)}` : `/sdcard/Download/${folder}`;

// Picks files through the app's own picker. With `killWhileOpen`, Android kills the app while the picker is
// open, the way it does on phones short of memory; the files must still arrive.
function pickFiles({ location, folder, files, button = en["file.chooseMany"], killWhileOpen = false }) {
  const opener = waitFor("the choose button", inApp((node) => is(button)(node) || is(en["file.choose"])(node) || is(en["file.change"])(node)));
  tap(opener);
  waitFor("the system picker", (node) => node.pkg.includes("documentsui"), 15000);
  sleep(800);
  if (location === "sd") {
    openRoot("SDCARD");
    openFolder("Download");
  } else {
    openRoot("Downloads");
  }
  openFolder(folderName(location, folder));
  if (killWhileOpen) {
    shell(`am kill ${PACKAGE}`);
    sleep(800);
    if (shell(`pidof ${PACKAGE} || true`).trim()) throw new Error("the app was not killed");
  }
  if (files.length === 1) {
    tap(findInPicker(files[0]));
  } else {
    longPress(findInPicker(files[0]));
    sleep(600);
    for (const name of files.slice(1)) {
      tap(findInPicker(name));
      sleep(400);
    }
    tap(waitFor("the select button", inPicker((node) => /^select$/i.test(node.text) || /^select$/i.test(node.desc))));
  }
  const expected = files.length === 1 ? files[0].toUpperCase() : `${files.length} FILES`;
  waitFor(`the picked ${expected}`, inApp((node) => node.text.toUpperCase() === expected || node.text.toUpperCase().includes(expected)), 60000);
}

// Taps the chip `choice` in the group labeled `labelKey`. Chips are matched below their own label, so the same
// text in two groups ("High") never mixes up.
function setChoice(labelKey, choice) {
  const label = en[labelKey].toUpperCase();
  const isLabel = inApp((node) => node.text === label);
  let view;
  try {
    view = scrollIntoView(`the ${label} setting`, isLabel);
  } catch {
    scrollToTop();
    view = scrollIntoView("the advanced settings", inApp(is(en["settings.advanced"])), { from: "here" });
    tap(view.found);
    sleep(500);
    view = scrollIntoView(`the ${label} setting`, isLabel);
  }
  const top = view.found.y;
  const chips = view.screen
    .filter(inApp((node) => same(node.desc, choice) && node.y > top))
    .sort((a, b) => a.y - b.y);
  if (!chips.length) throw new Error(`no ${choice} under ${label}`);
  tap(chips[0]);
  sleep(350);
}

// Types into the field whose accessibility label is `label`, replacing what was there.
function setText(label, value) {
  const { found } = scrollIntoView(`the ${label} field`, inApp((node) => same(node.desc, label)));
  tap(found);
  sleep(400);
  shell("input keyevent KEYCODE_MOVE_END");
  for (let i = 0; i < 3; i++) shell(`input keyevent ${Array(15).fill("KEYCODE_DEL").join(" ")}`);
  if (value) shell(`input text '${value.replace(/ /g, "%s").replace(/'/g, "")}'`);
  sleep(300);
  // Back closes the keyboard; it is only pressed while the keyboard is up, or it would leave the screen.
  hideKeyboard();
}

// Starts the conversion and waits for the result or an error. Returns { message, error, notes }.
// The result can sit below the fold (a crop preview is tall), so once the job ends the screen is scrolled
// down and every visible text is collected.
function convert(timeout = 240000) {
  tap(waitFor("the convert button", inApp(is(en["action.convert"]))));
  const deadline = Date.now() + timeout;
  // The job shows its Cancel button a moment after the tap; until then the Convert button and the previous
  // result are still on screen, so first wait for the job to start. A very fast job may never show it; after
  // a few seconds the app has cleared the previous result either way.
  for (let wait = 0; wait < 6; wait++) {
    if (readScreen().some(inApp(is(en["action.cancel"])))) break;
    sleep(500);
  }
  while (Date.now() < deadline) {
    const screen = readScreen();
    const busy = screen.some(inApp(is(en["action.cancel"])));
    const ready = screen.some(inApp(is(en["action.convert"])));
    if (!busy && ready) break;
    sleep(1000);
  }
  if (Date.now() >= deadline) throw new Error("the conversion did not finish in time");
  const texts = new Set();
  for (let step = 0; step < 8; step++) {
    for (const node of readScreen()) if (node.pkg === PACKAGE && node.text) texts.add(node.text);
    const all = [...texts].map((text) => text.toLowerCase());
    const error = ERROR_TEXTS.find(([, text]) => all.some((line) => line.includes(text.slice(0, 40))));
    if (error) return { error: error[0], message: error[1], notes: [...texts] };
    const saved = [...texts].find((text) => text.includes(en["save.auto"].split("{")[0]));
    if (saved && all.some((line) => line.includes(en["file.done"].toLowerCase()))) return { message: saved, notes: [...texts] };
    swipeUp(800);
    sleep(400);
  }
  throw new Error("finished, but no result or error is on screen");
}

// The files the last conversion auto-saved: the newest `count` files in the folder the app reported.
function savedOutputs(message, count) {
  const folders = [...message.matchAll(/(DCIM|Download)\/Honvert\/[a-z-]+/g)].map((match) => match[0]);
  if (!folders.length) throw new Error(`no auto-save folder in "${message}"`);
  const listed = [];
  for (const folder of new Set(folders)) {
    const rows = shell(`ls -t /sdcard/${folder}/ 2>/dev/null || true`).split(/\r?\n/).filter(Boolean);
    for (const name of rows) listed.push({ folder, name, mtime: Number(shell(`stat -c %Y '/sdcard/${folder}/${name}'`).trim()) });
  }
  listed.sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  return listed.slice(0, count).map(({ folder, name }) => {
    const local = path.join(work, `${Date.now()}-${name}`);
    adb("pull", `/sdcard/${folder}/${name}`, local);
    return { name, folder, info: JSON.parse(python("inspect_media.py", local)) };
  });
}

// ---------------------------------------------------------------- checks
const near = (value, target, tolerance) => Math.abs(value - target) <= tolerance;
const expect = (problems, condition, text) => {
  if (!condition) problems.push(text);
};

function checkCommon(output, type) {
  const problems = [];
  expect(problems, output.info.size > 0, "empty file");
  expect(problems, !output.info.error, `unreadable: ${output.info.error}`);
  if (type) expect(problems, [].concat(type).includes(output.info.type), `type ${output.info.type}, expected ${type}`);
  return problems;
}

// ---------------------------------------------------------------- the matrix
// Each session opens a tool, picks files once, then runs its variants one after another. A variant sets some
// settings, converts, checks the results, and puts the settings back to the tool's defaults.
const T = (key) => en[key];
const sessions = [];
const session = (spec) => sessions.push(spec);

// --- Images
const IMAGE_FORMATS = { JPG: "jpg", PNG: "png", WEBP: "webp", TIFF: "tiff", BMP: "bmp", ICO: "ico" };
const dims = (w, h, tolerance = 2) => (out) => {
  const p = [];
  expect(p, near(out.info.width, w, tolerance) && near(out.info.height, h, tolerance), `size ${out.info.width}x${out.info.height}, expected ${w}x${h}`);
  return p;
};
session({
  kind: "image",
  location: "internal",
  folder: "m-image",
  files: ["photo.jpg"],
  variants: [
    ...Object.entries(IMAGE_FORMATS).map(([label, type]) => ({
      name: `format ${label}`,
      set: [["choice", "opt.format", label]],
      reset: [["choice", "opt.format", "JPG"]],
      check: (out) => [...checkCommon(out, type), ...(type === "ico" ? dims(256, 192)(out) : dims(1600, 1200)(out)), ...(out.info.exif ? ["metadata kept"] : [])],
    })),
    ...["ch.high", "ch.medium", "ch.low"].map((key) => ({
      name: `quality ${T(key)}`,
      set: [["choice", "opt.quality", T(key)]],
      reset: [["choice", "opt.quality", T("ch.high")]],
      check: (out) => checkCommon(out, "jpg"),
    })),
    ...[[75, 1200, 900], [50, 800, 600], [25, 400, 300]].map(([percent, w, h]) => ({
      name: `size ${percent}%`,
      set: [["choice", "opt.size", `${percent}%`]],
      reset: [["choice", "opt.size", "100%"]],
      check: (out) => [...checkCommon(out, "jpg"), ...dims(w, h)(out)],
    })),
    ...[["800", "", 800, 600], ["", "300", 400, 300], ["500", "500", 500, 500]].map(([w, h, ew, eh]) => ({
      name: `exact pixels ${w || "auto"}x${h || "auto"}`,
      set: [["choice", "opt.size", T("ch.custom")], ["text", T("opt.pixelWidth"), w], ["text", T("opt.pixelHeight"), h]],
      reset: [["text", T("opt.pixelWidth"), ""], ["text", T("opt.pixelHeight"), ""], ["choice", "opt.size", "100%"]],
      check: (out) => [...checkCommon(out, "jpg"), ...dims(ew, eh)(out)],
    })),
    ...[[T("ch.free"), 1600, 1200], ["1:1", 1200, 1200], ["4:3", 1600, 1200], ["16:9", 1600, 900], ["9:16", 674, 1200]].map(([ratio, w, h]) => ({
      name: `crop ${ratio}`,
      set: [["choice", "opt.crop", ratio]],
      reset: [["choice", "opt.crop", T("ch.original")]],
      check: (out) => [...checkCommon(out, "jpg"), ...dims(w, h, 4)(out)],
    })),
    ...[["90°", 1200, 1600], ["180°", 1600, 1200], ["270°", 1200, 1600]].map(([angle, w, h]) => ({
      name: `rotate ${angle}`,
      set: [["choice", "opt.rotate", angle]],
      reset: [["choice", "opt.rotate", "0°"]],
      check: (out) => [...checkCommon(out, "jpg"), ...dims(w, h)(out)],
    })),
    ...["ch.flipHorizontal", "ch.flipVertical"].map((key) => ({
      name: `mirror ${T(key)}`,
      set: [["choice", "opt.flip", T(key)]],
      reset: [["choice", "opt.flip", T("ch.none")]],
      check: (out) => [...checkCommon(out, "jpg"), ...dims(1600, 1200)(out)],
    })),
    {
      name: "PNG + 50% + 1:1 + 90° + mirror together",
      set: [["choice", "opt.format", "PNG"], ["choice", "opt.size", "50%"], ["choice", "opt.crop", "1:1"], ["choice", "opt.rotate", "90°"], ["choice", "opt.flip", T("ch.flipVertical")]],
      reset: [["choice", "opt.format", "JPG"], ["choice", "opt.size", "100%"], ["choice", "opt.crop", T("ch.original")], ["choice", "opt.rotate", "0°"], ["choice", "opt.flip", T("ch.none")]],
      check: (out) => [...checkCommon(out, "png"), ...dims(600, 600)(out)],
    },
  ],
});
// Every accepted input type, converted with the defaults (JPG, high quality).
for (const [file, w, h] of [
  ["photo.png", 800, 600], ["photo.webp", 1600, 1200], ["photo.bmp", 1600, 1200], ["photo.tiff", 1600, 1200],
  ["photo.heic", 1600, 1200], ["photo.avif", 1600, 1200], ["anim.gif", 320, 240], ["photo-exif6.jpg", 1200, 1600],
]) {
  session({ kind: "image", location: "internal", folder: "m-image", files: [file], variants: [{ name: `input ${file}`, check: (out) => [...checkCommon(out, "jpg"), ...dims(w, h)(out)] }] });
}
session({ kind: "image", location: "internal", folder: "m-image", files: ["huge.jpg"], variants: [{ name: "35 MP JPG keeps its full size", check: (out) => [...checkCommon(out, "jpg"), ...dims(7000, 5000)(out)] }] });
session({
  kind: "image",
  location: "internal",
  folder: "m-image",
  files: ["huge.webp"],
  variants: [{
    name: "35 MP WEBP is limited to 24 MP with a note",
    check: (out, result) => {
      const p = checkCommon(out, "jpg");
      expect(p, out.info.width * out.info.height <= 24_000_000 + 5000, `${out.info.width}x${out.info.height} is over 24 MP`);
      expect(p, result.notes.some((note) => note.includes(T("result.downscaled").slice(0, 30))), "no downscale note");
      return p;
    },
  }],
});
session({ kind: "image", location: "sd", folder: "m-image", files: ["photo.jpg"], variants: [{ name: "from the SD card", check: (out) => [...checkCommon(out, "jpg"), ...dims(1600, 1200)(out)] }] });
session({ kind: "image", location: "sd", folder: "m-image", files: ["photo.heic"], variants: [{ name: "HEIC from the SD card", check: (out) => [...checkCommon(out, "jpg"), ...dims(1600, 1200)(out)] }] });
session({ kind: "image", location: "sd", folder: "m-image", files: ["photo.png"], killWhileOpen: true, variants: [{ name: "app killed while the picker is open (SD)", check: (out) => checkCommon(out, "jpg") }] });
session({
  kind: "image",
  location: "internal",
  folder: "m-image",
  files: ["photo.jpg", "photo.png", "photo.webp"],
  variants: [{ name: "batch of 3", outputs: 3, check: (out) => checkCommon(out, "jpg") }],
});

// --- Video (source: 1280x720, 4 s, with sound)
const VIDEO_FORMATS = { MP4: "mp4", MKV: "mkv", MOV: "mov", AVI: "avi", WEBM: "webm" };
const videoCheck = (type, { w = 1280, h = 720, ms = 4000, audio = true } = {}) => (out) => {
  const p = checkCommon(out, type);
  if (out.info.width) expect(p, near(out.info.width, w, 4) && near(out.info.height, h, 4), `size ${out.info.width}x${out.info.height}, expected ${w}x${h}`);
  if (out.info.durationMs) expect(p, near(out.info.durationMs, ms, 400), `length ${out.info.durationMs} ms, expected ${ms}`);
  expect(p, Boolean(out.info.hasAudio) === audio, audio ? "sound missing" : "sound still there");
  return p;
};
session({
  kind: "video",
  location: "internal",
  folder: "m-video",
  files: ["clip.avi"],
  variants: [
    ...Object.entries(VIDEO_FORMATS).map(([label, type]) => ({
      name: `format ${label}`,
      set: [["choice", "opt.format", label]],
      reset: [["choice", "opt.format", "MP4"]],
      check: videoCheck(type),
    })),
    ...[[T("ch.original"), 1280, 720], ["4K", 1280, 720], ["1080p", 1280, 720], ["480p", 854, 480], ["360p", 640, 360]].map(([label, w, h]) => ({
      name: `resolution ${label}`,
      set: [["choice", "opt.resolution", label]],
      reset: [["choice", "opt.resolution", "720p"]],
      check: videoCheck("mp4", { w, h }),
    })),
    ...["ch.max", "ch.high", "ch.low"].map((key) => ({
      name: `quality ${T(key)}`,
      set: [["choice", "opt.quality", T(key)]],
      reset: [["choice", "opt.quality", T("ch.medium")]],
      check: videoCheck("mp4"),
    })),
    ...["24", "30", "60"].map((fps) => ({
      name: `${fps} fps`,
      set: [["choice", "opt.fps", fps]],
      reset: [["choice", "opt.fps", T("ch.original")]],
      check: videoCheck("mp4"),
    })),
    ...[["0.5x", 8000], ["2x", 2000]].map(([speed, ms]) => ({
      name: `speed ${speed}`,
      set: [["choice", "opt.speed", speed]],
      reset: [["choice", "opt.speed", "1x"]],
      check: videoCheck("mp4", { ms }),
    })),
    ...[[T("ch.free"), 1280, 720], ["1:1", 720, 720], ["9:16", 404, 720], ["4:3", 960, 720]].map(([ratio, w, h]) => ({
      name: `crop ${ratio}`,
      set: [["choice", "opt.crop", ratio]],
      reset: [["choice", "opt.crop", T("ch.original")]],
      check: videoCheck("mp4", { w, h }),
    })),
    ...[["90°", 720, 1280], ["180°", 1280, 720], ["270°", 720, 1280]].map(([angle, w, h]) => ({
      name: `rotate ${angle}`,
      set: [["choice", "opt.rotate", angle]],
      reset: [["choice", "opt.rotate", "0°"]],
      check: videoCheck("mp4", { w, h }),
    })),
    ...["ch.flipHorizontal", "ch.flipVertical"].map((key) => ({
      name: `mirror ${T(key)}`,
      set: [["choice", "opt.flip", T(key)]],
      reset: [["choice", "opt.flip", T("ch.none")]],
      check: videoCheck("mp4"),
    })),
    { name: "no sound", set: [["choice", "opt.audio", T("ch.noAudio")]], reset: [["choice", "opt.audio", T("ch.withAudio")]], check: videoCheck("mp4", { audio: false }) },
    { name: "even out volume", set: [["choice", "opt.normalize", T("ch.on")]], reset: [["choice", "opt.normalize", T("ch.off")]], check: videoCheck("mp4") },
    { name: "keep metadata", set: [["choice", "opt.metadata", T("ch.keep")]], reset: [["choice", "opt.metadata", T("ch.remove")]], check: videoCheck("mp4") },
    { name: "CPU encoder", set: [["choice", "opt.encoder", T("ch.cpu")]], reset: [["choice", "opt.encoder", T("ch.gpu")]], check: videoCheck("mp4") },
    { name: "trim 0:01 to 0:03", set: [["text", T("trim.start"), "0:01"], ["text", T("trim.end"), "0:03"]], reset: [["text", T("trim.start"), ""], ["text", T("trim.end"), ""]], check: videoCheck("mp4", { ms: 2000 }) },
  ],
});
session({ kind: "video", location: "internal", folder: "m-video", files: ["anim.gif"], variants: [{ name: "input GIF", check: videoCheck("mp4", { w: 320, h: 240, ms: 1600, audio: false }) }] });
session({ kind: "video", location: "sd", folder: "m-video", files: ["clip.avi"], variants: [{ name: "from the SD card", check: videoCheck("mp4") }] });
session({ kind: "video", location: "internal", folder: "m-video", files: ["clip.avi", "anim.gif"], variants: [{ name: "batch of 2", outputs: 2, check: (out) => checkCommon(out, "mp4") }] });

// --- GIF
const gifCheck = ({ w = 480, frames, loop } = {}) => (out) => {
  const p = checkCommon(out, "gif");
  expect(p, near(out.info.width, w, 2), `width ${out.info.width}, expected ${w}`);
  if (frames) expect(p, near(out.info.frames, frames[0], frames[1]), `${out.info.frames} frames, expected about ${frames[0]}`);
  if (loop !== undefined) expect(p, out.info.loop === loop, `loop ${out.info.loop}, expected ${loop}`);
  return p;
};
session({
  kind: "gif",
  location: "internal",
  folder: "m-video",
  files: ["clip.avi"],
  variants: [
    { name: "defaults (15 fps, 480 px)", check: gifCheck({ frames: [60, 3], loop: 0 }) },
    ...[["10", 40], ["24", 96]].map(([fps, frames]) => ({ name: `${fps} fps`, set: [["choice", "opt.fps", fps]], reset: [["choice", "opt.fps", "15"]], check: gifCheck({ frames: [frames, 3] }) })),
    ...[["320", 320], ["720", 720]].map(([label, w]) => ({ name: `width ${label}`, set: [["choice", "opt.width", label]], reset: [["choice", "opt.width", "480"]], check: gifCheck({ w }) })),
    ...[["0.5x", 120], ["2x", 30]].map(([speed, frames]) => ({ name: `speed ${speed}`, set: [["choice", "opt.speed", speed]], reset: [["choice", "opt.speed", "1x"]], check: gifCheck({ frames: [frames, 4] }) })),
    { name: "crop 1:1", set: [["choice", "opt.crop", "1:1"]], reset: [["choice", "opt.crop", T("ch.original")]], check: (out) => [...gifCheck()(out), ...(near(out.info.height, 480, 2) ? [] : [`height ${out.info.height}`])] },
    { name: "reverse", set: [["choice", "opt.playback", T("ch.reverse")]], reset: [["choice", "opt.playback", T("ch.forward")]], check: gifCheck({ frames: [60, 3] }) },
    { name: "boomerang", set: [["choice", "opt.playback", T("ch.boomerang")]], reset: [["choice", "opt.playback", T("ch.forward")]], check: gifCheck({ frames: [120, 5] }) },
    { name: "play once", set: [["choice", "opt.loop", T("ch.once")]], reset: [["choice", "opt.loop", T("ch.forever")]], check: gifCheck({ loop: undefined }) },
    { name: "play 3x", set: [["choice", "opt.loop", "3x"]], reset: [["choice", "opt.loop", T("ch.forever")]], check: gifCheck({ loop: 2 }) },
    ...["128", "64", "32"].map((colors) => ({ name: `${colors} colors`, set: [["choice", "opt.colors", colors]], reset: [["choice", "opt.colors", "256"]], check: gifCheck() })),
    ...["ch.ditherSmooth", "ch.none"].map((key) => ({ name: `dither ${T(key)}`, set: [["choice", "opt.dither", T(key)]], reset: [["choice", "opt.dither", T("ch.ditherPattern")]], check: gifCheck() })),
    { name: "trim 0:01 to 0:03", set: [["text", T("trim.start"), "0:01"], ["text", T("trim.end"), "0:03"]], reset: [["text", T("trim.start"), ""], ["text", T("trim.end"), ""]], check: gifCheck({ frames: [30, 3] }) },
  ],
});
session({ kind: "gif", location: "internal", folder: "m-video", files: ["anim.gif"], variants: [{ name: "input GIF", check: gifCheck({ w: 320 }) }] });
session({ kind: "gif", location: "sd", folder: "m-video", files: ["clip.avi"], variants: [{ name: "from the SD card", check: gifCheck() }] });

// --- Audio (source: 6 s stereo WAV)
const AUDIO_FORMATS = { MP3: "mp3", M4A: ["m4a", "mp4"], AAC: "aac", OPUS: "ogg", OGG: "ogg", WAV: "wav", FLAC: "flac", ALAC: ["m4a", "mp4"] };
const audioCheck = (type, { ms = 6000, channels } = {}) => (out) => {
  const p = checkCommon(out, type);
  if (out.info.durationMs) expect(p, near(out.info.durationMs, ms, 450), `length ${out.info.durationMs} ms, expected ${ms}`);
  if (channels && out.info.channels) expect(p, out.info.channels === channels, `${out.info.channels} channels, expected ${channels}`);
  return p;
};
session({
  kind: "audio",
  location: "internal",
  folder: "m-audio",
  files: ["tone.wav"],
  variants: [
    ...Object.entries(AUDIO_FORMATS).map(([label, type]) => ({ name: `format ${label}`, set: [["choice", "opt.format", label]], reset: [["choice", "opt.format", "MP3"]], check: audioCheck(type) })),
    ...["96", "192", "320"].map((kbps) => ({
      name: `${kbps} kbps`,
      set: [["choice", "opt.bitrate", kbps]],
      reset: [["choice", "opt.bitrate", "128"]],
      check: (out) => [...audioCheck("mp3")(out), ...(near(out.info.bitrate, Number(kbps), 12) ? [] : [`bitrate ${out.info.bitrate}`])],
    })),
    ...[["0.5x", 12000], ["0.75x", 8000], ["1.25x", 4800], ["1.5x", 4000], ["2x", 3000]].map(([speed, ms]) => ({ name: `speed ${speed}`, set: [["choice", "opt.speed", speed]], reset: [["choice", "opt.speed", "1x"]], check: audioCheck("mp3", { ms }) })),
    { name: "mono", set: [["choice", "opt.channels", T("ch.mono")]], reset: [["choice", "opt.channels", T("ch.original")]], check: audioCheck("mp3", { channels: 1 }) },
    { name: "stereo", set: [["choice", "opt.channels", T("ch.stereo")]], reset: [["choice", "opt.channels", T("ch.original")]], check: audioCheck("mp3", { channels: 2 }) },
    { name: "even out volume", set: [["choice", "opt.normalize", T("ch.on")]], reset: [["choice", "opt.normalize", T("ch.off")]], check: audioCheck("mp3") },
    { name: "trim 0:01 to 0:04", set: [["text", T("trim.start"), "0:01"], ["text", T("trim.end"), "0:04"]], reset: [["text", T("trim.start"), ""], ["text", T("trim.end"), ""]], check: audioCheck("mp3", { ms: 3000 }) },
    {
      name: "tags",
      set: [["text", T("opt.tagTitle"), "Honvert Test"], ["text", T("opt.tagArtist"), "Matrix"], ["text", T("opt.tagAlbum"), "Device"], ["text", T("opt.tagYear"), "2026"]],
      reset: [["text", T("opt.tagTitle"), ""], ["text", T("opt.tagArtist"), ""], ["text", T("opt.tagAlbum"), ""], ["text", T("opt.tagYear"), ""]],
      check: (out) => {
        const p = audioCheck("mp3")(out);
        expect(p, out.info.title === "Honvert Test" && out.info.artist === "Matrix" && out.info.album === "Device" && String(out.info.year).startsWith("2026"), `tags ${out.info.title}/${out.info.artist}/${out.info.album}/${out.info.year}`);
        return p;
      },
    },
  ],
});
session({ kind: "audio", location: "internal", folder: "m-audio", files: ["tone.mp3"], variants: [{ name: "input MP3", check: audioCheck("mp3") }] });
session({ kind: "audio", location: "internal", folder: "m-video", files: ["clip.avi"], variants: [{ name: "sound from a video", check: audioCheck("mp3", { ms: 4000 }) }] });
session({ kind: "audio", location: "sd", folder: "m-audio", files: ["tone.mp3"], variants: [{ name: "from the SD card", check: audioCheck("mp3") }] });
session({ kind: "audio", location: "sd", folder: "m-audio", files: ["tone.mp3"], killWhileOpen: true, variants: [{ name: "app killed while the picker is open (SD)", check: audioCheck("mp3") }] });
session({ kind: "audio", location: "internal", folder: "m-audio", files: ["tone.wav", "tone.mp3"], variants: [{ name: "batch of 2", outputs: 2, check: (out) => checkCommon(out, "mp3") }] });

// --- PDF
const pdfCheck = ({ pages, encrypted = false, rotated } = {}) => (out) => {
  const p = checkCommon(out, "pdf");
  // An encrypted PDF can hide its page count (null); its encryption is what that case checks.
  if (pages !== undefined && out.info.pages !== null) expect(p, out.info.pages === pages, `${out.info.pages} pages, expected ${pages}`);
  expect(p, out.info.encrypted === encrypted, encrypted ? "not encrypted" : "encrypted");
  if (rotated !== undefined) expect(p, out.info.rotations.filter((r) => r % 360 !== 0).length === rotated, `rotated pages ${JSON.stringify(out.info.rotations)}`);
  return p;
};
session({ kind: "pdf", mode: "mode.imagesToPdf", location: "internal", folder: "m-image", files: ["photo.jpg", "photo.png"], variants: [{ name: "images to PDF", check: pdfCheck({ pages: 2 }) }] });
session({ kind: "pdf", mode: "mode.merge", location: "internal", folder: "m-pdf", files: ["doc3.pdf", "doc2.pdf"], variants: [{ name: "merge", check: pdfCheck({ pages: 5 }) }] });
session({ kind: "pdf", mode: "mode.split", location: "internal", folder: "m-pdf", files: ["doc3.pdf"], variants: [{ name: "split", outputs: 3, check: pdfCheck({ pages: 1 }) }] });
session({
  kind: "pdf",
  mode: "mode.extract",
  location: "internal",
  folder: "m-pdf",
  files: ["doc3.pdf"],
  variants: [
    { name: "extract 2-3", set: [["text", T("opt.pages"), "2-3"]], check: pdfCheck({ pages: 2 }) },
    { name: "extract a page that does not exist", set: [["text", T("opt.pages"), "9"]], expectError: "error.pdfPages" },
  ],
});
session({ kind: "pdf", mode: "mode.organize", location: "internal", folder: "m-pdf", files: ["doc3.pdf"], variants: [{ name: "reorder 3, 1 (drops 2)", set: [["text", T("opt.order"), "3,1"]], check: pdfCheck({ pages: 2 }) }] });
session({
  kind: "pdf",
  mode: "mode.rotate",
  location: "internal",
  folder: "m-pdf",
  files: ["doc3.pdf"],
  variants: [
    { name: "rotate every page 90°", check: pdfCheck({ pages: 3, rotated: 3 }) },
    { name: "rotate page 2 by 180°", set: [["choice", "opt.rotate", "180°"], ["text", T("opt.pages"), "2"]], check: pdfCheck({ pages: 3, rotated: 1 }) },
  ],
});
session({
  kind: "pdf",
  mode: "mode.toImages",
  location: "internal",
  folder: "m-pdf",
  files: ["doc3.pdf"],
  variants: [
    { name: "pages to JPG", outputs: 3, check: (out) => checkCommon(out, "jpg") },
    { name: "pages to PNG", set: [["choice", "opt.format", "PNG"]], reset: [["choice", "opt.format", "JPG"]], outputs: 3, check: (out) => checkCommon(out, "png") },
  ],
});
session({
  kind: "pdf",
  mode: "mode.compress",
  location: "internal",
  folder: "m-pdf",
  files: ["doc3.pdf"],
  variants: ["ch.high", "ch.medium", "ch.low"].map((key) => ({ name: `compress ${T(key)}`, set: [["choice", "opt.quality", T(key)]], check: pdfCheck({ pages: 3 }) })),
});
session({
  kind: "pdf",
  mode: "mode.watermark",
  location: "internal",
  folder: "m-pdf",
  files: ["doc3.pdf"],
  variants: [
    { name: "watermark DRAFT 40%", set: [["text", T("opt.watermarkText"), "DRAFT"], ["choice", "opt.opacity", "40%"]], check: pdfCheck({ pages: 3 }) },
    { name: "watermark empty", set: [["text", T("opt.watermarkText"), ""]], expectError: "error.watermarkEmpty" },
  ],
});
session({ kind: "pdf", mode: "mode.protect", location: "internal", folder: "m-pdf", files: ["doc3.pdf"], variants: [{ name: "add a password", set: [["text", T("opt.password"), "abc123"]], check: pdfCheck({ pages: 3, encrypted: true }), keep: "protected" }] });
session({
  kind: "pdf",
  mode: "mode.unlock",
  location: "internal",
  folder: "m-pdf",
  files: ["protected.pdf"],
  variants: [
    { name: "wrong password", set: [["text", T("opt.password"), "nope"]], expectError: "error.pdfPassword" },
    { name: "remove the password", set: [["text", T("opt.password"), "abc123"]], check: pdfCheck({ pages: 3, encrypted: false }) },
  ],
});
session({ kind: "pdf", mode: "mode.merge", location: "sd", folder: "m-pdf", files: ["doc3.pdf", "doc2.pdf"], variants: [{ name: "merge from the SD card", check: pdfCheck({ pages: 5 }) }] });

// --- Repair
for (const [file, type] of [
  ["cut.jpg", "jpg"], ["prefixed.jpg", "jpg"], ["cut.png", "png"], ["cut.gif", "gif"], ["badxref.pdf", "pdf"],
  ["cut.zip", "zip"], ["cut.docx", "zip"], ["cut.mp3", "mp3"],
]) {
  session({ kind: "repair", location: "internal", folder: "m-repair", files: [file], variants: [{ name: `repair ${file}`, check: (out) => checkCommon(out, type) }] });
}
session({ kind: "repair", location: "sd", folder: "m-repair", files: ["cut.mp3"], variants: [{ name: "repair an MP3 from the SD card (reported bug)", check: (out) => checkCommon(out, "mp3") }] });
session({ kind: "repair", location: "sd", folder: "m-repair", files: ["cut.mp3"], killWhileOpen: true, variants: [{ name: "repair an MP3 from SD, app killed while picking", check: (out) => checkCommon(out, "mp3") }] });

// ---------------------------------------------------------------- setup and run
function pushFixtures() {
  if (!fs.existsSync(path.join(fixtures, "clip.avi"))) {
    log(`building fixtures in ${fixtures}`);
    python("fixtures.py", fixtures);
  }
  const groups = {
    "m-image": ["photo.jpg", "photo.png", "photo.webp", "photo.bmp", "photo.tiff", "photo.heic", "photo.avif", "anim.gif", "photo-exif6.jpg", "huge.jpg", "huge.webp"],
    "m-video": ["clip.avi", "anim.gif"],
    "m-audio": ["tone.wav", "tone.mp3"],
    "m-pdf": ["doc3.pdf", "doc2.pdf"],
    "m-repair": ["cut.jpg", "prefixed.jpg", "cut.png", "cut.gif", "badxref.pdf", "cut.zip", "cut.docx", "cut.mp3"],
  };
  // Forget rows left by earlier runs, or the picker lists stale duplicates.
  shell(`content delete --uri content://media/external/file --where "relative_path LIKE 'Download/m-%' OR relative_path LIKE 'Download/sd-%'" >/dev/null 2>&1 || true`);
  for (const location of ["internal", "sd"]) {
    for (const [folder, files] of Object.entries(groups)) {
      const target = deviceFolder(location, folder);
      shell(`rm -rf '${target}' && mkdir -p '${target}'`);
      for (const file of files) adb("push", path.join(fixtures, file), `${target}/${file}`);
      shell(`content call --method scan_volume --uri content://media --arg external_primary >/dev/null 2>&1 || true`);
    }
  }
  shell("rm -rf /sdcard/DCIM/Honvert /sdcard/Download/Honvert");
  // Index everything so the picker lists it.
  for (const location of ["internal", "sd"]) {
    for (const folder of Object.keys(groups)) {
      for (const file of groups[folder]) {
        shell(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d 'file://${deviceFolder(location, folder)}/${file}' >/dev/null 2>&1`);
      }
    }
  }
  sleep(3000);
}

function applySteps(steps = []) {
  for (const [kind, label, value] of steps) {
    if (kind === "choice") setChoice(label, value);
    else setText(label, value);
  }
}

function runSession(spec, results) {
  const title = `${spec.kind}${spec.mode ? `/${T(spec.mode)}` : ""} · ${spec.location} · ${spec.files.join("+")}`;
  adb("logcat", "-b", "crash", "-c");
  try {
    openTool(spec.kind);
    if (spec.mode) setChoice("opt.action", T(spec.mode));
    pickFiles({ location: spec.location, folder: spec.folder, files: spec.files, killWhileOpen: spec.killWhileOpen });
  } catch (error) {
    const crash = adb("logcat", "-d", "-b", "crash").includes(PACKAGE) ? " (the app crashed)" : "";
    adb("logcat", "-b", "crash", "-c");
    for (const variant of spec.variants) results.push({ session: title, variant: variant.name, ok: false, problems: [`setup: ${error.message}${crash}`] });
    log(`FAIL setup ${title}: ${error.message}`);
    return;
  }
  // Settings to put back before the next variant. A reset the next variant would overwrite anyway is skipped.
  let pending = [];
  const stepKey = ([, label]) => label;
  for (const variant of spec.variants) {
    const started = Date.now();
    let problems = [];
    try {
      const next = new Set((variant.set ?? []).map(stepKey));
      applySteps(pending.filter((step) => !next.has(stepKey(step))));
      pending = [];
      applySteps(variant.set);
      const result = convert();
      if (variant.expectError) {
        if (result.error !== variant.expectError) problems.push(`expected ${variant.expectError}, got ${result.error ?? "a result"}`);
      } else if (result.error) {
        problems.push(`error ${result.error}: ${result.message}`);
      } else {
        const outputs = savedOutputs(result.message, variant.outputs ?? 1);
        if (outputs.length < (variant.outputs ?? 1)) problems.push(`${outputs.length} files saved, expected ${variant.outputs ?? 1}`);
        for (const output of outputs) problems.push(...variant.check(output, result).map((text) => `${output.name}: ${text}`));
        if (variant.keep === "protected" && outputs[0]) {
          for (const location of ["internal", "sd"]) shell(`cp '/sdcard/${outputs[0].folder}/${outputs[0].name}' '${deviceFolder(location, "m-pdf")}/protected.pdf'`);
          shell(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d 'file://${deviceFolder("internal", "m-pdf")}/protected.pdf' >/dev/null 2>&1`);
        }
      }
      pending = variant.reset ?? [];
    } catch (error) {
      pending = variant.reset ?? [];
      problems.push(error.message);
    }
    if (adb("logcat", "-d", "-b", "crash").includes(PACKAGE)) {
      problems.push("the app crashed");
      adb("logcat", "-b", "crash", "-c");
    }
    const ok = problems.length === 0;
    results.push({ session: title, variant: variant.name, ok, problems, seconds: Math.round((Date.now() - started) / 1000) });
    log(`${ok ? "PASS" : "FAIL"} ${title} · ${variant.name}${ok ? "" : ` → ${problems.join("; ")}`}`);
    if (!ok && problems.some((text) => /timed out|could not scroll|no .* under/.test(text))) {
      // The screen is in an unknown state: restart the session for the remaining variants.
      try {
        openTool(spec.kind);
        if (spec.mode) setChoice("opt.action", T(spec.mode));
        pickFiles({ location: spec.location, folder: spec.folder, files: spec.files });
      } catch {
        break;
      }
    }
  }
}

function main() {
  if (!execFileSync("adb", ["devices"], { encoding: "utf8" }).includes(`${serial}\tdevice`)) throw new Error(`no device ${serial}`);
  if (!sdRoot()) throw new Error("no SD card on the device");
  pushFixtures();
  adb("logcat", "-b", "crash", "-c");
  const results = [];
  const order = ["image", "video", "gif", "audio", "pdf", "repair"];
  for (const kind of order) {
    if (only && !only.includes(kind)) continue;
    for (const spec of sessions.filter((item) => item.kind === kind)) {
      const variants = match ? spec.variants.filter((variant) => match.test(variant.name)) : spec.variants;
      if (variants.length) runSession({ ...spec, variants }, results);
    }
  }
  const report = path.join(fixtures, "..", `matrix-report-${Date.now()}.json`);
  fs.writeFileSync(report, JSON.stringify(results, null, 2));
  const failed = results.filter((result) => !result.ok);
  log(`${results.length - failed.length}/${results.length} passed. Report: ${report}`);
  for (const result of failed) log(`  FAIL ${result.session} · ${result.variant}: ${result.problems.join("; ")}`);
  process.exitCode = failed.length ? 1 : 0;
}

// Imported (for debugging one step), the module only exposes its helpers.
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[matrix] FAIL: ${error.message}`);
    process.exitCode = 1;
  }
} else {
  module.exports = { readScreen, scrollIntoView, setChoice, setText, convert, pickFiles, openTool };
}
