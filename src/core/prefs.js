import { getAsyncStorageValue, setAsyncStorageValue } from "../utilsApp/utils";

// Small per-device preferences, stored with the other settings.
export const prefs = { haptics: true };

export async function loadPrefs() {
  try {
    const haptics = await getAsyncStorageValue("haptics", "Settings");
    if (typeof haptics === "boolean") prefs.haptics = haptics;
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
