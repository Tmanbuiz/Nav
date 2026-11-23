import * as Linking from 'expo-linking';
import { Alert } from 'react-native';

/** Opens Maps, Phone or Messages. Quietly does nothing for a missing link. */
export async function openExternal(url: string | null | undefined): Promise<void> {
  if (!url) return;
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Couldn’t open that', 'Check the app is installed.');
  }
}
