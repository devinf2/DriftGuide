import { FishActionsTabButton } from '@/src/components/FishActionsTabButton';
import { PlanTripFab } from '@/src/components/PlanTripFab';
import { useAuthStore } from '@/src/stores/authStore';
import { useFriendsStore } from '@/src/stores/friendsStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { prefetchHomeDiscoveryBriefing } from '@/src/utils/homeDiscoveryPrefetch';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React, { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const unstable_settings = {
  initialRouteName: 'home',
};

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const friendships = useFriendsStore((s) => s.friendships);
  const refreshFriends = useFriendsStore((s) => s.refresh);

  useEffect(() => {
    if (!userId) return;
    void prefetchHomeDiscoveryBriefing();
    void refreshFriends(userId);
  }, [userId, refreshFriends]);

  const incomingFriendRequestCount = useMemo(() => {
    if (!userId) return 0;
    return friendships.filter((f) => f.status === 'pending' && f.requested_by !== userId).length;
  }, [friendships, userId]);

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        initialRouteName="home"
        screenOptions={{
          headerShown: false,
          tabBarHideOnKeyboard: true,
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
          name="fish-actions"
          options={{
            title: 'Go fishing',
            tabBarShowLabel: false,
            tabBarIcon: () => null,
            tabBarButton: (props) => <FishActionsTabButton {...props} />,
          }}
        />
        <Tabs.Screen
          name="friends"
          options={{
            title: 'Friends',
            tabBarBadge: incomingFriendRequestCount > 0 ? Math.min(incomingFriendRequestCount, 99) : undefined,
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="account-multiple" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="journal"
          options={{
            title: 'Trips',
            tabBarLabel: 'Trips',
            href: null,
            tabBarIcon: ({ color, size }) => (
              <MaterialIcons name="route" color={color} size={size} />
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
      <PlanTripFab placement="tabBar" />
    </View>
  );
}
