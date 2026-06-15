import { OfflineTripPhotoImage } from '@/src/components/OfflineTripPhotoImage';
import { SinglePhotoZoomModal } from '@/src/components/SinglePhotoZoomModal';
import { PLAN_TRIP_FAB_MAP_CLEARANCE } from '@/src/constants/mapTabChrome';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { fetchProfileStats, ProfileStats, BiggestFishCatch } from '@/src/services/profileStats';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useAuthStore } from '@/src/stores/authStore';
import { endOfMonth, startOfMonth, subMonths } from 'date-fns';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const RANGES = [
  { label: '1 month', short: '1M', months: 1 },
  { label: '3 months', short: '3M', months: 3 },
  { label: '6 months', short: '6M', months: 6 },
  { label: '1 year', short: '1Y', months: 12 },
  { label: 'All time', short: 'All', months: 60 },
] as const;

const CHART_VISIBLE_MONTHS = 6;
const CHART_HEIGHT = 150;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

function parseForUserIdParam(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.trim();
}

function StatCard({ label, value, styles }: { label: string; value: number; styles: any }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatFishWeight(lb: number | null, oz: number | null): string | null {
  const totalOz = (lb ?? 0) * 16 + (oz ?? 0);
  if (totalOz <= 0) return null;
  const whole = Math.floor(totalOz / 16);
  const rem = Math.round(totalOz - whole * 16);
  if (whole > 0 && rem > 0) return `${whole} lb ${rem} oz`;
  if (whole > 0) return `${whole} lb`;
  return `${rem} oz`;
}

function BiggestFishRow({
  rank,
  fish,
  onPressPhoto,
  styles,
  colors,
}: {
  rank: number;
  fish: BiggestFishCatch;
  onPressPhoto: (uri: string) => void;
  styles: any;
  colors: ThemeColors;
}) {
  const weight = formatFishWeight(fish.weightLb, fish.weightOz);
  const meta = [fish.sizeInches != null ? `${fish.sizeInches}"` : null, weight]
    .filter(Boolean)
    .join(' · ');
  const photo = fish.photoUrl?.trim();

  return (
    <View style={styles.fishRow}>
      <Text style={styles.fishRank}>{rank}</Text>
      <View style={styles.fishInfo}>
        <Text style={styles.fishSpecies} numberOfLines={1}>
          {fish.species || 'Unknown species'}
        </Text>
        {meta ? <Text style={styles.fishMeta}>{meta}</Text> : null}
      </View>
      {photo ? (
        <Pressable onPress={() => onPressPhoto(photo)} style={styles.fishThumbWrap}>
          {photo.startsWith('http') ? (
            <OfflineTripPhotoImage remoteUri={photo} maxPixelSize={150} style={styles.fishThumb} contentFit="cover" />
          ) : (
            <Image source={{ uri: photo }} style={styles.fishThumb} contentFit="cover" cachePolicy="memory-disk" />
          )}
          <View style={styles.fishThumbBadge}>
            <MaterialCommunityIcons name="magnify-plus-outline" size={12} color={colors.textInverse} />
          </View>
        </Pressable>
      ) : (
        <View style={[styles.fishThumb, styles.fishThumbEmpty]}>
          <MaterialCommunityIcons name="fish" size={20} color={colors.textTertiary} />
        </View>
      )}
    </View>
  );
}

export default function ProfileStatsScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStatsStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { forUserId: forUserIdParam, ownerName: ownerNameParam } = useLocalSearchParams<{
    forUserId?: string | string[];
    ownerName?: string | string[];
  }>();
  const forUserId = useMemo(() => parseForUserIdParam(forUserIdParam), [forUserIdParam]);
  const ownerNameFromParam = useMemo(() => {
    const v = Array.isArray(ownerNameParam) ? ownerNameParam[0] : ownerNameParam;
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }, [ownerNameParam]);
  const statsUserId = forUserId ?? user?.id ?? null;
  const viewingPeer = Boolean(user && forUserId && forUserId !== user.id);
  const reportTitle =
    viewingPeer && ownerNameFromParam ? `${ownerNameFromParam}'s report` : 'Your report';
  const [rangeIdx, setRangeIdx] = useState(1);
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [rangePickerOpen, setRangePickerOpen] = useState(false);
  const [zoomPhotoUri, setZoomPhotoUri] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    if (!statsUserId) return;
    setLoading(true);
    const now = new Date();
    const end = endOfMonth(now);
    const start = startOfMonth(subMonths(now, RANGES[rangeIdx].months - 1));
    const result = await fetchProfileStats(statsUserId, start, end);
    setStats(result);
    setLoading(false);
  }, [statsUserId, rangeIdx]);

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [loadStats]),
  );

  /** Brand-new angler: no trips logged yet in this range. Show an illustrative preview instead of zeros. */
  const noData = Boolean(stats) && stats!.tripCount === 0 && stats!.totalCatches === 0;
  const maxFish = stats ? Math.max(...stats.fishPerMonth.map((m) => m.count), 1) : 1;
  const chartVisibleWidth = SCREEN_WIDTH - Spacing.xl * 2 - Spacing.lg * 2;
  const monthCount = stats?.fishPerMonth.length ?? 0;
  const barWidth =
    monthCount <= CHART_VISIBLE_MONTHS
      ? monthCount > 0
        ? chartVisibleWidth / monthCount
        : chartVisibleWidth / CHART_VISIBLE_MONTHS
      : chartVisibleWidth / CHART_VISIBLE_MONTHS;
  const chartContentWidth = monthCount > 0 ? monthCount * barWidth : chartVisibleWidth;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingBottom: insets.bottom + Spacing.xl + PLAN_TRIP_FAB_MAP_CLEARANCE },
      ]}
    >
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.sectionTitle}>{reportTitle}</Text>
          <Pressable style={styles.dropdown} onPress={() => setRangePickerOpen(true)}>
            <Text style={styles.dropdownText}>{RANGES[rangeIdx].label}</Text>
            <Text style={styles.dropdownChevron}>▾</Text>
          </Pressable>
        </View>

        <Modal
          visible={rangePickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setRangePickerOpen(false)}
        >
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setRangePickerOpen(false)}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Date range</Text>
              {RANGES.map((r, i) => (
                <TouchableOpacity
                  key={r.short}
                  style={[styles.modalOption, rangeIdx === i && styles.modalOptionActive]}
                  onPress={() => {
                    setRangeIdx(i);
                    setRangePickerOpen(false);
                  }}
                >
                  <Text
                    style={[styles.modalOptionText, rangeIdx === i && styles.modalOptionTextActive]}
                  >
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>

        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginVertical: Spacing.xxl }} />
        ) : stats ? (
          <View style={styles.statsGrid}>
            <View style={styles.statsRow}>
              <StatCard label="Trips" value={stats.tripCount} styles={styles} />
              <StatCard label="Fish Caught" value={stats.totalFish} styles={styles} />
            </View>
            <View style={styles.statsRow}>
              <StatCard label="Catches" value={stats.totalCatches} styles={styles} />
              <StatCard label="Species" value={stats.speciesCount} styles={styles} />
            </View>
          </View>
        ) : null}
      </View>

      {!loading && noData ? (
        /* Illustrative preview so a brand-new angler sees what their report will look like. */
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.sectionTitleStandalone}>Your report, once you start logging</Text>
            <Text style={styles.previewLead}>
              Log a trip and DriftGuide fills this in automatically — fish per month, your go-to
              flies, and what produces. Here&apos;s an example:
            </Text>
            <View style={styles.previewGrid} pointerEvents="none">
              <View style={styles.previewRow}>
                <View style={styles.previewStatCard}>
                  <Text style={styles.previewStatValue}>8</Text>
                  <Text style={styles.previewStatLabel}>Trips</Text>
                </View>
                <View style={styles.previewStatCard}>
                  <Text style={styles.previewStatValue}>34</Text>
                  <Text style={styles.previewStatLabel}>Fish Caught</Text>
                </View>
              </View>
              <View style={styles.previewRow}>
                <View style={styles.previewStatCard}>
                  <Text style={styles.previewStatValue}>5</Text>
                  <Text style={styles.previewStatLabel}>Species</Text>
                </View>
                <View style={styles.previewStatCard}>
                  <Text style={styles.previewStatValue}>Zebra Midge</Text>
                  <Text style={styles.previewStatLabel}>Top fly</Text>
                </View>
              </View>
            </View>
            <Text style={styles.previewSample}>Sample data</Text>
          </View>
        </View>
      ) : null}

      {!loading && stats && !noData ? (
        <>
          <View style={styles.section}>
            <View style={[styles.card, styles.chartCard]}>
              <Text style={styles.sectionTitleStandalone}>Fish per month</Text>
              {stats.fishPerMonth.length === 0 ? (
                <Text style={styles.emptyText}>No data for this period</Text>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator
                  style={styles.chartScroll}
                  contentContainerStyle={{ width: chartContentWidth }}
                >
                  {stats.fishPerMonth.map((m, i) => {
                    const h = maxFish > 0 ? (m.count / maxFish) * CHART_HEIGHT : 0;
                    return (
                      <View key={i} style={[styles.barCol, { width: barWidth }]}>
                        {m.count > 0 && <Text style={styles.barVal}>{m.count}</Text>}
                        <View
                          style={[
                            styles.bar,
                            { height: Math.max(h, m.count > 0 ? 4 : 2) },
                            m.count === 0 && styles.barEmpty,
                          ]}
                        />
                        <Text style={styles.barLbl}>{m.month}</Text>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.card}>
              <Text style={styles.sectionTitleStandalone}>Flies</Text>
              {stats.favoriteFly || stats.bestFly ? (
                <View style={styles.fliesCol}>
                  <View style={styles.flyBlock}>
                    <Text style={styles.flyBlockLabel}>Favorite</Text>
                    {stats.favoriteFly ? (
                      <>
                        <Text style={styles.flyName} numberOfLines={1}>
                          {stats.favoriteFly.name}
                        </Text>
                        <Text style={styles.flyMeta}>
                          {stats.favoriteFly.uses} {stats.favoriteFly.uses === 1 ? 'use' : 'uses'}
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.flyMeta}>—</Text>
                    )}
                  </View>
                  <View style={styles.flyBlock}>
                    <Text style={styles.flyBlockLabel}>Best</Text>
                    {stats.bestFly ? (
                      <>
                        <Text style={styles.flyName} numberOfLines={1}>
                          {stats.bestFly.name}
                        </Text>
                        <Text style={styles.flyMeta}>
                          {stats.bestFly.uses > 0
                            ? (stats.bestFly.fishCaught / stats.bestFly.uses).toFixed(1)
                            : '0'}{' '}
                          fish/use
                        </Text>
                      </>
                    ) : (
                      <Text style={styles.flyMeta}>—</Text>
                    )}
                  </View>
                </View>
              ) : (
                <Text style={styles.emptyText}>No fly data yet</Text>
              )}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.card}>
              <Text style={styles.sectionTitleStandalone}>Biggest fish</Text>
              {stats.biggestFish.length > 0 ? (
                <View style={styles.fishList}>
                  {stats.biggestFish.map((fish, i) => (
                    <BiggestFishRow
                      key={fish.id}
                      rank={i + 1}
                      fish={fish}
                      onPressPhoto={setZoomPhotoUri}
                      styles={styles}
                      colors={colors}
                    />
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyText}>No fish with a recorded size yet</Text>
              )}
            </View>
          </View>
        </>
      ) : null}

      <SinglePhotoZoomModal
        visible={zoomPhotoUri != null}
        uri={zoomPhotoUri}
        onClose={() => setZoomPhotoUri(null)}
        closeButtonTop={insets.top + Spacing.lg}
      />
    </ScrollView>
  );
}

function createStatsStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: Spacing.xl },
    section: { marginTop: Spacing.lg },
    card: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.lg,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
        android: { elevation: 2 },
      }),
    },
    cardHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: Spacing.sm,
    },
    sectionTitle: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    sectionTitleStandalone: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: Spacing.sm,
    },
    dropdown: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dropdownText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.text },
    dropdownChevron: { fontSize: 12, color: colors.textSecondary },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'center',
      padding: Spacing.lg,
    },
    modalContent: { backgroundColor: colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
    modalTitle: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: Spacing.sm,
      paddingHorizontal: Spacing.xs,
    },
    modalOption: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm, borderRadius: BorderRadius.sm },
    modalOptionActive: { backgroundColor: `${colors.primary}18` },
    modalOptionText: { fontSize: FontSize.md, color: colors.text },
    modalOptionTextActive: { fontWeight: '600', color: colors.primary },
    statsGrid: { gap: Spacing.sm },
    statsRow: { flexDirection: 'row', gap: Spacing.sm },
    statCard: {
      flex: 1,
      backgroundColor: colors.background,
      borderRadius: BorderRadius.sm,
      paddingVertical: Spacing.lg,
      paddingHorizontal: Spacing.md,
      alignItems: 'center',
    },
    statValue: { fontSize: FontSize.xxl, fontWeight: '700', color: colors.text },
    statLabel: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: Spacing.xs },
    chartCard: { minHeight: CHART_HEIGHT + 60 },
    chartScroll: {},
    barCol: {
      alignItems: 'center',
      justifyContent: 'flex-end',
      height: CHART_HEIGHT + 32,
    },
    barVal: { fontSize: 10, fontWeight: '600', color: colors.primary, marginBottom: 2 },
    bar: {
      width: '55%',
      backgroundColor: colors.primary,
      borderTopLeftRadius: 4,
      borderTopRightRadius: 4,
    },
    barEmpty: { backgroundColor: colors.borderLight },
    barLbl: { fontSize: 9, color: colors.textTertiary, marginTop: 4 },
    emptyText: {
      fontSize: FontSize.sm,
      color: colors.textTertiary,
      textAlign: 'center',
      paddingVertical: Spacing.xl,
    },
    fliesCol: { gap: Spacing.sm },
    flyBlock: {
      backgroundColor: colors.background,
      borderRadius: BorderRadius.sm,
      padding: Spacing.md,
    },
    flyBlockLabel: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: Spacing.xs,
    },
    flyName: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
    flyMeta: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 2 },
    fishList: { gap: Spacing.sm },
    fishRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: colors.background,
      borderRadius: BorderRadius.sm,
      padding: Spacing.md,
    },
    fishRank: {
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.textTertiary,
      width: 20,
      textAlign: 'center',
    },
    fishInfo: { flex: 1 },
    fishSpecies: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    fishMeta: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 2 },
    fishThumbWrap: { position: 'relative' },
    fishThumb: {
      width: 56,
      height: 56,
      borderRadius: BorderRadius.sm,
      backgroundColor: colors.borderLight,
    },
    fishThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
    fishThumbBadge: {
      position: 'absolute',
      right: 3,
      bottom: 3,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: 8,
      padding: 2,
    },
    previewLead: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 20,
      marginBottom: Spacing.md,
    },
    previewGrid: { gap: Spacing.sm, opacity: 0.8 },
    previewRow: { flexDirection: 'row', gap: Spacing.sm },
    previewStatCard: {
      flex: 1,
      backgroundColor: colors.background,
      borderRadius: BorderRadius.sm,
      paddingVertical: Spacing.lg,
      paddingHorizontal: Spacing.md,
      alignItems: 'center',
    },
    previewStatValue: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text },
    previewStatLabel: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: Spacing.xs },
    previewSample: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      fontStyle: 'italic',
      marginTop: Spacing.md,
      textAlign: 'center',
    },
  });
}
