import { HatchEntryVisualCard } from '@/src/components/hatchChart/HatchEntryVisualCard';
import { HatchYearMatrix } from '@/src/components/hatchChart/HatchYearMatrix';
import { HatchNowHero } from '@/src/components/hatchChart/HatchNowHero';
import { HatchCompactRow } from '@/src/components/hatchChart/HatchCompactRow';
import { HatchCategoryFilter, type HatchFilter } from '@/src/components/hatchChart/HatchCategoryFilter';
import { MatchingFliesStrip } from '@/src/components/hatchChart/MatchingFliesStrip';
import {
  DRIFTGUIDE_HATCH_CHART_ENTRIES,
  hatchActivityForMonth,
  hatchEntriesSortedByMonthActivity,
  pickNowHatch,
  resolveHatchChartEntry,
  type DriftGuideHatchChartEntry,
  type HatchCategory,
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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type ImageSourcePropType, type LayoutChangeEvent, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.md,
    },
    headerMonth: {
      fontSize: FontSize.xl,
      fontWeight: '800',
      color: colors.text,
      fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: undefined }),
    },
    headerSub: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      fontWeight: '600',
      marginLeft: 'auto',
    },
    sectionHead: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginTop: Spacing.md,
      marginBottom: Spacing.sm,
    },
    sectionTitle: {
      fontSize: FontSize.sm,
      fontWeight: '800',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    sectionCount: {
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.textTertiary,
    },
    empty: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      lineHeight: 21,
      paddingVertical: Spacing.lg,
      textAlign: 'center',
    },
    yearToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginTop: Spacing.md,
      padding: Spacing.md,
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    yearToggleTitle: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
    },
    yearToggleSub: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: 1,
    },
    footer: {
      marginTop: Spacing.md,
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      lineHeight: 18,
      fontStyle: 'italic',
    },
  });
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
  const hour = now.getHours();
  const monthName = format(now, 'MMMM');

  const sorted = useMemo(
    () => hatchEntriesSortedByMonthActivity(DRIFTGUIDE_HATCH_CHART_ENTRIES, monthIndex0),
    [monthIndex0],
  );

  // The one hatch to feature "right now" — highest tier active this month, best at the current hour.
  const heroEntry = useMemo(
    () => pickNowHatch(DRIFTGUIDE_HATCH_CHART_ENTRIES, monthIndex0, hour),
    [monthIndex0, hour],
  );

  // Category filter for the browsable lists (the hero stays put — it's the live "now" answer).
  const [filter, setFilter] = useState<HatchFilter>('all');
  const categoriesPresent = useMemo(() => {
    const order: HatchCategory[] = ['mayfly', 'caddis', 'stone', 'terrestrial', 'midge', 'stillwater'];
    const present = new Set(DRIFTGUIDE_HATCH_CHART_ENTRIES.map((e) => e.category));
    return order.filter((c) => present.has(c));
  }, []);

  // Deep-link: a `focus` param (entry id or hatch name) opens that hatch expanded and scrolls to it.
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const focusEntry = useMemo(
    () => (focus ? resolveHatchChartEntry(Array.isArray(focus) ? focus[0] : focus) : undefined),
    [focus],
  );

  // Tiers by this-month activity. Prime (3) get full cards; good/low (1–2) get compact rows; off
  // hatches live only in the year matrix. A deep-linked off-month hatch is still surfaced below.
  const { primeEntries, alsoEntries } = useMemo(() => {
    // The featured hatch is spotlighted in the hero, so drop it from the lists to avoid a duplicate.
    const inList = (e: DriftGuideHatchChartEntry) =>
      e.id !== heroEntry?.id && (filter === 'all' || e.category === filter);
    const prime = sorted.filter((e) => hatchActivityForMonth(e, monthIndex0) === 3 && inList(e));
    const also = sorted.filter((e) => {
      const lvl = hatchActivityForMonth(e, monthIndex0);
      return lvl >= 1 && lvl <= 2 && inList(e);
    });
    if (focusEntry && inList(focusEntry) && hatchActivityForMonth(focusEntry, monthIndex0) === 0) {
      also.unshift(focusEntry);
    }
    return { primeEntries: prime, alsoEntries: also };
  }, [sorted, monthIndex0, filter, focusEntry, heroEntry]);

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

  // "See the full year" reference matrix, collapsed by default so the current month leads.
  const [yearOpen, setYearOpen] = useState(false);

  // Scroll a deep-linked (focused) hatch into view once its row has been laid out.
  const scrollRef = useRef<ScrollView>(null);
  const didScrollRef = useRef(false);
  const handleEntryLayout = useCallback(
    (id: string, e: LayoutChangeEvent) => {
      if (didScrollRef.current || !focusEntry || id !== focusEntry.id) return;
      didScrollRef.current = true;
      scrollRef.current?.scrollTo({ y: Math.max(0, e.nativeEvent.layout.y - Spacing.md), animated: true });
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
      <View style={styles.header}>
        <MaterialCommunityIcons name="calendar-month" size={22} color={colors.secondary} />
        <Text style={styles.headerMonth}>{monthName}</Text>
        <Text style={styles.headerSub}>Western freestone &amp; tailwater</Text>
      </View>

      {heroEntry ? (
        <HatchNowHero
          entry={heroEntry}
          monthIndex0={monthIndex0}
          hour={hour}
          colors={colors}
          onSelectFly={handleSelectFly}
        />
      ) : null}

      <HatchCategoryFilter
        categories={categoriesPresent}
        value={filter}
        onChange={setFilter}
        colors={colors}
      />

      {primeEntries.length > 0 ? (
        <>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Prime this month</Text>
            <Text style={styles.sectionCount}>{primeEntries.length}</Text>
          </View>
          {primeEntries.map((e) => (
            <View key={e.id} onLayout={(ev) => handleEntryLayout(e.id, ev)}>
              <HatchEntryVisualCard
                entry={e}
                currentMonthIndex0={monthIndex0}
                colors={colors}
                open={openIds.has(e.id)}
                onToggle={() => toggleOpen(e.id)}
                expandedExtra={
                  <MatchingFliesStrip entry={e} colors={colors} onSelectFly={handleSelectFly} />
                }
              />
            </View>
          ))}
        </>
      ) : null}

      {alsoEntries.length > 0 ? (
        <>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Also worth a look</Text>
            <Text style={styles.sectionCount}>{alsoEntries.length}</Text>
          </View>
          {alsoEntries.map((e) => (
            <View key={e.id} onLayout={(ev) => handleEntryLayout(e.id, ev)}>
              <HatchCompactRow
                entry={e}
                currentMonthIndex0={monthIndex0}
                colors={colors}
                open={openIds.has(e.id)}
                onToggle={() => toggleOpen(e.id)}
                expandedExtra={
                  <MatchingFliesStrip entry={e} colors={colors} onSelectFly={handleSelectFly} />
                }
              />
            </View>
          ))}
        </>
      ) : null}

      {primeEntries.length === 0 && alsoEntries.length === 0 ? (
        <Text style={styles.empty}>
          Nothing on the chart for this filter in {monthName}. Try “All”, or check the full year below.
        </Text>
      ) : null}

      <Pressable
        onPress={() => setYearOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: yearOpen }}
        style={({ pressed }) => [styles.yearToggle, pressed && { opacity: 0.85 }]}
      >
        <MaterialCommunityIcons name="grid" size={20} color={colors.textSecondary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.yearToggleTitle}>See the full year</Text>
          <Text style={styles.yearToggleSub}>All {DRIFTGUIDE_HATCH_CHART_ENTRIES.length} hatches, month by month</Text>
        </View>
        <Ionicons name={yearOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textTertiary} />
      </Pressable>

      {yearOpen ? (
        <View style={{ marginTop: Spacing.sm }}>
          <HatchYearMatrix currentMonthIndex0={monthIndex0} colors={colors} />
        </View>
      ) : null}

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
