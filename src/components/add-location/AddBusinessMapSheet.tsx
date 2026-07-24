import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useBusinessStore } from '@/src/stores/businessStore';
import { useLocationStore } from '@/src/stores/locationStore';
import type { Location } from '@/src/types';
import { MAPBOX_ACCESS_TOKEN } from '@/src/constants/mapbox';
import { forwardGeocode, type MapboxGeocodeFeature } from '@/src/services/mapboxGeocoding';
import { BusinessCategory } from '@/src/types';
import { addCommunityBusiness } from '@/src/services/businessService';

const CATEGORY_OPTIONS: { value: BusinessCategory; label: string }[] = [
  { value: 'fly_shop', label: 'Fly shop' },
  { value: 'outfitter', label: 'Outfitter' },
  { value: 'lodge', label: 'Lodge' },
  { value: 'guide_service', label: 'Guide service' },
  { value: 'other', label: 'Other' },
];

function categoryLabel(c: BusinessCategory | null): string {
  if (c == null) return 'Select';
  return CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}

function firstPartOfSearch(s: string): string {
  const t = s.trim();
  if (!t) return '';
  const comma = t.indexOf(',');
  return (comma === -1 ? t : t.slice(0, comma)).trim();
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sheetRoot: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 4, overflow: 'visible' },
    formPanel: {
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.md,
      maxHeight: 520,
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: -2 },
      elevation: 8,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
    title: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    closeButton: { padding: Spacing.xs, marginRight: -Spacing.xs },
    fieldLabel: { fontSize: FontSize.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: Spacing.xs, marginTop: Spacing.sm },
    input: {
      backgroundColor: colors.background,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
    },
    nameWrap: { position: 'relative', zIndex: 30 },
    suggestions: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      marginTop: Spacing.xs,
      maxHeight: 200,
      borderRadius: BorderRadius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
      zIndex: 40,
      elevation: 12,
    },
    suggestionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: 8,
      paddingHorizontal: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderLight,
    },
    suggestionText: { flex: 1, fontSize: FontSize.sm, color: colors.text },
    dropdown: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    dropdownText: { fontSize: FontSize.md, fontWeight: '600', color: colors.text },
    dropdownPlaceholder: { color: colors.textTertiary, fontWeight: '500' },
    saveButton: { backgroundColor: colors.primary, borderRadius: BorderRadius.md, paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.md },
    saveButtonDisabled: { backgroundColor: colors.textTertiary },
    saveButtonText: { color: colors.textInverse, fontSize: FontSize.md, fontWeight: '700' },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: Spacing.lg },
    modalContent: { backgroundColor: colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
    modalTitle: { fontSize: FontSize.md, fontWeight: '700', color: colors.text, marginBottom: Spacing.sm },
    modalOption: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.sm, borderRadius: BorderRadius.sm },
    modalOptionActive: { backgroundColor: colors.primary + '18' },
    modalOptionText: { fontSize: FontSize.md, color: colors.text },
    modalOptionTextActive: { fontWeight: '700', color: colors.primary },
    pickerScreen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: Spacing.lg, paddingTop: Spacing.xxl },
    pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
    pickerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
    pickerEmpty: { fontSize: FontSize.sm, color: colors.textTertiary, paddingVertical: Spacing.md },
    pickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderLight,
    },
    pickerRowText: { flex: 1, fontSize: FontSize.md, color: colors.text },
  });
}

type Props = {
  visible: boolean;
  pinLatitude: number;
  pinLongitude: number;
  geocodeProximity: [number, number];
  onApplyGeocodeFeature: (feature: MapboxGeocodeFeature) => void;
  onSaved: (businessId: string) => void;
  onRequestClose: () => void;
  onSheetHeightChange?: (height: number) => void;
  /** Optional Fishing-spot / Business kind selector rendered in the header (from AddPlaceSheet). */
  kindSelector?: ReactNode;
};

export function AddBusinessMapSheet({
  visible,
  pinLatitude,
  pinLongitude,
  geocodeProximity,
  onApplyGeocodeFeature,
  onSaved,
  onRequestClose,
  onSheetHeightChange,
  kindSelector,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuthStore();
  const upsertBusiness = useBusinessStore((s) => s.upsert);
  const fetchAllBusinesses = useBusinessStore((s) => s.fetchAll);
  const locations = useLocationStore((s) => s.locations);
  const fetchLocations = useLocationStore((s) => s.fetchLocations);
  const searchLocations = useLocationStore((s) => s.searchLocations);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<BusinessCategory | null>(null);
  const [website, setWebsite] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locationName, setLocationName] = useState<string | null>(null);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const locationOptions = useMemo(() => {
    const q = locationQuery.trim();
    return (q.length >= 2 ? searchLocations(q) : locations).slice(0, 40);
  }, [locationQuery, locations, searchLocations]);

  const [nameFocused, setNameFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<MapboxGeocodeFeature[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasVisibleRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      wasVisibleRef.current = false;
      setCategoryPickerOpen(false);
      setSuggestions([]);
      setNameFocused(false);
      return;
    }
    if (!wasVisibleRef.current) {
      wasVisibleRef.current = true;
      setName('');
      setCategory(null);
      setWebsite('');
      setPhone('');
      setAddress('');
      setLocationId(null);
      setLocationName(null);
      setSaving(false);
      if (locations.length === 0) void fetchLocations();
    }
  }, [visible, locations.length, fetchLocations]);

  useEffect(() => {
    if (!visible || !nameFocused || name.trim().length < 2 || !MAPBOX_ACCESS_TOKEN) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void (async () => {
        setSuggestionsLoading(true);
        try {
          const { features } = await forwardGeocode(name.trim(), { proximity: geocodeProximity, limit: 5 });
          setSuggestions(features);
        } catch {
          setSuggestions([]);
        } finally {
          setSuggestionsLoading(false);
        }
      })();
    }, 380);
    return () => clearTimeout(debounceRef.current);
  }, [name, nameFocused, visible, geocodeProximity]);

  const coordsOk = Number.isFinite(pinLatitude) && Number.isFinite(pinLongitude);
  const canSave = name.trim().length > 0 && category != null && coordsOk && !saving;

  const handleSave = useCallback(() => {
    if (!user) {
      Alert.alert('Sign in required', 'Sign in to add a business.');
      return;
    }
    if (!name.trim()) {
      Alert.alert('Name needed', 'Enter the business name.');
      return;
    }
    if (category == null) {
      Alert.alert('Category', 'Choose a category before adding.');
      return;
    }
    if (!coordsOk) {
      Alert.alert('Pin location needed', 'Pan the map so the pin sits on the business.');
      return;
    }
    Keyboard.dismiss();
    setSaving(true);
    void (async () => {
      try {
        const created = await addCommunityBusiness(
          {
            name: name.trim(),
            category,
            latitude: pinLatitude,
            longitude: pinLongitude,
            location_id: locationId,
            website_url: website,
            phone,
            address,
          },
          user.id,
        );
        if (created) {
          upsertBusiness(created);
          void fetchAllBusinesses();
          onSaved(created.id);
        } else {
          Alert.alert('Could not add business', 'Check your connection and that the latest migrations are applied.');
        }
      } catch {
        Alert.alert('Could not add business', 'Something went wrong. Try again with a stable connection.');
      } finally {
        setSaving(false);
      }
    })();
  }, [user, name, category, coordsOk, pinLatitude, pinLongitude, locationId, website, phone, address, upsertBusiness, fetchAllBusinesses, onSaved]);

  if (!visible) return null;

  return (
    <>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.sheetRoot}
        onLayout={(e) => onSheetHeightChange?.(e.nativeEvent.layout.height)}
      >
        <View style={styles.formPanel}>
          <View style={styles.header}>
            {kindSelector ?? <Text style={styles.title}>New business</Text>}
            <Pressable
              onPress={() => {
                Keyboard.dismiss();
                onRequestClose();
              }}
              style={styles.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={26} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
            <Text style={styles.fieldLabel}>Name</Text>
            <View style={styles.nameWrap}>
              <TextInput
                style={styles.input}
                placeholder="Search a place, or type a name…"
                placeholderTextColor={colors.textTertiary}
                value={name}
                onChangeText={setName}
                onFocus={() => setNameFocused(true)}
                onBlur={() => setTimeout(() => setNameFocused(false), 200)}
                autoCorrect={false}
                returnKeyType="done"
              />
              {nameFocused && name.trim().length >= 2 && (suggestionsLoading || suggestions.length > 0) ? (
                <View style={styles.suggestions}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    {suggestionsLoading ? (
                      <View style={styles.suggestionRow}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={styles.suggestionText}>Searching map…</Text>
                      </View>
                    ) : null}
                    {suggestions.map((f) => (
                      <Pressable
                        key={f.id}
                        style={styles.suggestionRow}
                        onPress={() => {
                          setName(firstPartOfSearch(f.place_name));
                          if (!address.trim()) setAddress(f.place_name);
                          onApplyGeocodeFeature(f);
                          Keyboard.dismiss();
                          setNameFocused(false);
                        }}
                      >
                        <Ionicons name="location-outline" size={18} color={colors.primary} />
                        <Text style={styles.suggestionText} numberOfLines={2}>
                          {f.place_name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </View>

            <Text style={styles.fieldLabel}>Category</Text>
            <Pressable style={styles.dropdown} onPress={() => setCategoryPickerOpen(true)}>
              <Text style={[styles.dropdownText, category == null && styles.dropdownPlaceholder]}>
                {categoryLabel(category)}
              </Text>
              <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
            </Pressable>

            <Text style={styles.fieldLabel}>Website (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="example.com"
              placeholderTextColor={colors.textTertiary}
              value={website}
              onChangeText={setWebsite}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
            />

            <Text style={styles.fieldLabel}>Phone (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="(555) 123-4567"
              placeholderTextColor={colors.textTertiary}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              returnKeyType="done"
            />

            <Text style={styles.fieldLabel}>Address (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Street, city, state"
              placeholderTextColor={colors.textTertiary}
              value={address}
              onChangeText={setAddress}
              returnKeyType="done"
            />

            <Text style={styles.fieldLabel}>Tag to a water (optional)</Text>
            <Pressable
              style={styles.dropdown}
              onPress={() => {
                Keyboard.dismiss();
                setLocationQuery('');
                setLocationPickerOpen(true);
              }}
            >
              <Text style={[styles.dropdownText, !locationName && styles.dropdownPlaceholder]} numberOfLines={1}>
                {locationName ?? 'None'}
              </Text>
              {locationName ? (
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    setLocationId(null);
                    setLocationName(null);
                  }}
                >
                  <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
                </Pressable>
              ) : (
                <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
              )}
            </Pressable>

            <Pressable style={[styles.saveButton, !canSave && styles.saveButtonDisabled]} onPress={handleSave} disabled={!canSave}>
              {saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.saveButtonText}>Add business</Text>}
            </Pressable>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={categoryPickerOpen} transparent animationType="fade" onRequestClose={() => setCategoryPickerOpen(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setCategoryPickerOpen(false)}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Category</Text>
            {CATEGORY_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.modalOption, category === opt.value && styles.modalOptionActive]}
                onPress={() => {
                  setCategory(opt.value);
                  setCategoryPickerOpen(false);
                }}
              >
                <Text style={[styles.modalOptionText, category === opt.value && styles.modalOptionTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={locationPickerOpen} animationType="slide" onRequestClose={() => setLocationPickerOpen(false)}>
        <View style={styles.pickerScreen}>
          <View style={styles.pickerHeader}>
            <Pressable onPress={() => setLocationPickerOpen(false)} accessibilityLabel="Close">
              <Ionicons name="close" size={26} color={colors.textSecondary} />
            </Pressable>
            <Text style={styles.pickerTitle}>Tag to a water</Text>
            <View style={{ width: 26 }} />
          </View>
          <TextInput
            style={[styles.input, { marginBottom: Spacing.sm }]}
            placeholder="Search waters…"
            placeholderTextColor={colors.textTertiary}
            value={locationQuery}
            onChangeText={setLocationQuery}
            autoCorrect={false}
            autoFocus
          />
          <ScrollView keyboardShouldPersistTaps="handled">
            {locationOptions.length === 0 ? (
              <Text style={styles.pickerEmpty}>
                {locations.length === 0 ? 'Loading waters…' : 'No waters match. Try a different search.'}
              </Text>
            ) : (
              locationOptions.map((loc: Location) => (
                <Pressable
                  key={loc.id}
                  style={styles.pickerRow}
                  onPress={() => {
                    setLocationId(loc.id);
                    setLocationName(loc.name);
                    setLocationPickerOpen(false);
                  }}
                >
                  <Ionicons name="water-outline" size={18} color={colors.primary} />
                  <Text style={styles.pickerRowText} numberOfLines={1}>{loc.name}</Text>
                  {locationId === loc.id ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}
