import { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  TouchableOpacity,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import {
  INSECTS,
  SIZE_BUCKETS,
  BODY_COLOR_LABELS,
  PROFILE_LABELS,
  LIFE_STAGE_LABELS,
  fliesForInsect,
  type Insect,
  type InsectBodyColor,
  type InsectLifeStage,
  type InsectProfile,
  type SizeBucket,
} from '@/src/data/insects';
import {
  filterInsects,
  availableCategories,
  availableSizeBuckets,
  availableColors,
  availableProfiles,
  availableLifeStages,
  insectById,
  type BugMatcherFilters,
} from '@/src/utils/bugMatcherFilter';
import type { HatchCategory } from '@/src/data/driftGuideHatchChart';
import { identifyBugFromImage, type BugIdResult } from '@/src/services/ai';
import { MatchingFliesGrid } from '@/src/components/bugMatcher/MatchingFliesGrid';
import { getBundledFlyImageSource } from '@/src/constants/flyImages';

const CATEGORY_LABELS: Record<HatchCategory, string> = {
  midge: 'Midge',
  mayfly: 'Mayfly',
  caddis: 'Caddis',
  stone: 'Stonefly',
  terrestrial: 'Terrestrial',
  stillwater: 'Stillwater',
};

function sizeHintFor(insect: Insect): string {
  const { minHook, maxHook } = insect.sizeRange;
  return minHook === maxHook ? `#${minHook}` : `#${minHook}–${maxHook}`;
}

/**
 * Insects have no bundled art yet, so use the first of their curated flies that
 * resolves to a bundled image as the match card thumbnail.
 */
function representativeFlyImage(insect: Insect): ImageSourcePropType | null {
  for (const name of fliesForInsect(insect)) {
    const source = getBundledFlyImageSource(name);
    if (source) return source;
  }
  return null;
}

/** A single filter step rendered as a labelled dropdown with a modal option list. */
function FilterDropdown<T extends string>({
  label,
  options,
  selected,
  onSelect,
  colors,
  styles,
}: {
  label: string;
  options: { key: T; label: string }[];
  selected: T | null;
  onSelect: (value: T | null) => void;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
}) {
  const [open, setOpen] = useState(false);
  const disabled = options.length === 0;
  const selectedLabel = options.find((o) => o.key === selected)?.label ?? null;

  return (
    <View style={styles.filterStep}>
      <Text style={styles.filterLabel}>{label}</Text>
      <Pressable
        style={[styles.dropdownTrigger, disabled && styles.dropdownTriggerDisabled]}
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selectedLabel ?? 'Select'}. Open menu.`}
      >
        <Text
          style={[styles.dropdownValue, !selectedLabel && styles.dropdownValueMuted]}
          numberOfLines={1}
        >
          {disabled ? 'None available' : (selectedLabel ?? 'Select')}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <TouchableOpacity style={styles.modalCard} activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{label}</Text>
            <ScrollView style={styles.optionScroll}>
              <TouchableOpacity
                style={[styles.optionRow, !selected && styles.optionRowActive]}
                onPress={() => {
                  onSelect(null);
                  setOpen(false);
                }}
              >
                <Text style={[styles.optionText, !selected && styles.optionTextActive]}>Select</Text>
                {!selected ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
              </TouchableOpacity>
              {options.map((opt) => {
                const isOn = selected === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[styles.optionRow, isOn && styles.optionRowActive]}
                    onPress={() => {
                      onSelect(isOn ? null : opt.key);
                      setOpen(false);
                    }}
                  >
                    <Text style={[styles.optionText, isOn && styles.optionTextActive]}>{opt.label}</Text>
                    {isOn ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

export default function BugMatcherScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const effectiveTop = useEffectiveSafeTopInset();
  const { height: windowHeight } = useWindowDimensions();
  // Reserve a fixed matches area so the layout never shifts when results appear,
  // leaving a bit more room for the filters/photo path below.
  const matchesPaneHeight = Math.round(windowHeight * 0.42);

  const [filters, setFilters] = useState<BugMatcherFilters>({});
  const [selectedInsectId, setSelectedInsectId] = useState<string | null>(null);

  // AI photo path state.
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<BugIdResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const candidates = useMemo(() => filterInsects(filters), [filters]);
  const selectedInsect = selectedInsectId ? insectById(selectedInsectId) : undefined;

  const categoryOpts = useMemo(
    () => availableCategories().map((c) => ({ key: c, label: CATEGORY_LABELS[c] })),
    [],
  );
  const sizeOpts = useMemo(() => {
    const avail = new Set(availableSizeBuckets(filters));
    return SIZE_BUCKETS.filter((b) => avail.has(b.key)).map((b) => ({ key: b.key, label: b.label }));
  }, [filters]);
  const colorOpts = useMemo(
    () => availableColors(filters).map((c) => ({ key: c, label: BODY_COLOR_LABELS[c] })),
    [filters],
  );
  const profileOpts = useMemo(
    () => availableProfiles(filters).map((p) => ({ key: p, label: PROFILE_LABELS[p] })),
    [filters],
  );
  const stageOpts = useMemo(
    () => availableLifeStages(filters).map((s) => ({ key: s, label: LIFE_STAGE_LABELS[s] })),
    [filters],
  );

  const hasAnyFilter = Object.values(filters).some(Boolean);
  // The matches pane shows every bug by default and narrows as traits are picked.
  const shownCandidates = candidates;

  const resetKey = useCallback(() => {
    setFilters({});
    setSelectedInsectId(null);
  }, []);

  const clearAi = useCallback(() => {
    setPhotoUri(null);
    setAiResult(null);
    setAiError(null);
  }, []);

  const runIdentify = useCallback(async (uri: string) => {
    setPhotoUri(uri);
    setAiResult(null);
    setAiError(null);
    setAiLoading(true);
    try {
      const result = await identifyBugFromImage(uri);
      setAiResult(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setAiError(
        msg === 'offline'
          ? "You're offline — photo ID needs a connection. Use the feature key below instead."
          : "Couldn't identify the bug from the photo. Try the feature key below, or a clearer photo.",
      );
    } finally {
      setAiLoading(false);
    }
  }, []);

  const pickPhoto = useCallback(
    async (source: 'camera' | 'library') => {
      const opts = { allowsEditing: true, quality: 0.85 as const };
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Allow camera access to take a photo.');
          return;
        }
        const result = await ImagePicker.launchCameraAsync(opts);
        const asset = result.assets?.[0];
        if (!result.canceled && asset?.uri) void runIdentify(asset.uri);
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission needed', 'Allow photo library access to choose a photo.');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], ...opts });
        const asset = result.assets?.[0];
        if (!result.canceled && asset?.uri) void runIdentify(asset.uri);
      }
    },
    [runIdentify],
  );

  // Map an AI result back to a dataset insect when category/name lines up, so we can
  // show our curated flies; otherwise fall back to the model's own fly list.
  const aiMatchedInsect: Insect | null = useMemo(() => {
    if (!aiResult) return null;
    const name = aiResult.insect.toLowerCase();
    return (
      INSECTS.find((i) => i.commonName.toLowerCase().includes(name) || name.includes(i.id)) ?? null
    );
  }, [aiResult]);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: effectiveTop + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
          <Ionicons name="chevron-back" size={26} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Bug Matcher</Text>
        <View style={styles.backButton} />
      </View>

      {selectedInsect ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <InsectDetail
            insect={selectedInsect}
            onBack={() => setSelectedInsectId(null)}
            colors={colors}
            styles={styles}
          />
        </ScrollView>
      ) : (
        <>
          {/* ---- Pinned matches: always visible, empty until the angler picks a trait ---- */}
          <View style={[styles.matchesPane, { height: matchesPaneHeight }]}>
            <View style={styles.candidatesHeader}>
              <Text style={styles.sectionTitle}>
                {hasAnyFilter
                  ? `${shownCandidates.length} ${shownCandidates.length === 1 ? 'match' : 'matches'}`
                  : 'All bugs'}
              </Text>
              {hasAnyFilter ? (
                <Pressable onPress={resetKey} hitSlop={8}>
                  <Text style={styles.linkText}>Reset</Text>
                </Pressable>
              ) : null}
            </View>
            {shownCandidates.length === 0 ? (
              <Text style={styles.emptyMatches}>
                No bugs match those traits — try clearing one.
              </Text>
            ) : (
              <ScrollView
                style={styles.matchesScroll}
                contentContainerStyle={styles.matchesScrollContent}
                keyboardShouldPersistTaps="handled"
              >
                {shownCandidates.map((insect) => {
                    const thumb = representativeFlyImage(insect);
                    return (
                      <Pressable
                        key={insect.id}
                        style={styles.candidateCard}
                        onPress={() => setSelectedInsectId(insect.id)}
                      >
                        {thumb ? (
                          <Image source={thumb} style={styles.candidateThumb} resizeMode="contain" />
                        ) : (
                          <View style={[styles.candidateThumb, styles.candidateThumbPlaceholder]}>
                            <Ionicons name="bug-outline" size={22} color={colors.textTertiary} />
                          </View>
                        )}
                        <View style={styles.candidateMain}>
                          <Text style={styles.candidateName}>{insect.commonName}</Text>
                          <Text style={styles.candidateMeta}>
                            {CATEGORY_LABELS[insect.category]} · {sizeHintFor(insect)}
                          </Text>
                          <Text style={styles.candidateNote} numberOfLines={2}>
                            {insect.idNote}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
          </View>

          <ScrollView
            style={styles.lowerScroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {/* ---- AI photo path ---- */}
            <Text style={styles.sectionTitle}>Snap a photo</Text>
            <Text style={styles.sectionHint}>Let AI ID the bug, or narrow by features below.</Text>
            <View style={styles.photoButtons}>
              <Pressable style={styles.photoButton} onPress={() => pickPhoto('camera')} disabled={aiLoading}>
                <Ionicons name="camera-outline" size={20} color={colors.surface} />
                <Text style={styles.photoButtonText}>Take photo</Text>
              </Pressable>
              <Pressable
                style={[styles.photoButton, styles.photoButtonAlt]}
                onPress={() => pickPhoto('library')}
                disabled={aiLoading}
              >
                <Ionicons name="image-outline" size={20} color={colors.primary} />
                <Text style={[styles.photoButtonText, styles.photoButtonTextAlt]}>Upload</Text>
              </Pressable>
            </View>

            {photoUri ? (
              <View style={styles.aiResultCard}>
                <Image source={{ uri: photoUri }} style={styles.aiPhoto} resizeMode="cover" />
                {aiLoading ? (
                  <View style={styles.aiLoadingRow}>
                    <ActivityIndicator color={colors.primary} />
                    <Text style={styles.aiLoadingText}>Identifying…</Text>
                  </View>
                ) : aiError ? (
                  <View style={styles.aiErrorBox}>
                    <Text style={styles.aiErrorText}>{aiError}</Text>
                    <Pressable onPress={clearAi}>
                      <Text style={styles.linkText}>Dismiss</Text>
                    </Pressable>
                  </View>
                ) : aiResult ? (
                  <View style={styles.aiResultBody}>
                    <Text style={styles.aiInsectName}>{aiResult.insect}</Text>
                    <Text style={styles.aiMeta}>
                      {[
                        aiResult.category !== 'unknown' ? aiResult.category : null,
                        aiResult.lifeStage !== 'unknown' ? aiResult.lifeStage : null,
                        `${Math.round(aiResult.confidence * 100)}% confidence`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                    {aiResult.note ? <Text style={styles.aiNote}>{aiResult.note}</Text> : null}
                    <Text style={styles.subhead}>Try these flies</Text>
                    <MatchingFliesGrid
                      flyNames={aiMatchedInsect ? fliesForInsect(aiMatchedInsect) : aiResult.flies}
                      sizeHint={aiMatchedInsect ? sizeHintFor(aiMatchedInsect) : null}
                      colors={colors}
                    />
                    <Pressable onPress={clearAi} style={styles.clearLink}>
                      <Text style={styles.linkText}>Clear photo</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or narrow by features</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* ---- Feature key ---- */}
            <View style={styles.filterGrid}>
              <FilterDropdown
                label="Type"
                options={categoryOpts}
                selected={filters.category ?? null}
                onSelect={(v) => setFilters((f) => ({ ...f, category: v as HatchCategory | null }))}
                colors={colors}
                styles={styles}
              />
              <FilterDropdown
                label="Size"
                options={sizeOpts}
                selected={filters.size ?? null}
                onSelect={(v) => setFilters((f) => ({ ...f, size: v as SizeBucket | null }))}
                colors={colors}
                styles={styles}
              />
              <FilterDropdown
                label="Body color"
                options={colorOpts}
                selected={filters.color ?? null}
                onSelect={(v) => setFilters((f) => ({ ...f, color: v as InsectBodyColor | null }))}
                colors={colors}
                styles={styles}
              />
              <FilterDropdown
                label="Wing / profile"
                options={profileOpts}
                selected={filters.profile ?? null}
                onSelect={(v) => setFilters((f) => ({ ...f, profile: v as InsectProfile | null }))}
                colors={colors}
                styles={styles}
              />
              <FilterDropdown
                label="Life stage"
                options={stageOpts}
                selected={filters.lifeStage ?? null}
                onSelect={(v) => setFilters((f) => ({ ...f, lifeStage: v as InsectLifeStage | null }))}
                colors={colors}
                styles={styles}
              />
            </View>
          </ScrollView>
        </>
      )}
    </View>
  );
}

/** Detail view for one picked candidate: ID note + matching flies grouped by life stage. */
function InsectDetail({
  insect,
  onBack,
  colors,
  styles,
}: {
  insect: Insect;
  onBack: () => void;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
}) {
  const stages = Object.keys(insect.fliesByLifeStage) as InsectLifeStage[];
  return (
    <View>
      <Pressable onPress={onBack} hitSlop={8} style={styles.detailBack}>
        <Ionicons name="chevron-back" size={18} color={colors.primary} />
        <Text style={styles.linkText}>Back to matches</Text>
      </Pressable>
      <Text style={styles.detailTitle}>{insect.commonName}</Text>
      <Text style={styles.candidateMeta}>
        {sizeHintFor(insect)} · {insect.bodyColors.map((c) => BODY_COLOR_LABELS[c]).join(', ')}
      </Text>
      <Text style={styles.detailNote}>{insect.idNote}</Text>

      {stages.map((stage) => {
        const names = fliesForInsect(insect, stage);
        if (names.length === 0) return null;
        return (
          <View key={stage} style={styles.stageBlock}>
            <Text style={styles.subhead}>{LIFE_STAGE_LABELS[stage]}</Text>
            <MatchingFliesGrid flyNames={names} sizeHint={sizeHintFor(insect)} colors={colors} />
          </View>
        );
      })}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.sm,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    backButton: { width: 40, alignItems: 'flex-start' },
    headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
    lowerScroll: { flex: 1 },
    content: { padding: Spacing.md, paddingBottom: Spacing.xxl },
    sectionTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
    sectionHint: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 2, marginBottom: Spacing.md },
    matchesPane: {
      paddingHorizontal: Spacing.md,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.sm,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    matchesScroll: { flex: 1 },
    matchesScrollContent: { paddingBottom: Spacing.xs },
    emptyMatches: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      fontStyle: 'italic',
      paddingVertical: Spacing.sm,
    },
    photoButtons: { flexDirection: 'row', gap: Spacing.sm },
    photoButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: colors.primary,
      paddingVertical: Spacing.md,
      borderRadius: BorderRadius.md,
    },
    photoButtonAlt: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary },
    photoButtonText: { color: colors.surface, fontWeight: '700', fontSize: FontSize.md },
    photoButtonTextAlt: { color: colors.primary },
    aiResultCard: {
      marginTop: Spacing.md,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    aiPhoto: { width: '100%', height: 180 },
    aiLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md },
    aiLoadingText: { color: colors.textSecondary, fontSize: FontSize.md },
    aiErrorBox: { padding: Spacing.md, gap: Spacing.sm },
    aiErrorText: { color: colors.error, fontSize: FontSize.sm },
    aiResultBody: { padding: Spacing.md },
    aiInsectName: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text },
    aiMeta: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 2, textTransform: 'capitalize' },
    aiNote: { fontSize: FontSize.sm, color: colors.text, marginTop: Spacing.sm },
    subhead: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
      marginTop: Spacing.md,
      marginBottom: Spacing.sm,
    },
    clearLink: { marginTop: Spacing.md, alignSelf: 'flex-start' },
    linkText: { color: colors.primary, fontWeight: '600', fontSize: FontSize.sm },
    divider: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginVertical: Spacing.md },
    dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
    dividerText: { fontSize: FontSize.sm, color: colors.textSecondary },
    filterGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    filterStep: { width: '48.5%', marginBottom: Spacing.sm },
    filterLabel: { fontSize: FontSize.xs, fontWeight: '700', color: colors.textSecondary, marginBottom: 4 },
    dropdownTrigger: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.xs,
      paddingVertical: Spacing.xs + 1,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    dropdownTriggerDisabled: { opacity: 0.5 },
    dropdownValue: { flex: 1, fontSize: FontSize.sm, color: colors.text, fontWeight: '600' },
    dropdownValueMuted: { color: colors.textTertiary, fontWeight: '400' },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'center',
      padding: Spacing.lg,
    },
    modalCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
    },
    modalTitle: {
      fontSize: FontSize.sm,
      fontWeight: '700',
      color: colors.textSecondary,
      marginBottom: Spacing.sm,
    },
    optionScroll: { maxHeight: 360 },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.sm,
    },
    optionRowActive: { backgroundColor: `${colors.primary}18` },
    optionText: { fontSize: FontSize.md, color: colors.text },
    optionTextActive: { fontWeight: '700', color: colors.primary },
    candidatesHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    candidateCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    candidateThumb: {
      width: 52,
      height: 52,
      borderRadius: BorderRadius.sm,
      marginRight: Spacing.md,
      backgroundColor: colors.background,
    },
    candidateThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
    candidateMain: { flex: 1, marginRight: Spacing.sm },
    candidateName: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    candidateMeta: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 2 },
    candidateNote: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: Spacing.xs },
    detailBack: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: Spacing.sm },
    detailTitle: { fontSize: FontSize.xxl, fontWeight: '700', color: colors.text },
    detailNote: { fontSize: FontSize.md, color: colors.text, marginTop: Spacing.sm },
    stageBlock: { marginTop: Spacing.md },
  });
}
