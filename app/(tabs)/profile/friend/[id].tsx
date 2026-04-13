import { ProfilePhotoLibrarySection } from '@/src/components/ProfilePhotoLibrarySection';
import { PLAN_TRIP_FAB_MAP_CLEARANCE } from '@/src/constants/mapTabChrome';
import { Spacing } from '@/src/constants/theme';
import { fetchMyFriendships, fetchProfile, otherUserIdFromFriendship } from '@/src/services/friendsService';
import { useAuthStore } from '@/src/stores/authStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { profileDisplayName, profileInitialLetter } from '@/src/utils/profileDisplay';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createProfileStyles, QuickTile } from '../index';
import type { Profile } from '@/src/types';

function parseIdParam(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

export default function FriendProfileScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createProfileStyles(colors), [colors]);
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { id: idParam } = useLocalSearchParams<{ id?: string | string[] }>();
  const friendId = useMemo(() => parseIdParam(idParam), [idParam]);
  const { user } = useAuthStore();
  const userId = user?.id ?? null;

  const [friendProfile, setFriendProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  /** Avoid full-screen loading flicker on refocus — reduces native header churn (stale back button on iOS). */
  const lastFriendLoadKeyRef = useRef<string | null>(null);
  const headerTitleAppliedRef = useRef<string | undefined>(undefined);

  const loadFriend = useCallback(async () => {
    if (!friendId || !userId) {
      setFriendProfile(null);
      setLoading(false);
      lastFriendLoadKeyRef.current = null;
      return;
    }
    const loadKey = `${friendId}:${userId}`;
    const showFullScreenLoading = lastFriendLoadKeyRef.current !== loadKey;
    if (showFullScreenLoading) {
      setLoading(true);
      setFriendProfile(null);
      headerTitleAppliedRef.current = undefined;
    }
    try {
      const list = await fetchMyFriendships();
      const accepted = list.some(
        (f) =>
          f.status === 'accepted' &&
          otherUserIdFromFriendship(f, userId) === friendId,
      );
      if (!accepted) {
        setFriendProfile(null);
        lastFriendLoadKeyRef.current = null;
        Alert.alert('Unavailable', 'You can only view accepted friends’ profiles.');
        router.back();
        return;
      }
      const p = await fetchProfile(friendId);
      setFriendProfile(p);
      if (p) {
        lastFriendLoadKeyRef.current = loadKey;
      } else {
        lastFriendLoadKeyRef.current = null;
        Alert.alert('Unavailable', 'Could not load this profile.');
        router.back();
      }
    } finally {
      setLoading(false);
    }
  }, [friendId, userId, router]);

  useFocusEffect(
    useCallback(() => {
      void loadFriend();
    }, [loadFriend]),
  );

  const displayName = profileDisplayName(friendProfile);

  useLayoutEffect(() => {
    const nextTitle = displayName;
    if (headerTitleAppliedRef.current === nextTitle) return;
    headerTitleAppliedRef.current = nextTitle;
    /** Only update title here; `headerBackTitle` stays on Stack.Screen to avoid repeated native bar rebuilds. */
    navigation.setOptions({ title: nextTitle });
  }, [navigation, displayName]);

  const uname = friendProfile?.username?.trim();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        paddingHorizontal: Spacing.md,
        paddingTop: Spacing.md,
        paddingBottom: insets.bottom + Spacing.lg + PLAN_TRIP_FAB_MAP_CLEARANCE,
      }}
    >
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: Spacing.xl }} />
      ) : friendProfile ? (
        <>
          <View style={styles.headerCard}>
            <View style={styles.headerRow}>
              <View style={styles.avatarWrapper}>
                <View style={styles.avatar}>
                  {friendProfile.avatar_url ? (
                    <Image
                      source={{ uri: friendProfile.avatar_url }}
                      style={styles.avatarImage}
                      contentFit="cover"
                      transition={200}
                    />
                  ) : (
                    <Text style={styles.avatarText}>{profileInitialLetter(friendProfile)}</Text>
                  )}
                </View>
              </View>
              <View style={[styles.headerTextCol, { paddingRight: 0 }]}>
                <Text style={styles.name} numberOfLines={2}>
                  {displayName}
                </Text>
                {uname ? (
                  <Text style={styles.email} numberOfLines={1}>
                    @{uname}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          <View style={styles.quickRow}>
            <QuickTile
              icon="hook"
              label="Fly Box"
              onPress={() => {
                if (!friendId) return;
                router.push({
                  pathname: '/profile/fly-box',
                  params: { forUserId: friendId, ownerName: displayName },
                });
              }}
              colors={colors}
              styles={styles}
            />
            <QuickTile
              icon="chart-line"
              label="Stats"
              onPress={() => {
                if (!friendId) return;
                router.push({
                  pathname: '/profile/stats',
                  params: { forUserId: friendId, ownerName: displayName },
                });
              }}
              colors={colors}
              styles={styles}
            />
          </View>

          {friendId ? <ProfilePhotoLibrarySection peerUserId={friendId} /> : null}
        </>
      ) : null}
    </ScrollView>
  );
}
