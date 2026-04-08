import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { MaterialIcons } from '@expo/vector-icons';
import { BorderRadius, FontSize, Spacing } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { fetchProfile, otherUserIdFromFriendship } from '@/src/services/friendsService';
import {
  acceptSessionInvite,
  attachTripToSession,
  createSharedSession,
  declineSessionInvite,
  detachTripFromSession,
  findTripForUserInSession,
  inviteToSession,
  leaveSession,
  listPendingSessionInvitesForUser,
  listSessionInvitesSentFromSession,
  listSessionMembers,
  listSharedSessionIdsForUser,
} from '@/src/services/sharedSessionService';
import type { FriendshipRow, SessionInvite, SessionMember } from '@/src/types';

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
  const { colors } = useAppTheme();
  const [members, setMembers] = useState<SessionMember[]>([]);
  const [invitesOut, setInvitesOut] = useState<SessionInvite[]>([]);
  const [invitesIn, setInvitesIn] = useState<SessionInvite[]>([]);
  const [loading, setLoading] = useState(false);
  const [friendRows, setFriendRows] = useState<{ id: string; label: string }[]>([]);
  const [sessionsWithoutLinkedTrip, setSessionsWithoutLinkedTrip] = useState<string[]>([]);

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
      if (sharedSessionId) {
        const [m, o] = await Promise.all([
          listSessionMembers(sharedSessionId),
          listSessionInvitesSentFromSession(sharedSessionId),
        ]);
        sessionMembers = m;
        setMembers(m);
        setInvitesOut(o.filter((i) => i.status === 'pending'));
      } else {
        setMembers([]);
        setInvitesOut([]);
      }

      const rows: { id: string; label: string }[] = [];
      for (const f of acceptedFriends) {
        const oid = otherUserIdFromFriendship(f, userId);
        const p = await fetchProfile(oid);
        rows.push({ id: oid, label: p?.display_name?.trim() || 'Friend' });
      }
      for (const mem of sessionMembers) {
        if (!rows.some((r) => r.id === mem.user_id)) {
          const p = await fetchProfile(mem.user_id);
          rows.push({ id: mem.user_id, label: p?.display_name?.trim() || 'Angler' });
        }
      }
      setFriendRows(rows);

      const mySessions = await listSharedSessionIdsForUser(userId);
      const unlinked: string[] = [];
      for (const sid of mySessions) {
        const linked = await findTripForUserInSession(sid, userId);
        if (!linked) unlinked.push(sid);
      }
      setSessionsWithoutLinkedTrip(unlinked);
    } finally {
      setLoading(false);
    }
  }, [userId, sharedSessionId, acceptedFriends]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const memberIds = useMemo(() => new Set(members.map((m) => m.user_id)), [members]);

  const friendsNotInSession = useMemo(() => {
    return friendRows.filter((r) => !memberIds.has(r.id));
  }, [friendRows, memberIds]);

  const handleCreateSession = async () => {
    const sid = await createSharedSession(null, userId);
    if (!sid) {
      Alert.alert('Could not create group', 'Try again.');
      return;
    }
    const ok = await attachTripToSession(tripId, sid);
    if (!ok) {
      Alert.alert('Could not link trip', 'Try again.');
      return;
    }
    onSessionChanged(sid);
    await load();
  };

  const handleInvite = async (friendId: string) => {
    if (!sharedSessionId) return;
    const ok = await inviteToSession(sharedSessionId, userId, friendId);
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

  const handleAcceptIncoming = async (inv: SessionInvite) => {
    const ok = await acceptSessionInvite(inv, userId);
    if (!ok) {
      Alert.alert('Could not accept', 'Try again.');
      return;
    }
    Alert.alert(
      'You joined the group',
      'Link this trip: tap “Link this trip to this group” below, or reopen this sheet after opening the trip you want to share.',
    );
    await load();
  };

  const handleLinkTripToSession = async (sessionId: string) => {
    const ok = await attachTripToSession(tripId, sessionId);
    if (!ok) {
      Alert.alert('Could not link', 'Try again when online.');
      return;
    }
    onSessionChanged(sessionId);
    await load();
  };

  const handleDeclineIncoming = async (inv: SessionInvite) => {
    await declineSessionInvite(inv.id);
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
                    Someone invited you to fish together. Accept to join; then link your trip from this screen or the
                    journal.
                  </Text>
                  <View style={styles.rowBtns}>
                    <Pressable
                      style={[styles.btn, { backgroundColor: colors.primary }]}
                      onPress={() => void handleAcceptIncoming(inv)}
                    >
                      <Text style={[styles.btnText, { color: colors.textInverse }]}>Accept</Text>
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

          {!sharedSessionId && sessionsWithoutLinkedTrip.length > 0 ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Link to a group you joined</Text>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>
                After accepting an invite, attach this trip to that fishing group.
              </Text>
              {sessionsWithoutLinkedTrip.map((sid) => (
                <Pressable
                  key={sid}
                  style={[styles.primaryBtn, { backgroundColor: colors.secondary, marginBottom: Spacing.sm }]}
                  onPress={() => void handleLinkTripToSession(sid)}
                >
                  <Text style={[styles.btnText, { color: colors.textInverse }]}>
                    Link trip to group ({sid.slice(0, 8)}…)
                  </Text>
                </Pressable>
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
                  members.map((m) => (
                    <Text key={m.user_id} style={{ color: colors.text, marginBottom: Spacing.xs }}>
                      {m.user_id === userId ? 'You' : friendRows.find((f) => f.id === m.user_id)?.label ?? m.user_id}
                      {m.role === 'owner' ? ' (owner)' : ''}
                    </Text>
                  ))
                )}
              </View>

              {invitesOut.length > 0 ? (
                <View style={styles.section}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Pending invites</Text>
                  {invitesOut.map((i) => (
                    <Text key={i.id} style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>
                      Waiting for response…
                    </Text>
                  ))}
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Invite a friend</Text>
                {friendsNotInSession.length === 0 ? (
                  <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>
                    Add friends from Profile → Friends, then invite them here.
                  </Text>
                ) : (
                  friendsNotInSession.map((f) => (
                    <Pressable
                      key={f.id}
                      style={[styles.inviteRow, { borderColor: colors.border }]}
                      onPress={() => void handleInvite(f.id)}
                    >
                      <Text style={{ color: colors.text }}>{f.label}</Text>
                      <MaterialIcons name="person-add" size={22} color={colors.primary} />
                    </Pressable>
                  ))
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
  },
});
