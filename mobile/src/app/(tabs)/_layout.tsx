import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { useTheme } from 'react-native-paper';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

function icon(name: IconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <MaterialCommunityIcons name={name} color={color} size={size} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary,
        tabBarStyle: { backgroundColor: theme.colors.surface },
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.onSurface,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Personagens', tabBarIcon: icon('shield-sword') }} />
      <Tabs.Screen name="dice" options={{ title: 'Dados', tabBarIcon: icon('dice-d20') }} />
      <Tabs.Screen name="rooms" options={{ title: 'Mesas', tabBarIcon: icon('table-furniture') }} />
      <Tabs.Screen name="account" options={{ title: 'Conta', tabBarIcon: icon('account-circle') }} />
    </Tabs>
  );
}
