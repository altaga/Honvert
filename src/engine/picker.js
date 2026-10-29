// File picking through the app's own picker activity (PickerActivity.kt). If Android kills the app while the
// system picker is open, the picked files are kept on disk; the app reopens the converter they were for.
import { pickFiles, takePendingPick } from "../../modules/honvert-engine";

// Parses the native JSON result. Anything unreadable counts as a cancel.
export function parsePick(json) {
  try {
    const result = JSON.parse(json);
    const tag = typeof result.tag === "string" && result.tag ? JSON.parse(result.tag) : {};
    const files = Array.isArray(result.files)
      ? result.files
          .filter((file) => file && typeof file.path === "string" && file.path)
          .map((file) => ({
            name: String(file.name || file.path.split("/").pop()),
            path: file.path,
            mime: String(file.mime || ""),
            size: Number(file.size) || 0,
          }))
      : [];
    return { canceled: Boolean(result.canceled) || !files.length, files, tag, failed: result.error === "unreadable" };
  } catch {
    return { canceled: true, files: [], tag: {}, failed: false };
  }
}

// Opens the picker. `tag` says where the files go ({ kind, mode, slot }) in case the app restarts meanwhile.
export async function pick(types, multiple, tag) {
  return parsePick(await pickFiles(types, multiple, JSON.stringify(tag)));
}

let restored = null;

// Called once when the app starts: returns the converter route to reopen, or null.
export function restorePendingPick() {
  let json = null;
  try {
    json = takePendingPick();
  } catch {
    return null;
  }
  if (!json) return null;
  const result = parsePick(json);
  if (result.canceled || !result.tag.kind) return null;
  restored = result;
  return `/convert/${result.tag.kind}`;
}

// Hands the restored files to the converter they were picked for, once.
export function takeRestoredPick(kind) {
  if (!restored || restored.tag.kind !== kind) return null;
  const result = restored;
  restored = null;
  return result;
}
