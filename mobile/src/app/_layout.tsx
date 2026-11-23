import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { AppIntentsBridge } from '@/components/app-intents-bridge';
import { migrate } from '@/db/schema';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Keeps the tabs underneath when the app opens straight onto a deep link like churchride://import. */
export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SQLiteProvider databaseName="churchride.db" onInit={migrate}>
        <AppIntentsBridge />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="import" options={{ presentation: 'modal', title: 'Import texts' }} />
          <Stack.Screen name="ride/[id]" options={{ title: 'Ride' }} />
          <Stack.Screen name="rider/[id]" options={{ title: 'Rider' }} />
        </Stack>
      </SQLiteProvider>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
