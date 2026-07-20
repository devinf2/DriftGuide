import { HatchEntryVisualCard } from '@/src/components/hatchChart/HatchEntryVisualCard';
import { HatchYearMatrix } from '@/src/components/hatchChart/HatchYearMatrix';
import {
  DRIFTGUIDE_HATCH_CHART_ENTRIES,
  DRIFTGUIDE_HATCH_CHART_INTRO,
  entriesStrongThisMonth,
  hatchEntriesSortedByMonthActivity,
  hatchFliesByStage,
  resolveHatchChartEntry,
  type DriftGuideHatchChartEntry,
  type HatchFly,
} from '@/src/data/driftGuideHatchChart';
import { hatchCategoryColor } from '@/src/components/hatchChart/hatchChartTheme';
import { HatchFlyDetailModal } from '@/src/components/hatchChart/HatchFlyDetailModal';
import { AddFlySheet } from '@/src/components/fly/AddFlySheet';
import { FlyImagePreviewModal } from '@/src/components/fly/FlyImagePreviewModal';
import { getBundledFlyImageSource } from '@/src/constants/flyImages';
import { bundledCatalogIdForName } from '@/src/constants/bundledFlyCatalog';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import type { Fly, FlyCatalog } from '@/src/types';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { getFlyCatalogOrBundled, fetchFliesOrCache } from '@/src/services/flyService';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, type ImageSourcePropType, type LayoutChangeEvent, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Resolve a tapped matching fly to a catalog entry (real match by name, else a bundled stub). */
function resolveCatalogFlyForHatchFly(fly: HatchFly, catalog: FlyCatalog[]): FlyCatalog {
  const match = catalog.find((c) => c.name.toLowerCase() === fly.name.toLowerCase());
  if (match) return match;
  return {
    id: bundledCatalogIdForName(fly.name),
    name: fly.name,
    type: 'fly',
    photo_url: null,
    presentation: null,
  };
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scroll: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.xl,
    },
    hero: {
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: Spacing.md,
      marginBottom: Spacing.md,
    },
    heroTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    heroMonth: {
      fontSize: FontSize.xl,
      fontWeight: '800',
      color: colors.text,
      fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: undefined }),
    },
    heroSub: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 21,
      marginBottom: Spacing.sm,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
    },
    chip: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: BorderRadius.md,
      borderWidth: StyleSheet.hairlineWidth,
    },
    chipText: {
      fontSize: FontSize.xs,
      fontWeight: '700',
    },
    intro: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 22,
      marginBottom: Spacing.md,
    },
    sectionTitle: {
      fontSize: FontSize.sm,
      fontWeight: '800',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: Spacing.sm,
    },
    footer: {
      marginTop: Spacing.md,
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      lineHeight: 18,
      fontStyle: 'italic',
    },
    fliesInline: {
      marginTop: Spacing.sm,
      paddingTop: Spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    fliesHeader: {
      fontSize: FontSize.xs,
      fontWeight: '800',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: Spacing.sm,
    },
    fliesStageLabel: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      marginBottom: 6,
    },
    fliesStrip: {
      gap: Spacing.sm,
      paddingRight: Spacing.md,
    },
    flyItem: {
      width: 76,
      alignItems: 'center',
    },
    flyImage: {
      width: 64,
      height: 64,
      borderRadius: BorderRadius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceElevated,
    },
    flyName: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
      marginTop: 4,
    },
    flySize: {
      fontSize: 10,
      color: colors.textTertiary,
      textAlign: 'center',
    },
  });
}

type MatchingFliesStripProps = {
  entry: DriftGuideHatchChartEntry;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
  onSelectFly: (fly: HatchFly, entry: DriftGuideHatchChartEntry) => void;
};

/** Horizontal "Matching flies" strip, grouped by life stage, with bundled fly images. */
function MatchingFliesStrip({ entry, colors, styles, onSelectFly }: MatchingFliesStripProps) {
  const groups = useMemo(() => hatchFliesByStage(entry), [entry]);
  const accent = hatchCategoryColor(entry.category, colors);
  if (groups.length === 0) return null;

  return (
    <View style={styles.fliesInline}>
      <Text style={styles.fliesHeader}>Matching flies</Text>
      {groups.map((group) => (
        <View key={group.stage} style={{ marginBottom: Spacing.sm }}>
          <Text style={[styles.fliesStageLabel, { color: accent }]}>{group.label}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fliesStrip}>
            {group.flies.map((fly) => {
              const source = getBundledFlyImageSource(fly.name);
              return (
                <Pressable
                  key={`${group.stage}-${fly.name}`}
                  style={({ pressed }) => [styles.flyItem, pressed && { opacity: 0.7 }]}
                  onPress={() => onSelectFly(fly, entry)}
                  accessibilityRole="button"
                  accessibilityLabel={`${fly.name}${fly.size ? `, ${fly.size}` : ''}`}
                  accessibilityHint="Use this fly when logging a catch"
                >
                  {source ? (
                    <Image source={source} style={styles.flyImage} resizeMode="cover" />
                  ) : (
                    <View style={styles.flyImage} />
                  )}
                  <Text style={styles.flyName} numberOfLines={2}>
                    {fly.name}
                  </Text>
                  {fly.size ? <Text style={styles.flySize}>{fly.size}</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ))}
    </View>
  );
}

export default function HatchChartScreen() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { user } = useAuthStore();
  const { isConnected } = useNetworkStatus();
  const [catalog, setCatalog] = useState<FlyCatalog[]>([]);
  const [ownedFlyNames, setOwnedFlyNames] = useState<Set<string>>(new Set());

  // Tapped matching fly → detail sheet.
  const [selectedFly, setSelectedFly] = useState<{
    fly: HatchFly;
    entry: DriftGuideHatchChartEntry;
  } | null>(null);
  // Add-to-fly-box flow (reuses the fly box's AddFlySheet).
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [initialCatalogFly, setInitialCatalogFly] = useState<FlyCatalog | null>(null);
  // Full-screen fly image preview.
  const [previewImage, setPreviewImage] = useState<{ source: ImageSourcePropType; title: string } | null>(null);

  const now = useMemo(() => new Date(), []);
  const monthIndex0 = now.getMonth();
  const monthName = format(now, 'MMMM');
  const strongNow = useMemo(
    () => entriesStrongThisMonth(DRIFTGUIDE_HATCH_CHART_ENTRIES, monthIndex0, 2),
    [monthIndex0],
  );
  const sorted = useMemo(
    () => hatchEntriesSortedByMonthActivity(DRIFTGUIDE_HATCH_CHART_ENTRIES, monthIndex0),
    [monthIndex0],
  );

  // Deep-link: a `focus` param (entry id or hatch name) opens that hatch expanded and scrolls to it.
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const focusEntry = useMemo(
    () => (focus ? resolveHatchChartEntry(Array.isArray(focus) ? focus[0] : focus) : undefined),
    [focus],
  );

  // Expanded entries (multiple may be open). Seed with the focused hatch.
  const [openIds, setOpenIds] = useState<Set<string>>(() =>
    focusEntry ? new Set([focusEntry.id]) : new Set(),
  );
  const toggleOpen = useCallback((id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Scroll the focused entry into view once its row has been laid out.
  const scrollRef = useRef<ScrollView>(null);
  const didScrollRef = useRef(false);
  const handleEntryLayout = useCallback(
    (id: string, e: LayoutChangeEvent) => {
      if (didScrollRef.current || !focusEntry || id !== focusEntry.id) return;
      didScrollRef.current = true;
      const y = e.nativeEvent.layout.y;
      scrollRef.current?.scrollTo({ y: Math.max(0, y - Spacing.md), animated: true });
    },
    [focusEntry],
  );

  // Catalog powers name→catalog resolution when adding a tapped fly to the box.
  useEffect(() => {
    void getFlyCatalogOrBundled().then(setCatalog);
  }, []);

  // The user's owned patterns drive the "In your fly box" indicator; refresh on focus.
  const refreshOwnedFlies = useCallback(async () => {
    if (!user) {
      setOwnedFlyNames(new Set());
      return;
    }
    try {
      const flies = await fetchFliesOrCache(user.id);
      setOwnedFlyNames(new Set(flies.map((f) => f.name.toLowerCase())));
    } catch (e) {
      console.warn('[hatch-chart] load owned flies failed', e);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      void refreshOwnedFlies();
    }, [refreshOwnedFlies]),
  );

  const handleSelectFly = useCallback((fly: HatchFly, entry: DriftGuideHatchChartEntry) => {
    setSelectedFly({ fly, entry });
  }, []);

  const handleAddToFlyBox = useCallback(() => {
    if (!selectedFly) return;
    const catalogFly = resolveCatalogFlyForHatchFly(selectedFly.fly, catalog);
    setInitialCatalogFly(catalogFly);
    setSelectedFly(null);
    setAddSheetOpen(true);
  }, [selectedFly, catalog]);

  const handleFlySaved = useCallback((fly: Fly) => {
    setOwnedFlyNames((prev) => new Set(prev).add(fly.name.toLowerCase()));
    void refreshOwnedFlies();
  }, [refreshOwnedFlies]);

  const handleViewFlyImage = useCallback(() => {
    if (!selectedFly) return;
    const source = getBundledFlyImageSource(selectedFly.fly.name);
    if (source) setPreviewImage({ source, title: selectedFly.fly.name });
  }, [selectedFly]);

  const selectedInFlyBox = selectedFly
    ? ownedFlyNames.has(selectedFly.fly.name.toLowerCase())
    : false;

  return (
    <>
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: Spacing.xl + insets.bottom }]}
    >
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <MaterialCommunityIcons name="calendar-month" size={26} color={colors.secondary} />
          <Text style={styles.heroMonth}>{monthName}</Text>
        </View>
        <Text style={styles.heroSub}>
          Hatches marked &quot;good&quot; or &quot;prime&quot; this month on our reference calendar. Elevation, flow, and
          tailwater vs freestone shift timing.
        </Text>
        {strongNow.length > 0 ? (
          <View style={styles.chipRow}>
            {strongNow.map((e) => {
              const ac = hatchCategoryColor(e.category, colors);
              return (
                <View key={e.id} style={[styles.chip, { borderColor: ac, backgroundColor: colors.surfaceElevated }]}>
                  <Text style={[styles.chipText, { color: ac }]}>{e.shortLabel}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={[styles.heroSub, { marginBottom: 0 }]}>
            Fewer headline hatches this month on the chart—midges, small mayflies, and nymphing still carry most days.
          </Text>
        )}
      </View>

      <Text style={styles.intro}>{DRIFTGUIDE_HATCH_CHART_INTRO}</Text>

      <HatchYearMatrix currentMonthIndex0={monthIndex0} colors={colors} />

      <Text style={styles.sectionTitle}>Hottest this month first — tap for rig notes + flies</Text>
      {sorted.map((e) => (
        <View key={e.id} onLayout={(ev) => handleEntryLayout(e.id, ev)}>
          <HatchEntryVisualCard
            entry={e}
            currentMonthIndex0={monthIndex0}
            colors={colors}
            open={openIds.has(e.id)}
            onToggle={() => toggleOpen(e.id)}
            expandedExtra={
              <MatchingFliesStrip entry={e} colors={colors} styles={styles} onSelectFly={handleSelectFly} />
            }
          />
        </View>
      ))}

      <Text style={styles.footer}>
        DriftGuide hatch calendar — planning reference only. Respect access, closures, and what you actually observe on
        the water.
      </Text>
    </ScrollView>

    <HatchFlyDetailModal
      visible={selectedFly != null}
      fly={selectedFly?.fly ?? null}
      entry={selectedFly?.entry ?? null}
      inFlyBox={selectedInFlyBox}
      canAddToFlyBox={user != null}
      onClose={() => setSelectedFly(null)}
      onAddToFlyBox={handleAddToFlyBox}
      onViewImage={handleViewFlyImage}
    />

    {user ? (
      <AddFlySheet
        visible={addSheetOpen}
        onClose={() => {
          setAddSheetOpen(false);
          setInitialCatalogFly(null);
        }}
        userId={user.id}
        isConnected={isConnected}
        catalog={catalog}
        initialCatalogFly={initialCatalogFly}
        onSaved={handleFlySaved}
      />
    ) : null}

    <FlyImagePreviewModal
      visible={previewImage != null}
      onClose={() => setPreviewImage(null)}
      imageSource={previewImage?.source ?? null}
      title={previewImage?.title ?? null}
    />
    </>
  );
}
