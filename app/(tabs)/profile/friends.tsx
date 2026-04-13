import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { BorderRadius, FontSize, Spacing } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useFriendsStore } from '@/src/stores/friendsStore';
import {
  deleteFriendship,
  fetchProfile as fetchProfileByUserId,
  isShortFriendCode,
  lookupProfileByFriendCode,
  migrateLegacyFriendCode,
  otherUserIdFromFriendship,
  searchProfilesForDiscovery,
  sendFriendRequest,
  setMyFriendCode,
  type ProfileDiscoveryRow,
} from '@/src/services/friendsService';
import {
  declineSessionInvite,
  listPendingSessionInvitesForUser,
  resolveInviterTemplateTripForJoin,
} from '@/src/services/sharedSessionService';
import type { FriendshipRow, SessionInvite } from '@/src/types';
import { formatPendingSessionInviteSummary } from '@/src/utils/sessionInviteDisplay';
import { buildLinkTripAfterAcceptPath } from '@/src/utils/sessionInviteNavigation';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { profileInitialLetter } from '@/src/utils/profileDisplay';

type Seg = 'friends' | 'requests' | 'find';

/** Lowercase letters and digits; omit 0/o/1/l/i to reduce confusion when sharing verbally. */
const FRIEND_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

function randomFriendCode(length: 4 | 5): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += FRIEND_CODE_ALPHABET[Math.floor(Math.random() * FRIEND_CODE_ALPHABET.length)]!;
  }
  return s;
}

/** Short codes: show uppercase. Legacy long codes: show as stored. */
function formatFriendCodeForDisplay(code: string): string {
  const t = code.trim();
  if (isShortFriendCode(t)) return t.toUpperCase();
  return t;
}

function parseSegParam(raw: string | string[] | undefined): Seg | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === 'friends' || v === 'requests' || v === 'find') return v;
  return null;
}

export default function FriendsScreen() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const { seg: segParam } = useLocalSearchParams<{ seg?: string | string[] }>();
  const effectiveTop = useEffectiveSafeTopInset();
  const { user, profile, fetchProfile } = useAuthStore();
  const { friendships, loading, refresh, accept, remove } = useFriendsStore();
  const { isConnected } = useNetworkStatus();

  const [seg, setSeg] = useState<Seg>(() => parseSegParam(segParam) ?? 'friends');
  const [findCode, setFindCode] = useState('');
  const [lookupResult, setLookupResult] = useState<{
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [sessionInviteRows, setSessionInviteRows] = useState<
    { invite: SessionInvite; summaryLine: string }[]
  >([]);
  const [settingCode, setSettingCode] = useState(false);
  const [nameQuery, setNameQuery] = useState('');
  const [nameResults, setNameResults] = useState<ProfileDiscoveryRow[]>([]);
  const [nameSearching, setNameSearching] = useState(false);
  const [nameSearchError, setNameSearchError] = useState<string | null>(null);
  const nameSearchSeq = useRef(0);

  const myId = user?.id ?? '';

  const loadSessionInvites = useCallback(async () => {
    if (!myId || !isConnected) {
      setSessionInviteRows([]);
      return;
    }
    const list = await listPendingSessionInvitesForUser(myId);
    const rows = await Promise.all(
      list.map(async (inv) => {
        const [p, templateTrip] = await Promise.all([
          fetchProfileByUserId(inv.inviter_id),
          resolveInviterTemplateTripForJoin(inv.shared_session_id, inv),
        ]);
        const inviterName = p?.display_name?.trim() || 'A friend';
        return {
          invite: inv,
          summaryLine: formatPendingSessionInviteSummary(inviterName, inv, templateTrip),
        };
      }),
    );
    setSessionInviteRows(rows);
  }, [myId, isConnected]);

  useEffect(() => {
    void refresh(myId || null);
    void fetchProfile();
  }, [myId, refresh, fetchProfile]);

  useEffect(() => {
    const next = parseSegParam(segParam);
    if (next) setSeg(next);
  }, [segParam]);

  useEffect(() => {
    void loadSessionInvites();
  }, [loadSessionInvites]);

  useEffect(() => {
    const q = nameQuery.trim();
    setNameSearchError(null);
    if (q.length < 2) {
      setNameResults([]);
      setNameSearching(false);
      return;
    }
    if (!isConnected || !myId) {
      setNameResults([]);
      return;
    }

    setNameSearching(true);
    const seq = ++nameSearchSeq.current;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const rows = await searchProfilesForDiscovery(q);
          if (nameSearchSeq.current !== seq) return;
          setNameResults(rows.filter((r) => r.id !== myId));
          setNameSearchError(null);
        } catch (e) {
          if (nameSearchSeq.current !== seq) return;
          setNameResults([]);
          setNameSearchError(e instanceof Error ? e.message : 'Search failed.');
        } finally {
          if (nameSearchSeq.current === seq) setNameSearching(false);
        }
      })();
    }, 400);
    return () => clearTimeout(t);
  }, [nameQuery, myId, isConnected]);

  const acceptedFriends = useMemo(() => friendships.filter((f) => f.status === 'accepted'), [friendships]);
  const pendingIncoming = useMemo(
    () => friendships.filter((f) => f.status === 'pending' && f.requested_by !== myId),
    [friendships, myId],
  );
  const pendingOutgoing = useMemo(
    () => friendships.filter((f) => f.status === 'pending' && f.requested_by === myId),
    [friendships, myId],
  );
  const pendingRequestCount = pendingIncoming.length + pendingOutgoing.length;

  /** When opening Friends without a segment param, land on Requests if someone needs accepting. */
  const defaultedToRequestsForNoParamRef = useRef(false);
  useEffect(() => {
    const fromParam = parseSegParam(segParam);
    if (fromParam) {
      defaultedToRequestsForNoParamRef.current = true;
      return;
    }
    if (!myId || loading) return;
    if (defaultedToRequestsForNoParamRef.current) return;
    defaultedToRequestsForNoParamRef.current = true;
    if (pendingIncoming.length > 0) setSeg('requests');
  }, [segParam, myId, loading, pendingIncoming.length]);

  const profileByFriend = useFriendsStore((s) => s.profileByUserId);

  const renderRequestAvatar = (oid: string) => {
    const peer = profileByFriend[oid];
    const letter = profileInitialLetter(peer);
    if (peer?.avatar_url) {
      return (
        <Image source={{ uri: peer.avatar_url }} style={styles.requestRowAvatar} contentFit="cover" />
      );
    }
    return (
      <View style={[styles.requestRowAvatar, { backgroundColor: colors.primary }]}>
        <Text style={[styles.requestRowAvatarLetter, { color: colors.textInverse }]}>{letter}</Text>
      </View>
    );
  };

  const handleLookup = async () => {
    setLookupLoading(true);
    setLookupResult(null);
    try {
      const r = await lookupProfileByFriendCode(findCode);
      if (!r || r.id === myId) {
        setLookupResult(null);
        Alert.alert('Not found', 'No angler matches that friend code.');
        return;
      }
      setLookupResult({
        id: r.id,
        display_name: r.display_name,
        avatar_url: r.avatar_url ?? null,
      });
    } finally {
      setLookupLoading(false);
    }
  };

  const sendRequestTo = async (toId: string) => {
    const res = await sendFriendRequest(myId, toId);
    if (!res.ok) {
      Alert.alert('Request', res.message ?? 'Could not send request.');
      return;
    }
    Alert.alert('Sent', 'Friend request sent.');
    void refresh(myId);
  };

  const friendshipWithUser = useCallback(
    (otherId: string) =>
      friendships.find((row) => otherUserIdFromFriendship(row, myId) === otherId) ?? null,
    [friendships, myId],
  );

  const renderFindResultRow = (
    otherId: string,
    displayName: string | null,
    avatarUrl: string | null,
    username: string | null | undefined,
  ) => {
    const f = friendshipWithUser(otherId);
    const letter = (displayName?.trim() || 'A').charAt(0).toUpperCase();

    let action: ReactNode;
    if (!f) {
      action = (
        <Pressable
          style={[styles.findRequestBtn, { backgroundColor: colors.primary }]}
          onPress={() => void sendRequestTo(otherId)}
          disabled={!isConnected}
        >
          <Text style={[styles.findRequestBtnText, { color: colors.textInverse }]}>Request</Text>
        </Pressable>
      );
    } else if (f.status === 'accepted') {
      action = <Text style={[styles.findStatusLabel, { color: colors.textSecondary }]}>Friends</Text>;
    } else if (f.status === 'pending') {
      action = <Text style={[styles.findStatusLabel, { color: colors.textSecondary }]}>Pending</Text>;
    } else {
      action = <Text style={[styles.findStatusLabel, { color: colors.textSecondary }]}>Blocked</Text>;
    }

    return (
      <View style={[styles.findResultCard, { borderColor: colors.border }]}>
        <View style={styles.findResultRow}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.findResultAvatar} contentFit="cover" />
          ) : (
            <View style={[styles.findResultAvatar, { backgroundColor: colors.primary }]}>
              <Text style={[styles.findResultAvatarLetter, { color: colors.textInverse }]}>{letter}</Text>
            </View>
          )}
          <View style={styles.findResultTextCol}>
            <Text style={[styles.findResultName, { color: colors.text }]} numberOfLines={1}>
              {displayName?.trim() || 'Angler'}
            </Text>
            {username?.trim() ? (
              <Text style={[styles.findResultUsername, { color: colors.textSecondary }]} numberOfLines={1}>
                @{username.trim()}
              </Text>
            ) : null}
          </View>
          {action}
        </View>
      </View>
    );
  };

  const handleClaimFriendCode = async () => {
    setSettingCode(true);
    const maxAttempts = 12;
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const length: 4 | 5 = Math.random() < 0.5 ? 4 : 5;
        const candidate = randomFriendCode(length);
        try {
          await setMyFriendCode(candidate);
          await fetchProfile();
          Alert.alert('Friend code set', 'Share it with friends. It can’t be changed later.');
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('already taken') && attempt < maxAttempts - 1) continue;
          throw e;
        }
      }
    } catch (e) {
      Alert.alert('Could not set code', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSettingCode(false);
    }
  };

  const runMigrateLegacyFriendCode = async () => {
    setSettingCode(true);
    try {
      const newCode = await migrateLegacyFriendCode();
      await fetchProfile();
      Alert.alert(
        'Short friend code ready',
        `Your new code is ${newCode.toUpperCase()}. Your old code no longer works—share this one with friends.`,
      );
    } catch (e) {
      Alert.alert('Could not update', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSettingCode(false);
    }
  };

  const confirmMigrateLegacyFriendCode = () => {
    Alert.alert(
      'Switch to short code?',
      'Your current code will stop working. Anyone who only had the old code will need your new one.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch', style: 'destructive', onPress: () => void runMigrateLegacyFriendCode() },
      ],
    );
  };

  const hasFriendCode = Boolean(profile?.friend_code?.trim());

  const handleAcceptSessionInvite = async (inv: SessionInvite) => {
    router.push(buildLinkTripAfterAcceptPath(inv) as Href);
    void loadSessionInvites();
  };

  const handleDeclineSessionInvite = async (inv: SessionInvite) => {
    if (!isConnected) {
      Alert.alert('Offline', 'Connect to the internet to decline this invite.');
      return;
    }
    const ok = await declineSessionInvite(inv.id);
    if (!ok) {
      Alert.alert('Could not decline', 'Try again in a moment.');
      return;
    }
    void loadSessionInvites();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>
      <View style={[styles.topBar, { paddingTop: effectiveTop + Spacing.sm, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: colors.text }]}>Friends</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {!isConnected ? (
          <View style={[styles.banner, { backgroundColor: colors.surfaceElevated, borderColor: colors.border }]}>
            <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>
              Offline — friend list and invites refresh when you reconnect.
            </Text>
          </View>
        ) : null}

        {sessionInviteRows.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Fishing group invites</Text>
            {sessionInviteRows.map(({ invite, summaryLine }) => (
              <View key={invite.id} style={[styles.card, { borderColor: colors.border }]}>
                <Text style={{ color: colors.text, marginBottom: Spacing.sm }}>{summaryLine}</Text>
                <View style={styles.row}>
                  <Pressable
                    style={[styles.smallBtn, { backgroundColor: colors.primary }]}
                    onPress={() => void handleAcceptSessionInvite(invite)}
                  >
                    <Text style={{ color: colors.textInverse, fontWeight: '600' }}>Continue</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.smallBtn, { backgroundColor: colors.borderLight }]}
                    onPress={() => void handleDeclineSessionInvite(invite)}
                  >
                    <Text style={{ color: colors.text, fontWeight: '600' }}>Decline</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={[styles.segRow, { backgroundColor: colors.surfaceElevated }]}>
          {(['friends', 'requests', 'find'] as const).map((k) => {
            const selected = seg === k;
            const labelColor = selected ? colors.textInverse : colors.textSecondary;
            return (
              <Pressable
                key={k}
                style={[styles.segBtn, selected && { backgroundColor: colors.primary }]}
                onPress={() => setSeg(k)}
              >
                <View style={styles.segBtnInner}>
                  <Text style={[styles.segBtnText, { color: labelColor }]}>
                    {k === 'friends' ? 'Friends' : k === 'requests' ? 'Requests' : 'Find'}
                  </Text>
                  {k === 'requests' && pendingRequestCount > 0 ? (
                    <View style={[styles.segBadge, { backgroundColor: colors.error }]}>
                      <Text style={styles.segBadgeText}>
                        {pendingRequestCount > 9 ? '9+' : String(pendingRequestCount)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.section}>
          {hasFriendCode ? (
            <>
              <View style={styles.friendCodeRow}>
                <Pressable
                  onPress={() => {
                    Alert.alert(
                      'Friend code',
                      isShortFriendCode(profile!.friend_code!)
                        ? 'Letters and numbers only; not case-sensitive. This code can’t be changed—share it with friends.'
                        : 'You’re on a legacy longer code. You can switch once to a short 4–5 character code; the old one will stop working.',
                    );
                  }}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="About friend codes"
                >
                  <MaterialIcons name="info-outline" size={22} color={colors.textSecondary} />
                </Pressable>
                <Text style={[styles.friendCodeInlineLabel, { color: colors.text }]}>Your Friend Code:</Text>
                <Text
                  style={[styles.mono, styles.friendCodeMono, { color: colors.primary }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {formatFriendCodeForDisplay(profile!.friend_code!)}
                </Text>
              </View>
              {!isShortFriendCode(profile!.friend_code!) ? (
                <Pressable
                  style={[styles.primaryBtn, { backgroundColor: colors.secondary, marginTop: Spacing.sm }]}
                  onPress={confirmMigrateLegacyFriendCode}
                  disabled={settingCode || !isConnected}
                >
                  {settingCode ? (
                    <ActivityIndicator color={colors.textInverse} />
                  ) : (
                    <Text style={{ color: colors.textInverse, fontWeight: '600' }}>Switch to short code</Text>
                  )}
                </Pressable>
              ) : null}
            </>
          ) : (
            <>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Your friend code</Text>
              <Text style={[styles.mono, { color: colors.primary }]}>Not set yet</Text>
              <Text style={[styles.hint, { color: colors.textSecondary, marginTop: Spacing.xs }]}>
                Friend codes are created automatically when you sign up. If yours is missing (e.g. older account), you
                can claim one here once.
              </Text>
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: colors.secondary, marginTop: Spacing.sm }]}
                onPress={() => void handleClaimFriendCode()}
                disabled={settingCode || !isConnected}
              >
                {settingCode ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={{ color: colors.textInverse, fontWeight: '600' }}>Claim friend code</Text>
                )}
              </Pressable>
            </>
          )}
        </View>

        {loading ? <ActivityIndicator color={colors.primary} style={{ marginVertical: Spacing.lg }} /> : null}

        {seg === 'friends' ? (
          <View style={styles.section}>
            {acceptedFriends.length === 0 ? (
              <Text style={{ color: colors.textSecondary }}>No friends yet. Use Find to add people.</Text>
            ) : (
              acceptedFriends.map((f) => {
                const oid = otherUserIdFromFriendship(f, myId);
                const peer = profileByFriend[oid];
                const label = peer?.display_name?.trim() || 'Angler';
                const uname = peer?.username?.trim();
                return (
                  <Pressable
                    key={`${f.profile_min}-${f.profile_max}`}
                    onPress={() => router.push({ pathname: '/friends/friend/[id]', params: { id: oid } })}
                    style={({ pressed }) => [pressed && { opacity: 0.88 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${label} profile`}
                  >
                    <View style={[styles.requestRow, { borderColor: colors.border }]}>
                      {renderRequestAvatar(oid)}
                      <View style={styles.findResultTextCol}>
                        <Text style={[styles.requestRowName, { color: colors.text }]} numberOfLines={1}>
                          {label}
                        </Text>
                        {uname ? (
                          <Text style={[styles.findResultUsername, { color: colors.textSecondary }]} numberOfLines={1}>
                            @{uname}
                          </Text>
                        ) : null}
                      </View>
                      <Pressable onPress={() => remove(f).then(() => refresh(myId))} hitSlop={8}>
                        <Text style={{ color: colors.error, fontWeight: '600' }}>Remove</Text>
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        ) : null}

        {seg === 'requests' ? (
          <View style={styles.section}>
            <Text style={[styles.subTitle, { color: colors.text }]}>Incoming</Text>
            {pendingIncoming.length === 0 ? (
              <Text style={{ color: colors.textSecondary, marginBottom: Spacing.md }}>No pending requests.</Text>
            ) : (
              pendingIncoming.map((f) => {
                const oid = otherUserIdFromFriendship(f, myId);
                const label = profileByFriend[oid]?.display_name?.trim() || 'Angler';
                return (
                  <View key={`in-${f.profile_min}-${f.profile_max}`} style={[styles.requestRow, { borderColor: colors.border }]}>
                    {renderRequestAvatar(oid)}
                    <Text style={[styles.requestRowName, { color: colors.text }]} numberOfLines={1}>
                      {label}
                    </Text>
                    <Pressable onPress={() => accept(f)} style={styles.requestRowActionHit} hitSlop={8}>
                      <Text style={{ color: colors.primary, fontWeight: '600' }}>Accept</Text>
                    </Pressable>
                    <Pressable onPress={() => deleteFriendship(f).then(() => refresh(myId))} hitSlop={8}>
                      <Text style={{ color: colors.textSecondary }}>Decline</Text>
                    </Pressable>
                  </View>
                );
              })
            )}
            <Text style={[styles.subTitle, { color: colors.text, marginTop: Spacing.lg }]}>Outgoing</Text>
            {pendingOutgoing.length === 0 ? (
              <Text style={{ color: colors.textSecondary }}>None.</Text>
            ) : (
              pendingOutgoing.map((f) => {
                const oid = otherUserIdFromFriendship(f, myId);
                const label = profileByFriend[oid]?.display_name?.trim() || 'Angler';
                return (
                  <View key={`out-${f.profile_min}-${f.profile_max}`} style={[styles.requestRow, { borderColor: colors.border }]}>
                    {renderRequestAvatar(oid)}
                    <Text style={[styles.requestRowName, { color: colors.text }]} numberOfLines={2}>
                      Waiting for {label}
                    </Text>
                    <Pressable onPress={() => deleteFriendship(f).then(() => refresh(myId))} hitSlop={8}>
                      <Text style={{ color: colors.error, fontWeight: '600' }}>Cancel</Text>
                    </Pressable>
                  </View>
                );
              })
            )}
          </View>
        ) : null}

        {seg === 'find' ? (
          <View style={styles.section}>
            <Text style={[styles.subTitle, { color: colors.text }]}>Friend code</Text>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              Enter their 4–5 character code (letters and numbers; not case-sensitive).
            </Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.text }]}
              placeholder="Friend code"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              value={findCode}
              onChangeText={setFindCode}
            />
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={() => void handleLookup()}
              disabled={lookupLoading || !isConnected}
            >
              {lookupLoading ? (
                <ActivityIndicator color={colors.textInverse} />
              ) : (
                <Text style={{ color: colors.textInverse, fontWeight: '600' }}>Look up</Text>
              )}
            </Pressable>
            {lookupResult ? (
              <View style={{ marginTop: Spacing.md }}>
                {renderFindResultRow(
                  lookupResult.id,
                  lookupResult.display_name,
                  lookupResult.avatar_url,
                  undefined,
                )}
              </View>
            ) : null}

            <Text style={[styles.subTitle, { color: colors.text, marginTop: Spacing.lg }]}>Name or username</Text>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              Search by display name, first or last name, or @username (at least 2 characters).
            </Text>
            <TextInput
              style={[styles.input, { borderColor: colors.border, color: colors.text }]}
              placeholder="e.g. Alex or river_rat"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              value={nameQuery}
              onChangeText={setNameQuery}
              editable={isConnected}
            />
            {nameSearching ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: Spacing.sm }} />
            ) : null}
            {nameSearchError ? (
              <Text style={{ color: colors.error, fontSize: FontSize.sm, marginBottom: Spacing.sm }}>{nameSearchError}</Text>
            ) : null}
            {nameQuery.trim().length >= 2 && !nameSearching && !nameSearchError && nameResults.length === 0 ? (
              <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>No matches.</Text>
            ) : null}
            {nameResults.map((row) => (
              <View key={row.id} style={{ marginTop: Spacing.sm }}>
                {renderFindResultRow(row.id, row.display_name, row.avatar_url ?? null, row.username)}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 40 },
  topTitle: { fontSize: FontSize.lg, fontWeight: '700' },
  scroll: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  banner: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    marginBottom: Spacing.md,
  },
  section: { marginBottom: Spacing.lg },
  sectionTitle: { fontSize: FontSize.md, fontWeight: '700', marginBottom: Spacing.sm },
  friendCodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  friendCodeInlineLabel: {
    fontSize: FontSize.md,
    fontWeight: '700',
    flexShrink: 0,
  },
  friendCodeMono: { flex: 1, minWidth: 0 },
  subTitle: { fontSize: FontSize.sm, fontWeight: '600', marginBottom: Spacing.sm },
  hint: { fontSize: FontSize.sm, marginBottom: Spacing.sm },
  segRow: { flexDirection: 'row', borderRadius: BorderRadius.md, padding: 4, marginBottom: Spacing.lg, gap: 4 },
  segBtn: { flex: 1, paddingVertical: Spacing.sm, borderRadius: BorderRadius.sm, alignItems: 'center', justifyContent: 'center' },
  segBtnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 2 },
  segBtnText: { fontSize: FontSize.sm, fontWeight: '600' },
  segBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  segBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  requestRowAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  requestRowAvatarLetter: { fontSize: FontSize.md, fontWeight: '700' },
  requestRowName: { flex: 1, minWidth: 0, fontSize: FontSize.md, fontWeight: '600' },
  requestRowActionHit: { marginRight: Spacing.sm },
  mono: { fontSize: FontSize.md, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  primaryBtn: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
    fontSize: FontSize.md,
  },
  card: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  row: { flexDirection: 'row', gap: Spacing.sm },
  smallBtn: { flex: 1, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, alignItems: 'center' },
  findResultCard: {
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    padding: Spacing.sm,
    overflow: 'hidden',
  },
  findResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  findResultAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  findResultAvatarLetter: {
    fontSize: FontSize.lg,
    fontWeight: '700',
  },
  findResultTextCol: { flex: 1, minWidth: 0 },
  findResultName: { fontSize: FontSize.md, fontWeight: '600' },
  findResultUsername: { fontSize: FontSize.sm, marginTop: 2 },
  findRequestBtn: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
  },
  findRequestBtnText: { fontSize: FontSize.sm, fontWeight: '600' },
  findStatusLabel: { fontSize: FontSize.sm, fontWeight: '600' },
});
