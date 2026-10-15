import "../core/polyfills";
import { colors } from "../core/theme";
import { LocaleProvider } from "../i18n";
import { ContextProvider } from "../providers/contextModule";
import SmartProvider from "../providers/smartProvider";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <SmartProvider>
      <LocaleProvider>
        <ContextProvider>
          <Stack
            initialRouteName="index"
            screenOptions={{
              animation: "slide_from_right",
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="licenses" />
            <Stack.Screen name="convert/[kind]" />
            <Stack.Screen name="+not-found" />
          </Stack>
          <StatusBar style="light" />
        </ContextProvider>
      </LocaleProvider>
    </SmartProvider>
  );
}
