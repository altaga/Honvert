import { PermissionsAndroid, Platform } from "react-native";

// Android 13+ asks before an app may show notifications. Conversions run either way: without the
// permission the foreground service still protects them, only the progress notification is hidden.
export async function requestNotificationPermission() {
  if (Platform.OS !== "android" || Platform.Version < 33) return true;
  try {
    const result = await PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS");
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}
