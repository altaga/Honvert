// Strings the native conversion service shows in its notification. The conversion screen sets them
// in the active language right before each conversion starts.
let labels = {
  title: "Honvert",
  processing: "Processing",
  cancel: "Cancel",
  done: "Conversion finished",
};

export function setEngineLabels(next) {
  labels = { ...labels, ...next };
}

export function getEngineLabels() {
  return labels;
}
