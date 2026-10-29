import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Image, PanResponder, StyleSheet, View } from "react-native";
import { colors } from "../core/theme";
import { moveRect, resizeRect } from "../engine/crop";
import { fileUri } from "../engine/jobs";

const HANDLE = 28;
const CORNERS = ["tl", "tr", "bl", "br"];
// Portrait pictures get a fixed height so they don't push the settings off screen; landscape ones fill the width.
const TALL_HEIGHT = 380;

// One responder per drag target. They read the latest props through `read` when a finger moves, so they are
// built once and a drag is never cut short by a re-render. Only a touch that starts on a target claims it, so a
// corner and the box never pass one drag back and forth. If the drag is handed over anyway, the new owner starts
// from the box as it is then and from the finger offset reached so far, so the change never compounds.
function createResponders(read) {
  const make = (target) => {
    let start = null;
    let base = { dx: 0, dy: 0 };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (_, gesture) => {
        start = read().rect;
        base = { dx: gesture.dx, dy: gesture.dy };
      },
      onPanResponderMove: (_, gesture) => {
        const { size, aspect, onChange } = read();
        if (!start || !size.width || !size.height) return;
        const dx = (gesture.dx - base.dx) / size.width;
        const dy = (gesture.dy - base.dy) / size.height;
        onChange(target === "move" ? moveRect(start, dx, dy) : resizeRect(start, target, dx, dy, aspect));
      },
      onPanResponderRelease: () => {
        start = null;
      },
      onPanResponderTerminate: () => {
        start = null;
      },
    });
  };
  return Object.fromEntries(["move", ...CORNERS].map((target) => [target, make(target)]));
}

// Preview with a draggable crop box. `rect` is normalized (0..1); `aspect` keeps a preset's shape, or null for free.
// Drag inside the box to move it, drag a corner to resize it.
export function CropBox({ path, pictureWidth, pictureHeight, rect, aspect, onChange, label }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const latestRef = useRef({ rect, aspect, size, onChange });
  useLayoutEffect(() => {
    latestRef.current = { rect, aspect, size, onChange };
  });
  // The getter only runs inside gesture callbacks, never during render.
  // eslint-disable-next-line react-hooks/refs
  const responders = useMemo(() => createResponders(() => latestRef.current), []);

  const ratio = pictureWidth && pictureHeight ? pictureWidth / pictureHeight : 1;
  const box = {
    left: rect.x * size.width,
    top: rect.y * size.height,
    width: rect.w * size.width,
    height: rect.h * size.height,
  };

  return (
    <View
      style={[styles.frame, ratio < 1 ? { height: TALL_HEIGHT } : { width: "100%" }, { aspectRatio: ratio }]}
      onLayout={(event) => setSize(event.nativeEvent.layout)}
      accessibilityLabel={label}
    >
      <Image source={{ uri: fileUri(path) }} style={StyleSheet.absoluteFill} resizeMode="stretch" />
      {/* Dim everything outside the box with four bands. */}
      <View style={[styles.shade, { left: 0, top: 0, right: 0, height: box.top }]} />
      <View style={[styles.shade, { left: 0, top: box.top + box.height, right: 0, bottom: 0 }]} />
      <View style={[styles.shade, { left: 0, top: box.top, width: box.left, height: box.height }]} />
      <View style={[styles.shade, { left: box.left + box.width, top: box.top, right: 0, height: box.height }]} />
      <View style={[styles.box, box]} {...responders.move.panHandlers}>
        {CORNERS.map((corner) => (
          <View
            key={corner}
            {...responders[corner].panHandlers}
            hitSlop={12}
            style={[
              styles.handle,
              corner.includes("t") ? { top: -HANDLE / 2 } : { bottom: -HANDLE / 2 },
              corner.includes("l") ? { left: -HANDLE / 2 } : { right: -HANDLE / 2 },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // No clipping: the corner handles stick out past the picture so they stay easy to grab at the edges.
  frame: { maxWidth: "100%", alignSelf: "center", backgroundColor: colors.surface },
  shade: { position: "absolute", backgroundColor: colors.scrim },
  box: { position: "absolute", borderWidth: 2, borderColor: colors.accent },
  handle: {
    position: "absolute",
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.bg,
  },
});
