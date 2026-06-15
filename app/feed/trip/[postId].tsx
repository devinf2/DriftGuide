import { Image } from 'expo-image';
import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { fetchPostTripView, type PostTripView } from '@/src/services/feedService';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { CatchData } from '@/src/types';
import { formatTripDate, formatTripDuration, formatEventTime } from '@/src/utils/formatters';
import { formatCatchWeightLabel } from '@/src/utils/journalTimeline';

type CatchRowVm = {
  id: string;
  time: string;
  species: string;
  meta: string | null;
  note: string | null;
  photo: string | null;
};

export default function PostTripViewScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { postId } = useLocalSearchParams<{ postId: string }>();

  const [data, setData] = useState<PostTripView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void fetchPostTripView(String(postId)).then((res) => {
      if (!alive) return;
      setData(res);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [postId]);

  const trip = data?.trip ?? null;
  const locationName =
    (data?.location?.name as string | undefined) ?? (trip?.location as { name?: string })?.name ?? 'Fishing trip';

  const durationLabel = trip
    ? formatTripDuration(String(trip.start_time), (trip.end_time as string | null) ?? null, {
        activeFishingMs: (trip.active_fishing_ms as number | null) ?? null,
      })
    : '';

  const photoByCatchId = useMemo(() => {
    const map = new Map<string, string>();
    for (const ph of data?.photos ?? []) {
      const cid = ph.catch_id as string | null;
      const url = ph.url as string | null;
      if (cid && url && !map.has(cid)) map.set(cid, url);
    }
    return map;
  }, [data?.photos]);

  const catches: CatchRowVm[] = useMemo(() => {
    const rows = (data?.events ?? []).filter((e) => e.event_type === 'catch');
    return rows.map((e) => {
      const d = (e.data ?? {}) as CatchData;
      const size = d.size_inches != null ? `${Number(d.size_inches)}"` : null;
      const weight = formatCatchWeightLabel(d.weight_lb ?? null, d.weight_oz ?? null);
      const meta = [size, weight].filter(Boolean).join(' · ') || null;
      return {
        id: String(e.id),
        time: formatEventTime(String(e.timestamp)),
        species: d.species || 'Fish',
        meta,
        note: d.note || null,
        photo: d.photo_url || photoByCatchId.get(String(e.id)) || null,
      };
    });
  }, [data?.events, photoByCatchId]);

  const galleryPhotos = useMemo(
    () => (data?.photos ?? []).map((p) => p.url as string).filter(Boolean),
    [data?.photos],
  );

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn} accessibilityLabel="Back">
            <MaterialIcons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {locationName}
          </Text>
          <View style={{ width: 28 }} />
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : !trip ? (
          <View style={styles.center}>
            <MaterialIcons name="lock-outline" size={28} color={colors.textTertiary} />
            <Text style={styles.emptyText}>This trip isn’t available to view.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll}>
            <View style={styles.statsRow}>
              <Stat label="Date" value={formatTripDate(String(trip.start_time))} styles={styles} />
              <Stat label="Duration" value={durationLabel} styles={styles} />
              <Stat label="Fish" value={String(trip.total_fish ?? catches.length)} styles={styles} />
            </View>

            {catches.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Catches</Text>
                {catches.map((c) => (
                  <View key={c.id} style={styles.catchRow}>
                    {c.photo ? (
                      <Image source={{ uri: c.photo }} style={styles.catchThumb} contentFit="cover" />
                    ) : (
                      <View style={[styles.catchThumb, styles.catchThumbEmpty]}>
                        <MaterialIcons name="set-meal" size={20} color={colors.textTertiary} />
                      </View>
                    )}
                    <View style={styles.catchInfo}>
                      <Text style={styles.catchSpecies}>{c.species}</Text>
                      {c.meta ? <Text style={styles.catchMeta}>{c.meta}</Text> : null}
                      {c.note ? <Text style={styles.catchNote}>{c.note}</Text> : null}
                      <Text style={styles.catchTime}>{c.time}</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {galleryPhotos.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Photos</Text>
                <View style={styles.gallery}>
                  {galleryPhotos.map((uri) => (
                    <Image key={uri} source={{ uri }} style={styles.galleryPhoto} contentFit="cover" />
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </>
  );
}

function Stat({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    backBtn: { padding: 2 },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
    emptyText: { color: colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center' },
    scroll: { padding: Spacing.md, paddingBottom: Spacing.xxl },
    statsRow: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.md,
      marginBottom: Spacing.lg,
    },
    stat: { flex: 1, alignItems: 'center' },
    statValue: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    statLabel: { fontSize: FontSize.xs, color: colors.textSecondary, marginTop: 2 },
    section: { marginBottom: Spacing.lg },
    sectionTitle: { fontSize: FontSize.md, fontWeight: '700', color: colors.text, marginBottom: Spacing.sm },
    catchRow: {
      flexDirection: 'row',
      gap: Spacing.md,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.sm,
      padding: Spacing.sm,
      marginBottom: Spacing.sm,
      alignItems: 'center',
    },
    catchThumb: { width: 60, height: 60, borderRadius: BorderRadius.sm, backgroundColor: colors.background },
    catchThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
    catchInfo: { flex: 1 },
    catchSpecies: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    catchMeta: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 1 },
    catchNote: { fontSize: FontSize.sm, color: colors.text, marginTop: 2 },
    catchTime: { fontSize: FontSize.xs, color: colors.textTertiary, marginTop: 2 },
    gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
    galleryPhoto: { width: '32%', aspectRatio: 1, borderRadius: BorderRadius.sm, backgroundColor: colors.surface },
  });
}
