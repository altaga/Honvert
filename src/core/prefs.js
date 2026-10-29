import { getAsyncStorageValue, setAsyncStorageValue } from "../utilsApp/utils";

// Small per-device preferences, stored with the other settings.
// autoSave: finished files are also saved into the phone's Pictures, Movies, Music or Download folders.
export const prefs = { haptics: true, autoSave: true };

export async function loadPrefs() {
  try {
    const haptics = await getAsyncStorageValue("haptics", "Settings");
    if (typeof haptics === "boolean") prefs.haptics = haptics;
    const autoSave = await getAsyncStorageValue("autoSave", "Settings");
    if (typeof autoSave === "boolean") prefs.autoSave = autoSave;
  } catch {
    // Keep defaults when storage is unavailable.
  }
}

export async function setHaptics(value) {
  prefs.haptics = value;
  try {
    await setAsyncStorageValue({ haptics: value }, "Settings");
  } catch {
    // The choice still applies for this session.
  }
}

export async function setAutoSave(value) {
  prefs.autoSave = value;
  try {
    await setAsyncStorageValue({ autoSave: value }, "Settings");
  } catch {
    // The choice still applies for this session.
  }
}
