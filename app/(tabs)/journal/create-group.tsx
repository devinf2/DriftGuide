import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { BorderRadius, FontSize, Spacing } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { fetchTripsFromCloud } from '@/src/services/sync';
import { attachTripToSession, createSharedSession } from '@/src/services/sharedSessionService';
import type { Trip } from '@/src/types';
import { formatTripDate } from '@/src/utils/formatters';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';

export default function CreateGroupSessionScreen() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const effectiveTop = useEffectiveSafeTopInset();
  const { user } = useAuthStore();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const all = await fetchTripsFromCloud(user.id);
      setTrips(all.filter((t) => t.status === 'completed' && !t.deleted_at));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!user?.id || selected.size === 0) {
      Alert.alert('Select trips', 'Choose at least one completed trip.');
      return;
    }
    setSaving(true);
    try {
      const sid = await createSharedSession('Fishing group', user.id);
      if (!sid) {
        Alert.alert('Error', 'Could not create group.');
        return;
      }
      for (const tripId of selected) {
        const ok = await attachTripToSession(tripId, sid);
        if (!ok) {
          Alert.alert('Partial success', 'Some trips may not have linked. Check each trip’s group settings.');
          break;
        }
      }
      Alert.alert('Group created', 'Invite friends from each trip’s People / group screen.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['bottom']}>
      <View style={[styles.topBar, { paddingTop: effectiveTop + Spacing.sm, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Group trips</Text>
        <View style={{ width: 28 }} />
      </View>

      <Text style={[styles.hint, { color: colors.textSecondary, paddingHorizontal: Spacing.md }]}>
        Select completed trips to put in one fishing group. You can invite friends from Profile → Friends, then use each
        trip’s group button to add them.
      </Text>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: Spacing.xl }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {trips.map((t) => {
            const on = selected.has(t.id);
            return (
              <Pressable
                key={t.id}
                style={[styles.row, { borderColor: colors.border, backgroundColor: on ? colors.surfaceElevated : colors.surface }]}
                onPress={() => toggle(t.id)}
              >
                <MaterialIcons name={on ? 'check-box' : 'check-box-outline-blank'} size={24} color={colors.primary} />
                <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>
                    {t.location?.name ?? 'Trip'}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>{formatTripDate(t.start_time)}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <View style={{ padding: Spacing.md }}>
        <Pressable
          style={[styles.createBtn, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}
          onPress={() => void handleCreate()}
          disabled={saving || selected.size === 0}
        >
          {saving ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={{ color: colors.textInverse, fontWeight: '700' }}>Create group</Text>
          )}
        </Pressable>
      </View>
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
  title: { fontSize: FontSize.lg, fontWeight: '700' },
  hint: { fontSize: FontSize.sm, lineHeight: 20, marginTop: Spacing.sm, marginBottom: Spacing.md },
  list: { padding: Spacing.md, gap: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
  },
  createBtn: {
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: 'center',
  },
});
