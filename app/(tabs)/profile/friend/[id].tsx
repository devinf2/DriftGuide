import {
  ProfileTripsPhotosHub,
  type ProfileTripsPhotosHubRef,
} from '@/src/components/profile/ProfileTripsPhotosHub';
import { PLAN_TRIP_FAB_MAP_CLEARANCE } from '@/src/constants/mapTabChrome';
import { BorderRadius, FontSize, Spacing } from '@/src/constants/theme';
import { fetchProfile, otherUserIdFromFriendship, sendFriendRequest } from '@/src/services/friendsService';
import { useAuthStore } from '@/src/stores/authStore';
import { useFriendsStore } from '@/src/stores/friendsStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { profileDisplayName, profileInitialLetter } from '@/src/utils/profileDisplay';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  const relationshipBtnStyles = useMemo(
    () =>
      StyleSheet.create({
        primary: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          paddingVertical: Spacing.xs,
          paddingHorizontal: Spacing.sm,
          borderRadius: BorderRadius.full,
          backgroundColor: colors.primary,
        },
        primaryText: { fontSize: FontSize.sm, fontWeight: '700', color: colors.textInverse },
        muted: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          paddingVertical: Spacing.xs,
          paddingHorizontal: Spacing.sm,
          borderRadius: BorderRadius.full,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        },
        mutedText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.textSecondary },
      }),
    [colors],
  );
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { id: idParam } = useLocalSearchParams<{ id?: string | string[] }>();
  const friendId = useMemo(() => parseIdParam(idParam), [idParam]);
  const { user } = useAuthStore();
  const userId = user?.id ?? null;
  const profileHubRef = useRef<ProfileTripsPhotosHubRef>(null);

  const friendships = useFriendsStore((s) => s.friendships);
  const refreshFriends = useFriendsStore((s) => s.refresh);
  const acceptRequest = useFriendsStore((s) => s.accept);

  const [friendProfile, setFriendProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingRequest, setSendingRequest] = useState(false);

  /** Relationship between me and the viewed user (drives the Add friend button + visible trips). */
  const relationship = useMemo<'self' | 'friends' | 'outgoing' | 'incoming' | 'blocked' | 'none'>(() => {
    if (!friendId || !userId) return 'none';
    if (friendId === userId) return 'self';
    const row = friendships.find((f) => otherUserIdFromFriendship(f, userId) === friendId);
    if (!row) return 'none';
    if (row.status === 'accepted') return 'friends';
    if (row.status === 'blocked') return 'blocked';
    if (row.status === 'pending') return row.requested_by === userId ? 'outgoing' : 'incoming';
    return 'none';
  }, [friendships, friendId, userId]);

  const incomingRow = useMemo(() => {
    if (relationship !== 'incoming' || !friendId || !userId) return null;
    return friendships.find((f) => otherUserIdFromFriendship(f, userId) === friendId) ?? null;
  }, [relationship, friendships, friendId, userId]);

  const handleAddFriend = useCallback(async () => {
    if (!userId || !friendId || sendingRequest) return;
    setSendingRequest(true);
    try {
      const res = await sendFriendRequest(userId, friendId);
      if (!res.ok) Alert.alert('Could not send request', res.message ?? 'Please try again.');
      await refreshFriends(userId);
    } finally {
      setSendingRequest(false);
    }
  }, [userId, friendId, sendingRequest, refreshFriends]);

  const handleAcceptRequest = useCallback(async () => {
    if (!incomingRow || sendingRequest) return;
    setSendingRequest(true);
    try {
      await acceptRequest(incomingRow);
    } finally {
      setSendingRequest(false);
    }
  }, [incomingRow, sendingRequest, acceptRequest]);

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
      // Anyone can open a profile (e.g. from the feed). Trip/photo visibility is enforced by
      // RLS: non-friends see only public trips; accepted friends also see friends_only.
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

  const onFriendProfileScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const threshold = 280;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - threshold) {
      profileHubRef.current?.loadMoreFromScroll();
    }
  }, []);

  const uname = friendProfile?.username?.trim();

  return (
    <ScrollView
      style={styles.container}
      onScroll={onFriendProfileScroll}
      scrollEventThrottle={400}
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
              {relationship === 'none' ? (
                <Pressable
                  onPress={handleAddFriend}
                  disabled={sendingRequest}
                  style={({ pressed }) => [relationshipBtnStyles.primary, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Add friend"
                >
                  <MaterialIcons name="person-add-alt" size={16} color={colors.textInverse} />
                  <Text style={relationshipBtnStyles.primaryText}>
                    {sendingRequest ? 'Sending…' : 'Add'}
                  </Text>
                </Pressable>
              ) : relationship === 'incoming' ? (
                <Pressable
                  onPress={handleAcceptRequest}
                  disabled={sendingRequest}
                  style={({ pressed }) => [relationshipBtnStyles.primary, pressed && { opacity: 0.85 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Accept friend request"
                >
                  <MaterialIcons name="how-to-reg" size={16} color={colors.textInverse} />
                  <Text style={relationshipBtnStyles.primaryText}>
                    {sendingRequest ? 'Accepting…' : 'Accept'}
                  </Text>
                </Pressable>
              ) : relationship === 'outgoing' ? (
                <View style={relationshipBtnStyles.muted}>
                  <MaterialIcons name="schedule" size={16} color={colors.textSecondary} />
                  <Text style={relationshipBtnStyles.mutedText}>Requested</Text>
                </View>
              ) : relationship === 'friends' ? (
                <View style={relationshipBtnStyles.muted}>
                  <MaterialIcons name="check" size={16} color={colors.primary} />
                  <Text style={[relationshipBtnStyles.mutedText, { color: colors.primary }]}>Friends</Text>
                </View>
              ) : null}
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

          {friendId ? (
            <ProfileTripsPhotosHub
              key={friendId}
              ref={profileHubRef}
              refreshSignal={0}
              peerUserId={friendId}
              peerAlbumProfile={friendProfile}
            />
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
