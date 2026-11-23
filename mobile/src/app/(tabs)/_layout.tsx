import { NativeTabs } from 'expo-router/native-tabs';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { countInbox } from '@/db/repo';
import { useDataVersion } from '@/hooks/use-data-version';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const db = useSQLiteContext();
  const version = useDataVersion();
  const colors = useTheme();
  const [inbox, setInbox] = useState(0);

  useEffect(() => {
    let alive = true;
    countInbox(db).then((n) => {
      if (alive) setInbox(n);
    });
    return () => {
      alive = false;
    };
  }, [db, version]);

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="car.fill" md="directions_car" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Label>Inbox</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="tray.full.fill" md="inbox" />
        <NativeTabs.Trigger.Badge hidden={inbox === 0}>{String(inbox)}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="riders">
        <NativeTabs.Trigger.Label>Riders</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.2.fill" md="group" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape.fill" md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
