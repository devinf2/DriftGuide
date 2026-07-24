import { OfflineFallbackGuide } from '@/src/components/OfflineFallbackGuide';
import { getBundledFlyImageSource } from '@/src/constants/flyImages';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { getDriftGuideScore } from '@/src/services/conditions';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { useSpotReport } from '@/src/hooks/useSpotReport';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationFavoritesStore } from '@/src/stores/locationFavoritesStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { useTripStore } from '@/src/stores/tripStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { HomeHotSpotData } from '@/src/utils/homeHotSpots';
import { formatDistanceLabel } from '@/src/utils/homeHotSpots';
import { deriveSpotGear } from '@/src/utils/spotGear';
import { ReportGuidesOutfitters } from '@/src/components/home/ReportGuidesOutfitters';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useMemo, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import type { Location, LocationConditions, WaterClarity } from '@/src/types';

/** Star → tier, matching the ranking language used on the recommended-spot cards. */
function tierLabel(stars: number): string {
  if (stars >= 4.25) return 'Prime';
  if (stars >= 3.25) return 'Good';
  if (stars >= 2) return 'Fair';
  return 'Tough';
}
function tierColor(colors: ThemeColors, stars: number): string {
  if (stars >= 4.25) return colors.success;
  if (stars >= 3.25) return colors.secondary;
  if (stars >= 2) return colors.warning;
  return colors.textTertiary;
}
function clarityShort(c: WaterClarity): string {
  const map: Record<WaterClarity, string> = {
    clear: 'Clear',
    slightly_stained: 'Lt stain',
    stained: 'Stained',
    murky: 'Murky',
    blown_out: 'Blown',
    unknown: '—',
  };
  return map[c] ?? '—';
}
function windLabel(mph: number): string {
  if (mph < 1) return 'Calm';
  return `${Math.round(mph)} mph`;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Parse "BWO Emerger #18" → { name, size } for the fly strip. */
function parseFly(raw: string): { name: string; size: string | null } {
  const m = raw.match(/^(.*?)\s*(#\s*\d+)\s*$/);
  if (m) return { name: m[1].trim(), size: m[2].replace(/\s+/g, '') };
  return { name: raw.trim(), size: null };
}

/**
 * When the AI names a generic category ("Streamers", "Dry Fly") rather than a specific pattern,
 * fall back to a representative bundled pattern so the strip still shows real fly art.
 */
const FLY_CATEGORY_FALLBACK: Record<string, string> = {
  'dry fly': 'adams',
  dry: 'adams',
  nymph: 'copper john',
  nymphs: 'copper john',
  'beadhead nymph': 'bh pheasant tail',
  'bead head nymph': 'bh pheasant tail',
  'bh nymph': 'bh pheasant tail',
  'pheasant tail': 'bh pheasant tail',
  streamer: 'woolly bugger',
  streamers: 'woolly bugger',
  'egg pattern': 'egg',
  egg: 'egg',
  midge: 'black beauty',
  midges: 'black beauty',
  emerger: 'cdc emerger',
  caddis: 'elk hair caddis',
  terrestrial: 'chubby chernobyl',
  hopper: "dave's hopper",
};

function flyImageFor(name: string) {
  return (
    getBundledFlyImageSource(name) ??
    getBundledFlyImageSource(FLY_CATEGORY_FALLBACK[name.toLowerCase().trim()])
  );
}

type Props = {
  hotSpotList: HomeHotSpotData[];
  hotSpotLoading: boolean;
  /** Reanimated scroll handler from the home chrome — drives the shared hero collapse. */
  onScroll?: ComponentProps<typeof Animated.ScrollView>['onScroll'];
  refreshControl?: ComponentProps<typeof Animated.ScrollView>['refreshControl'];
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Optional content rendered at the very top of the scroll (e.g. featured partners rail). */
  headerSlot?: React.ReactNode;
};

/**
 * Home "Report" tab: a water-anchored guide report. Opens on the top-ranked water and lets the
 * picker swap to any favorite / recent / ranked water; the verdict, conditions, report, flies and
 * gear all re-read for the selection. Reuses the home hot-spot ranking + conditions and the same
 * AI spot summary the full spot page uses.
 */
export function FishHomeReport({
  hotSpotList,
  hotSpotLoading,
  onScroll,
  refreshControl,
  contentContainerStyle,
  headerSlot,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const locations = useLocationStore((s) => s.locations);
  const getRecentLocations = useLocationStore((s) => s.getRecentLocations);
  const addRecentLocation = useLocationStore((s) => s.addRecentLocation);
  const searchLocations = useLocationStore((s) => s.searchLocations);
  const setPendingPlanTripLocationId = useLocationStore((s) => s.setPendingPlanTripLocationId);
  const favoriteIds = useLocationFavoritesStore((s) => s.ids);
  const user = useAuthStore((s) => s.user);
  const startTrip = useTripStore((s) => s.startTrip);
  const { isConnected: online } = useNetworkStatus();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [chosenId, setChosenId] = useState<string | null>(null);

  /**
   * Default water: the top-ranked water when we have a ranking (online), otherwise the most recent
   * water, a favorite, or any catalog water — so the Report still opens on something offline (when
   * the AI ranking is unavailable) and the user can switch or start a trip from there.
   */
  const fallbackWaterId = useMemo(() => {
    if (hotSpotList[0]) return hotSpotList[0].location.id;
    const recent = getRecentLocations()[0];
    if (recent) return recent.id;
    const fav = favoriteIds.find((id) => locations.some((l) => l.id === id));
    if (fav) return fav;
    return locations.find((l) => !l.parent_location_id)?.id ?? null;
  }, [hotSpotList, getRecentLocations, favoriteIds, locations]);
  const activeId = chosenId ?? fallbackWaterId;
  const activeHotSpot = useMemo(
    () => hotSpotList.find((h) => h.location.id === activeId) ?? null,
    [hotSpotList, activeId],
  );
  const activeLocation = useMemo(
    () => activeHotSpot?.location ?? locations.find((l) => l.id === activeId) ?? null,
    [activeHotSpot, locations, activeId],
  );
  /** The selected water plus its parent river and sibling sections — so a guide/shop
   *  tagged to the river shows on its sections and vice versa. */
  const relatedLocationIds = useMemo(() => {
    if (!activeLocation) return [] as string[];
    const ids = new Set<string>([activeLocation.id]);
    if (activeLocation.parent_location_id) ids.add(activeLocation.parent_location_id);
    const rootId = activeLocation.parent_location_id ?? activeLocation.id;
    for (const l of locations) {
      if (l.id === rootId || l.parent_location_id === rootId) ids.add(l.id);
    }
    return [...ids];
  }, [activeLocation, locations]);
  const seedConditions = activeHotSpot?.conditions ?? null;

  const { conditions, summary, conditionsLoading, summaryLoading } = useSpotReport(
    activeLocation,
    seedConditions,
    locations,
    online,
    activeHotSpot?.communityFishN,
  );

  const selectWater = useCallback(
    (id: string) => {
      setChosenId(id);
      addRecentLocation(id);
      setPickerOpen(false);
    },
    [addRecentLocation],
  );

  const openPicker = useCallback(() => {
    setQuery('');
    setPickerOpen(true);
  }, []);

  const addNewLocation = useCallback(() => {
    setPickerOpen(false);
    const q = query.trim();
    router.push(q ? `/trip/add-location?presetName=${encodeURIComponent(q)}` : '/trip/add-location');
  }, [query]);

  const searchResults = useMemo<Location[]>(
    () => (query.trim() ? searchLocations(query).slice(0, 20) : []),
    [query, searchLocations],
  );

  const planTrip = useCallback(() => {
    if (!activeLocation) return;
    setPendingPlanTripLocationId(activeLocation.id);
    router.push('/trip/new');
  }, [activeLocation, setPendingPlanTripLocationId]);

  const fishNow = useCallback(async () => {
    if (!activeLocation || !user?.id) return;
    addRecentLocation(activeLocation.id);
    const tripId = await startTrip(user.id, activeLocation.id, 'fly', activeLocation, 'wade');
    if (tripId) router.replace(`/trip/${tripId}`);
  }, [activeLocation, user?.id, addRecentLocation, startTrip]);

  const openFullReport = useCallback(() => {
    if (activeLocation) router.push(`/spot/${activeLocation.id}`);
  }, [activeLocation]);

  // Picker rows: ranked (with tier) first, then favorites and recents not already ranked.
  const pickerRows = useMemo(() => {
    const rankedIds = new Set(hotSpotList.map((h) => h.location.id));
    const ranked = hotSpotList.map((h, i) => ({
      id: h.location.id,
      name: h.location.name,
      sub:
        formatDistanceLabel(h.distanceKm) ??
        (i === 0 ? 'Nearest prime water' : undefined),
      stars: getDriftGuideScore(h.conditions).stars,
      badge: i === 0 ? 'Pick' : undefined,
    }));
    const favRows = locations
      .filter((l) => favoriteIds.includes(l.id) && !rankedIds.has(l.id))
      .slice(0, 5)
      .map((l) => ({ id: l.id, name: l.name, sub: 'Favorite', stars: null, badge: undefined }));
    const favIdSet = new Set(favoriteIds);
    const recentRows = getRecentLocations()
      .filter((l) => !rankedIds.has(l.id) && !favIdSet.has(l.id))
      .slice(0, 4)
      .map((l) => ({ id: l.id, name: l.name, sub: 'Recent', stars: null, badge: undefined }));
    return { ranked, favRows, recentRows };
  }, [hotSpotList, locations, favoriteIds, getRecentLocations]);

  const stars = conditions ? getDriftGuideScore(conditions).stars : null;
  const gear = useMemo(
    () => (activeLocation && conditions ? deriveSpotGear(activeLocation, conditions) : null),
    [activeLocation, conditions],
  );

  const condPills = useMemo(() => {
    const out: { key: string; icon: keyof typeof MaterialCommunityIcons.glyphMap; label: string }[] = [];
    if (!conditions) return out;
    const t = conditions.temperature?.temp_f;
    if (t != null && Number.isFinite(t)) out.push({ key: 'temp', icon: 'thermometer', label: `${Math.round(t)}°` });
    const w = conditions.wind?.speed_mph;
    if (w != null && Number.isFinite(w)) out.push({ key: 'wind', icon: 'weather-windy', label: windLabel(w) });
    const f = conditions.water?.flow_cfs;
    if (f != null && Number.isFinite(f)) out.push({ key: 'flow', icon: 'waves', label: `${Math.round(f)} cfs` });
    const c = conditions.water?.clarity;
    if (c && c !== 'unknown') out.push({ key: 'clarity', icon: 'water-outline', label: clarityShort(c) });
    return out;
  }, [conditions]);

  const renderActions = () => (
    <View style={styles.actionRow}>
      <Pressable style={styles.planBtn} onPress={planTrip} accessibilityRole="button">
        <MaterialCommunityIcons name="calendar-plus" size={18} color={colors.primary} />
        <Text style={styles.planBtnText}>Plan a trip</Text>
      </Pressable>
      <Pressable style={styles.fishBtn} onPress={fishNow} accessibilityRole="button">
        <MaterialCommunityIcons name="play" size={18} color={colors.textInverse} />
        <Text style={styles.fishBtnText}>Fish now</Text>
      </Pressable>
    </View>
  );

  // Cold state: online, but no ranked water and nothing selectable yet. Offline we still render the
  // header + curated guide below (it's water-independent), so don't short-circuit there.
  if (online && !activeLocation && !hotSpotLoading) {
    return (
      <View style={styles.coldCard}>
        <MaterialCommunityIcons name="map-search-outline" size={34} color={colors.textTertiary} />
        <Text style={styles.coldText}>
          We couldn't find water near you yet. Browse the map to pick a region, or start a trip and
          your report will build from there.
        </Text>
        <Pressable style={styles.coldCta} onPress={() => router.push('/map')}>
          <Text style={styles.coldCtaText}>Browse the map</Text>
        </Pressable>
      </View>
    );
  }

  const initialLoading = !activeLocation && hotSpotLoading;

  return (
    <View style={styles.fill}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        refreshControl={refreshControl}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled"
      >
      {headerSlot}
      {/* Unified water header — the name is the switcher (tap to change water). */}
      <Pressable
        style={styles.water}
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={`Change water. Current: ${activeLocation?.name ?? 'loading'}`}
      >
        <Text style={styles.wname} numberOfLines={1}>
          {activeLocation?.name ?? 'Finding water near you…'}
        </Text>
        {activeLocation ? (
          <View style={styles.changePill}>
            <Text style={styles.changeText}>Change</Text>
            <MaterialCommunityIcons name="chevron-down" size={15} color={colors.secondary} />
          </View>
        ) : null}
      </Pressable>

      {!online ? (
        /* Offline: the curated, bundled fishing guide — same one production shows. The water
           header + picker above still work so they can switch waters and start a trip. */
        <View style={styles.offlineGuideWrap}>
          <OfflineFallbackGuide />
        </View>
      ) : initialLoading ? (
        <View style={styles.loadingCard}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <>
          {/* Verdict — one quiet line: tier + best window. */}
          {stars != null || summary?.bestTime ? (
            <Text style={styles.verdict}>
              {stars != null ? (
                <Text style={[styles.tierInline, { color: tierColor(colors, stars) }]}>
                  {tierLabel(stars)}
                </Text>
              ) : null}
              {stars != null && summary?.bestTime ? '  ·  ' : ''}
              {summary?.bestTime ? `best window opens ${summary.bestTime}` : ''}
            </Text>
          ) : null}
          {activeHotSpot?.suggestion.reason ? (
            <Text style={styles.verdictSub} numberOfLines={2}>
              {activeHotSpot.suggestion.reason}
            </Text>
          ) : null}

          {/* Conditions — inline readings, each shown only when present. */}
          {condPills.length > 0 ? (
            <View style={styles.conds}>
              {condPills.map((p) => (
                <View key={p.key} style={styles.cond}>
                  <MaterialCommunityIcons name={p.icon} size={14} color={colors.textTertiary} />
                  <Text style={styles.condText}>{p.label}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {conditionsLoading && !conditions ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}

          {/* Report */}
          {summary || summaryLoading ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.label}>Today's report</Text>
              {summary ? (
                <Text style={styles.report}>{summary.report}</Text>
              ) : (
                <View style={styles.reportSkeleton}>
                  <View style={[styles.skelLine, { width: '96%' }]} />
                  <View style={[styles.skelLine, { width: '88%' }]} />
                  <View style={[styles.skelLine, { width: '72%' }]} />
                </View>
              )}
            </>
          ) : null}

          {/* Flies */}
          {summary && summary.topFlies.length > 0 ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.label}>Top flies right now</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.flyStrip}
              >
                {summary.topFlies.slice(0, 6).map((raw, i) => {
                  const { name, size } = parseFly(raw);
                  const img = flyImageFor(name);
                  return (
                    <View key={`${raw}-${i}`} style={styles.fly}>
                      <View style={styles.flyThumb}>
                        {img ? (
                          <Image source={img} style={styles.flyImg} contentFit="cover" />
                        ) : (
                          <MaterialCommunityIcons name="bee-flower" size={24} color={colors.textTertiary} />
                        )}
                      </View>
                      <Text style={styles.flyName} numberOfLines={2}>
                        {name}
                      </Text>
                      {size ? <Text style={styles.flySize}>{size}</Text> : null}
                    </View>
                  );
                })}
              </ScrollView>
            </>
          ) : null}

          {/* Gear */}
          {gear ? (
            <>
              <View style={styles.divider} />
              <Text style={styles.label}>Gear for this water</Text>
              <View style={styles.gearWrap}>
                {gear.map((g) => (
                  <View key={g.key} style={styles.chip}>
                    <Text style={styles.chipText}>
                      <Text style={styles.chipLead}>{g.lead}</Text>
                      {g.rest ? ` ${g.rest}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {/* Guides who work this water + tagged/nearby shops (self-hides when empty). */}
          <ReportGuidesOutfitters
            locationIds={relatedLocationIds}
            lat={activeLocation?.latitude}
            lng={activeLocation?.longitude}
          />

          {/* Full-report link — the primary actions live in the pinned footer below. */}
          <Pressable style={styles.secondary} onPress={openFullReport} accessibilityRole="button">
            <Text style={styles.secondaryText}>See full report, directions & conditions</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.primary} />
          </Pressable>
        </>
      )}
      </Animated.ScrollView>

      {/* Actions pinned to the bottom of the panel so they're always reachable. */}
      {activeLocation ? <View style={styles.pinnedFooter}>{renderActions()}</View> : null}

      {/* Picker modal */}
      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={styles.pickerCard} onPress={() => {}}>
            <Text style={styles.pickerCardHeader}>Switch water</Text>
            <View style={styles.searchBox}>
              <MaterialCommunityIcons name="magnify" size={18} color={colors.textTertiary} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search DriftGuide waters…"
                placeholderTextColor={colors.textTertiary}
                autoCorrect={false}
                returnKeyType="search"
              />
              {query.length > 0 ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <MaterialCommunityIcons name="close-circle" size={18} color={colors.textTertiary} />
                </Pressable>
              ) : null}
            </View>
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              {query.trim() ? (
                <>
                  {searchResults.map((l) => (
                    <PickerRow
                      key={l.id}
                      colors={colors}
                      styles={styles}
                      name={l.name}
                      sub={[capitalize(l.type), l.state].filter(Boolean).join(' · ') || undefined}
                      stars={null}
                      selected={l.id === activeId}
                      onPress={() => selectWater(l.id)}
                    />
                  ))}
                  {searchResults.length === 0 ? (
                    <Text style={styles.pickerEmpty}>No DriftGuide waters match “{query.trim()}”.</Text>
                  ) : null}
                </>
              ) : (
                <>
                  {pickerRows.ranked.map((r) => (
                    <PickerRow
                      key={r.id}
                      colors={colors}
                      styles={styles}
                      name={r.name}
                      sub={r.sub}
                      stars={r.stars}
                      badge={r.badge}
                      selected={r.id === activeId}
                      onPress={() => selectWater(r.id)}
                    />
                  ))}
                  {pickerRows.favRows.map((r) => (
                    <PickerRow
                      key={r.id}
                      colors={colors}
                      styles={styles}
                      name={r.name}
                      sub={r.sub}
                      stars={r.stars}
                      selected={r.id === activeId}
                      onPress={() => selectWater(r.id)}
                    />
                  ))}
                  {pickerRows.recentRows.map((r) => (
                    <PickerRow
                      key={r.id}
                      colors={colors}
                      styles={styles}
                      name={r.name}
                      sub={r.sub}
                      stars={r.stars}
                      selected={r.id === activeId}
                      onPress={() => selectWater(r.id)}
                    />
                  ))}
                </>
              )}

              {/* Add-location fallback: always available; preset the typed name when searching. */}
              <Pressable style={styles.pickerAdd} onPress={addNewLocation}>
                <MaterialCommunityIcons name="map-marker-plus-outline" size={18} color={colors.primary} />
                <Text style={styles.pickerAddText}>
                  {query.trim() ? `Add “${query.trim()}” as a new water` : 'Add a new water'}
                </Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function PickerRow({
  colors,
  styles,
  name,
  sub,
  stars,
  badge,
  selected,
  onPress,
}: {
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
  name: string;
  sub?: string;
  stars: number | null;
  badge?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const dot = stars != null ? tierColor(colors, stars) : colors.border;
  return (
    <Pressable
      style={[styles.pickerRow, selected && styles.pickerRowSel]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={[styles.pickerDot, { backgroundColor: dot }]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.pickerRowName} numberOfLines={1}>
          {name}
        </Text>
        {sub ? <Text style={styles.pickerRowSub}>{sub}</Text> : null}
      </View>
      {stars != null ? (
        <Text style={[styles.pickerTier, { color: tierColor(colors, stars) }]}>
          {tierLabel(stars)}
        </Text>
      ) : null}
      {badge ? <Text style={styles.pickerBadge}>{badge}</Text> : null}
      {selected ? (
        <MaterialCommunityIcons name="check" size={18} color={colors.secondary} />
      ) : null}
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    fill: { flex: 1 },
    // Unified water header: the name IS the switcher, no icon, no card.
    water: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    wname: {
      flexShrink: 1,
      fontSize: FontSize.xxl,
      fontWeight: '800',
      letterSpacing: -0.5,
      color: colors.text,
    },
    // Clear "this is a picker" affordance next to the water name.
    changePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingVertical: 4,
      paddingLeft: Spacing.sm,
      paddingRight: Spacing.xs,
      borderRadius: BorderRadius.full,
      borderWidth: 1,
      borderColor: colors.secondary,
      backgroundColor: colors.surfaceElevated,
    },
    changeText: {
      fontSize: FontSize.xs,
      fontWeight: '800',
      color: colors.secondary,
      letterSpacing: 0.3,
    },
    offlineGuideWrap: { marginTop: Spacing.md },

    loadingCard: {
      paddingVertical: Spacing.xl,
      alignItems: 'center',
      justifyContent: 'center',
    },

    verdict: { marginTop: 5, fontSize: FontSize.md, color: colors.textSecondary },
    tierInline: { fontWeight: '800' },
    verdictSub: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 4, lineHeight: 18 },

    conds: {
      marginTop: Spacing.md,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.md,
    },
    cond: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    condText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.textSecondary },

    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: Spacing.lg,
    },
    label: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: colors.textTertiary,
      marginBottom: Spacing.sm,
    },
    report: { fontSize: FontSize.sm, lineHeight: 21, color: colors.textSecondary },
    reportSkeleton: { gap: 8 },
    skelLine: { height: 12, borderRadius: 6, backgroundColor: colors.surfaceElevated },

    flyStrip: { gap: Spacing.lg, paddingRight: Spacing.sm },
    fly: { width: 60 },
    flyThumb: {
      width: 60,
      height: 60,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surfaceElevated,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    flyImg: { width: 60, height: 60 },
    flyName: { fontSize: FontSize.sm, fontWeight: '700', color: colors.text, marginTop: Spacing.xs },
    flySize: { fontSize: FontSize.xs, color: colors.textTertiary, marginTop: 1 },

    gearWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs + 1 },
    chip: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: BorderRadius.full,
      paddingVertical: Spacing.xs + 1,
      paddingHorizontal: Spacing.md,
    },
    chipText: { fontSize: FontSize.sm, color: colors.textSecondary },
    chipLead: { fontWeight: '700', color: colors.text },

    actions: { marginTop: Spacing.lg, gap: Spacing.sm },
    // Two-up action row: Plan a trip (outline) + Fish now (filled).
    actionRow: { flexDirection: 'row', gap: Spacing.sm },
    planBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      borderWidth: 1,
      borderColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
    },
    planBtnText: { color: colors.primary, fontSize: FontSize.md, fontWeight: '700' },
    fishBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
    },
    fishBtnText: { color: colors.textInverse, fontSize: FontSize.md, fontWeight: '700' },
    secondary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      paddingVertical: Spacing.sm,
    },
    secondaryText: { color: colors.primary, fontSize: FontSize.sm, fontWeight: '600' },
    // Pinned footer that fades in when the sheet is expanded (hero collapsed).
    pinnedFooter: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.md,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },

    coldCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: Spacing.xl,
      alignItems: 'center',
      gap: Spacing.md,
    },
    coldText: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 21,
    },
    coldCta: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.lg,
    },
    coldCtaText: { color: colors.textInverse, fontWeight: '700', fontSize: FontSize.sm },

    pickerBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(9,16,28,0.42)',
      justifyContent: 'flex-start',
      paddingTop: 140,
      paddingHorizontal: Spacing.md,
    },
    pickerCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    pickerCardHeader: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.textTertiary,
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderLight,
    },
    pickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.sm + 2,
      paddingHorizontal: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderLight,
    },
    pickerRowSel: { backgroundColor: colors.surfaceElevated },
    pickerDot: { width: 9, height: 9, borderRadius: 5 },
    pickerRowName: { fontSize: FontSize.md, fontWeight: '600', color: colors.text },
    pickerRowSub: { fontSize: FontSize.xs, color: colors.textTertiary, marginTop: 1 },
    pickerTier: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
    pickerBadge: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      color: colors.secondary,
    },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      marginHorizontal: Spacing.md,
      marginTop: Spacing.sm,
      marginBottom: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      backgroundColor: colors.surfaceElevated,
      borderRadius: BorderRadius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    searchInput: {
      flex: 1,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
    },
    pickerEmpty: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.md,
      lineHeight: 20,
    },
    pickerAdd: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.borderLight,
    },
    pickerAddText: { fontSize: FontSize.sm, fontWeight: '700', color: colors.primary },
  });
}
