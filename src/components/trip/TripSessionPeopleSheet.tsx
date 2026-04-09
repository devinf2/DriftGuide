import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Href, useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { BorderRadius, FontSize, Spacing } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchProfile, otherUserIdFromFriendship } from '@/src/services/friendsService';
import { profileInitialLetter } from '@/src/utils/profileDisplay';
import {
  attachTripToSession,
  createSharedSession,
  declineSessionInvite,
  detachTripFromSession,
  inviteToSession,
  leaveSession,
  listPendingSessionInvitesForUser,
  listSessionInvitesSentFromSession,
  listSessionMembers,
} from '@/src/services/sharedSessionService';
import { fetchTripById } from '@/src/services/sync';
import type { FriendshipRow, SessionInvite, SessionMember } from '@/src/types';
import { mergeAnchorIsoFromInviterTrip } from '@/src/utils/sessionInviteMergeTrips';
import { buildLinkTripAfterAcceptPath } from '@/src/utils/sessionInviteNavigation';

const MEMBER_AVATAR = 40;

type FriendRow = { id: string; label: string; avatarUrl: string | null };

function initialFromDisplayName(name: string): string {
  const t = name.trim();
  return t ? t.charAt(0).toUpperCase() : '?';
}

export interface TripSessionPeopleSheetProps {
  visible: boolean;
  onClose: () => void;
  tripId: string;
  userId: string;
  /** Current session id from trip row (null if not in a group). */
  sharedSessionId: string | null;
  acceptedFriendships: FriendshipRow[];
  onSessionChanged: (nextSessionId: string | null) => void;
}

export function TripSessionPeopleSheet({
  visible,
  onClose,
  tripId,
  userId,
  sharedSessionId,
  acceptedFriendships,
  onSessionChanged,
}: TripSessionPeopleSheetProps) {
  const router = useRouter();
  const { colors } = useAppTheme();
  const profile = useAuthStore((s) => s.profile);
  const [members, setMembers] = useState<SessionMember[]>([]);
  const [invitesOut, setInvitesOut] = useState<SessionInvite[]>([]);
  const [invitesIn, setInvitesIn] = useState<SessionInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [friendRows, setFriendRows] = useState<FriendRow[]>([]);

  const acceptedFriends = useMemo(
    () => acceptedFriendships.filter((f) => f.status === 'accepted'),
    [acceptedFriendships],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const incoming = await listPendingSessionInvitesForUser(userId);
      setInvitesIn(incoming);
      let sessionMembers: SessionMember[] = [];
      let outgoingInvites: SessionInvite[] = [];
      if (sharedSessionId) {
        const [m, o] = await Promise.all([
          listSessionMembers(sharedSessionId),
          listSessionInvitesSentFromSession(sharedSessionId),
        ]);
        sessionMembers = m;
        outgoingInvites = o;
        setMembers(m);
        setInvitesOut(o);
      } else {
        setMembers([]);
        setInvitesOut([]);
      }

      const rows: FriendRow[] = [];
      for (const f of acceptedFriends) {
        const oid = otherUserIdFromFriendship(f, userId);
        const p = await fetchProfile(oid);
        const av = p?.avatar_url?.trim();
        rows.push({
          id: oid,
          label: p?.display_name?.trim() || 'Friend',
          avatarUrl: av || null,
        });
      }
      for (const mem of sessionMembers) {
        if (!rows.some((r) => r.id === mem.user_id)) {
          const p = await fetchProfile(mem.user_id);
          const av = p?.avatar_url?.trim();
          rows.push({
            id: mem.user_id,
            label: p?.display_name?.trim() || 'Angler',
            avatarUrl: av || null,
          });
        }
      }
      for (const inv of outgoingInvites) {
        const aid = inv.invitee_id;
        if (aid && !rows.some((r) => r.id === aid)) {
          const p = await fetchProfile(aid);
          const av = p?.avatar_url?.trim();
          rows.push({
            id: aid,
            label: p?.display_name?.trim() || 'Friend',
            avatarUrl: av || null,
          });
        }
      }
      setFriendRows(rows);
    } finally {
      setLoading(false);
    }
  }, [userId, sharedSessionId, acceptedFriends]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);

  const pendingInviteeIds = useMemo(
    () => new Set(invitesOut.map((i) => i.invitee_id)),
    [invitesOut],
  );

  const friendsNotInSession = useMemo(() => {
    return friendRows.filter((r) => !memberIds.has(r.id) && !pendingInviteeIds.has(r.id));
  }, [friendRows, memberIds, pendingInviteeIds]);

  const handleCreateSession = async () => {
    const created = await createSharedSession(null, userId);
    if (!created.ok) {
      Alert.alert('Could not create group', created.message);
      return;
    }
    const ok = await attachTripToSession(tripId, created.sessionId);
    if (!ok) {
      Alert.alert('Could not link trip', 'Try again.');
      return;
    }
    onSessionChanged(created.sessionId);
    await load();
  };

  const handleInvite = async (friendId: string) => {
    if (!sharedSessionId) return;
    const trip = await fetchTripById(tripId);
    if (!trip || trip.deleted_at) {
      Alert.alert('Invite failed', 'Could not load this trip.');
      return;
    }
    const inviteKind = trip.status === 'completed' ? ('past' as const) : ('upcoming' as const);
    const ok = await inviteToSession(sharedSessionId, userId, friendId, {
      inviterTripId: tripId,
      mergeWindowAnchorAt: mergeAnchorIsoFromInviterTrip(trip),
      inviteKind,
    });
    if (!ok) Alert.alert('Invite failed', 'They may already be invited or in the group.');
    await load();
  };

  const handleDetach = async () => {
    Alert.alert('Leave this fishing group?', 'Your trip stays in your journal; it will no longer share a group timeline.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          await detachTripFromSession(tripId);
          if (sharedSessionId) await leaveSession(sharedSessionId, userId);
          onSessionChanged(null);
          onClose();
        },
      },
    ]);
  };

  const handleAcceptIncoming = (inv: SessionInvite) => {
    onClose();
    router.push(buildLinkTripAfterAcceptPath(inv) as Href);
  };

  const handleDeclineIncoming = async (inv: SessionInvite) => {
    const ok = await declineSessionInvite(inv.id);
    if (!ok) {
      Alert.alert('Could not decline', 'Try again in a moment.');
      return;
    }
    await load();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>Fishing group</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <MaterialIcons name="close" size={26} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {loading ? <ActivityIndicator color={colors.primary} style={{ marginVertical: Spacing.lg }} /> : null}

          {invitesIn.length > 0 ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Invites to join a group</Text>
              {invitesIn.map((inv) => (
                <View key={inv.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                  <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>
                    {`Continue to link a trip to this group. You stay pending until a trip is connected (planned, live, or past within about five days of theirs). Your journal stays yours.`}
                  </Text>
                  <View style={styles.rowBtns}>
                    <Pressable
                      style={[styles.btn, { backgroundColor: colors.primary }]}
                      onPress={() => handleAcceptIncoming(inv)}
                    >
                      <Text style={[styles.btnText, { color: colors.textInverse }]}>Continue</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.btn, { backgroundColor: colors.borderLight }]}
                      onPress={() => void handleDeclineIncoming(inv)}
                    >
                      <Text style={[styles.btnText, { color: colors.text }]}>Decline</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {!sharedSessionId ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Start a group</Text>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>
                Create a fishing group for this trip. You can invite friends; each person links their own trip to share a
                combined timeline.
              </Text>
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
                onPress={() => void handleCreateSession()}
              >
                <Text style={[styles.btnText, { color: colors.textInverse }]}>Create fishing group</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>People in this group</Text>
                {members.length === 0 ? (
                  <Text style={{ color: colors.textSecondary }}>No members loaded.</Text>
                ) : (
                  members.map((m) => {
                    const isSelf = m.user_id === userId;
                    const row = friendRows.find((f) => f.id === m.user_id);
                    const displayName = isSelf ? 'You' : row?.label ?? m.user_id;
                    const uri = isSelf
                      ? profile?.avatar_url?.trim() || row?.avatarUrl || null
                      : row?.avatarUrl ?? null;
                    const letter = isSelf
                      ? profileInitialLetter(profile)
                      : initialFromDisplayName(row?.label ?? '');
                    const suffix = m.role === 'owner' ? ' (owner)' : '';
                    return (
                      <View key={m.user_id} style={styles.memberRow}>
                        {uri ? (
                          <Image
                            source={{ uri }}
                            style={[styles.memberAvatar, { backgroundColor: colors.borderLight }]}
                            contentFit="cover"
                            accessibilityIgnoresInvertColors
                          />
                        ) : (
                          <View style={[styles.memberAvatar, { backgroundColor: colors.primary }]}>
                            <Text style={[styles.memberAvatarLetter, { color: colors.textInverse }]}>{letter}</Text>
                          </View>
                        )}
                        <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                          {displayName}
                          {suffix}
                        </Text>
                      </View>
                    );
                  })
                )}
              </View>

              {invitesOut.length > 0 ? (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Pending invites</Text>
                  <Text style={[styles.hint, { color: colors.textSecondary, marginBottom: Spacing.sm }]}>
                    Waiting for them to accept from their Home or Friends screen.
                  </Text>
                  {invitesOut.map((i) => {
                    const row = friendRows.find((f) => f.id === i.invitee_id);
                    const label = row?.label ?? 'Friend';
                    const uri = row?.avatarUrl;
                    const letter = initialFromDisplayName(label);
                    return (
                      <View key={i.id} style={styles.memberRow}>
                        {uri ? (
                          <Image
                            source={{ uri }}
                            style={[styles.memberAvatar, { backgroundColor: colors.borderLight }]}
                            contentFit="cover"
                            accessibilityIgnoresInvertColors
                          />
                        ) : (
                          <View style={[styles.memberAvatar, { backgroundColor: colors.primary }]}>
                            <Text style={[styles.memberAvatarLetter, { color: colors.textInverse }]}>{letter}</Text>
                          </View>
                        )}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.memberName, { color: colors.text }]} numberOfLines={1}>
                            {label}
                          </Text>
                          <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }} numberOfLines={1}>
                            Waiting for response…
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Invite a friend</Text>
                {friendsNotInSession.length === 0 ? (
                  <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>
                    Add friends from Profile → Friends, then invite them here.
                  </Text>
                ) : (
                  friendsNotInSession.map((f) => {
                    const uri = f.avatarUrl;
                    const letter = initialFromDisplayName(f.label);
                    return (
                      <Pressable
                        key={f.id}
                        style={[styles.inviteRow, { borderColor: colors.border }]}
                        onPress={() => void handleInvite(f.id)}
                      >
                        <View style={styles.inviteRowLeft}>
                          {uri ? (
                            <Image
                              source={{ uri }}
                              style={[styles.memberAvatar, { backgroundColor: colors.borderLight }]}
                              contentFit="cover"
                              accessibilityIgnoresInvertColors
                            />
                          ) : (
                            <View style={[styles.memberAvatar, { backgroundColor: colors.primary }]}>
                              <Text style={[styles.memberAvatarLetter, { color: colors.textInverse }]}>{letter}</Text>
                            </View>
                          )}
                          <Text style={[styles.inviteRowLabel, { color: colors.text }]} numberOfLines={1}>
                            {f.label}
                          </Text>
                        </View>
                        <MaterialIcons name="person-add" size={22} color={colors.primary} />
                      </Pressable>
                    );
                  })
                )}
              </View>

              <View style={styles.section}>
                <Pressable onPress={() => void handleDetach()}>
                  <Text style={{ color: colors.error, fontWeight: '600' }}>Leave group / unlink this trip</Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: FontSize.lg, fontWeight: '700' },
  body: { padding: Spacing.md, paddingBottom: Spacing.xl },
  section: { marginBottom: Spacing.lg },
  sectionTitle: { fontSize: FontSize.md, fontWeight: '700', marginBottom: Spacing.sm },
  hint: { fontSize: FontSize.sm, marginBottom: Spacing.md, lineHeight: 20 },
  primaryBtn: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
  card: {
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  rowBtns: { flexDirection: 'row', gap: Spacing.sm },
  btn: { flex: 1, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, alignItems: 'center' },
  btnText: { fontWeight: '600', fontSize: FontSize.sm },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  inviteRowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minWidth: 0 },
  inviteRowLabel: { flex: 1, fontSize: FontSize.md, fontWeight: '500' },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
    minHeight: MEMBER_AVATAR,
  },
  memberAvatar: {
    width: MEMBER_AVATAR,
    height: MEMBER_AVATAR,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  memberAvatarLetter: { fontSize: FontSize.md, fontWeight: '700' },
  memberName: { flex: 1, fontSize: FontSize.md, fontWeight: '500', minWidth: 0 },
});
