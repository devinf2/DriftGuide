import { PlanTripFab } from '@/src/components/PlanTripFab';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const unstable_settings = {
  initialRouteName: 'home',
};

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        initialRouteName="home"
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textTertiary,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingTop: 8,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        }}
      >
        <Tabs.Screen name="index" options={{ href: null }} />
        <Tabs.Screen
          name="home"
          options={{
            title: 'Home',
            tabBarLabel: 'Fish',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="fish" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="map"
          options={{
            title: 'Map',
            tabBarIcon: ({ color, size }) => <MaterialIcons name="map" color={color} size={size} />,
          }}
        />
        <Tabs.Screen
          name="journal"
          options={{
            title: 'Journal',
            tabBarIcon: ({ color, size }) => (
              <MaterialIcons name="menu-book" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="guide"
          options={{
            href: null,
            title: 'AI Guide',
            tabBarIcon: ({ color, size }) => (
              <MaterialIcons name="assistant" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size }) => (
              <MaterialIcons name="person" color={color} size={size} />
            ),
          }}
        />
      </Tabs>
      <PlanTripFab />
    </View>
  );
}
