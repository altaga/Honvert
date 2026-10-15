import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Dimensions, PixelRatio, View } from "react-native";
import { Toaster } from "react-native-sonner";
import { colors } from "../core/theme";

// 1. Create the Context
const SmartSizeContext = createContext({
  width: 0,
  height: 0,
  scale: 1,
  normalize: (size) => size,
});

// 2. Export the Hook
export const useSmartSize = () => useContext(SmartSizeContext);

export default function SmartProvider({ children }) {
  const [windowDimensions, setWindowDimensions] = useState(
    Dimensions.get("window"),
  );

  useEffect(() => {
    const subscription = Dimensions.addEventListener("change", ({ window }) => {
      setWindowDimensions(window);
    });
    return () => subscription?.remove();
  }, []);

  const internalSize = useMemo(() => {
    const { width, height } = windowDimensions;

    // Scale primarily based on width, with a moderation factor and a clamp
    // so text and spacing stay sane on small phones and tablets.
    const baseScale = width / 375;
    const factor = 0.4;
    const moderateScale = 1 + (baseScale - 1) * factor;
    const clampedScale = Math.max(0.85, Math.min(1.2, moderateScale));
    const normalize = (size) => PixelRatio.roundToNearestPixel(size * clampedScale);

    return {
      width,
      height,
      scale: clampedScale,
      normalize,
    };
  }, [windowDimensions]);

  const toasterOptions = {
    toastOptions: {
      style: {
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.lineStrong,
        backgroundColor: colors.surfaceHigh,
        padding: 14,
      },
      titleStyle: {
        color: colors.text,
        fontWeight: "700",
        fontSize: internalSize.normalize(14),
      },
      descriptionStyle: {
        color: colors.muted,
        fontSize: internalSize.normalize(12),
      },
    },
  };

  return (
    <SmartSizeContext.Provider value={internalSize}>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {children}
        <Toaster
          {...toasterOptions}
          containerStyle={{
            width: internalSize.width * 0.9,
            alignSelf: "center",
          }}
        />
      </View>
    </SmartSizeContext.Provider>
  );
}
