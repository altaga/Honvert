import AsyncStorage from "@react-native-async-storage/async-storage";

// Reads one key from a JSON object stored under `storage` (default "General").
export async function getAsyncStorageValue(label, storage = "General") {
  try {
    const session = await AsyncStorage.getItem(storage);
    const data = session ? JSON.parse(session) : {};
    return label in data ? data[label] : null;
  } catch {
    return null;
  }
}

// Merges `value` into the JSON object stored under `storage`.
export async function setAsyncStorageValue(value, storage = "General") {
  const session = await AsyncStorage.getItem(storage);
  const data = session ? JSON.parse(session) : {};
  await AsyncStorage.setItem(storage, JSON.stringify({ ...data, ...value }));
}
