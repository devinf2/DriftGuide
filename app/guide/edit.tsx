import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { GuideOfferingType, GuideService, Location } from '@/src/types';
import {
  getGuideProfile,
  upsertGuideProfile,
  fetchGuideServices,
  addGuideService,
  deleteGuideService,
  fetchGuideWaters,
  setGuideWaters,
  type GuideProfileInput,
  type GuideWater,
} from '@/src/services/guideService';

/** Progressive US phone formatting, capped at 10 digits: "(555) 123-4567". */
function formatUsPhone(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export default function GuideEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const user = useAuthStore((s) => s.user);
  const locations = useLocationStore((s) => s.locations);
  const fetchLocations = useLocationStore((s) => s.fetchLocations);
  const searchLocations = useLocationStore((s) => s.searchLocations);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  /** True once a profile row exists in the DB — gates Preview so it never opens a dead page. */
  const [hasSavedProfile, setHasSavedProfile] = useState(false);

  const [bio, setBio] = useState('');
  const [waters, setWaters] = useState<GuideWater[]>([]);
  const [years, setYears] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [bookingUrl, setBookingUrl] = useState('');

  const [services, setServices] = useState<GuideService[]>([]);
  const [serviceModalOpen, setServiceModalOpen] = useState(false);
  const [svcType, setSvcType] = useState<GuideOfferingType>('booking');
  const [svcTitle, setSvcTitle] = useState('');
  const [svcDuration, setSvcDuration] = useState('');
  const [svcPrice, setSvcPrice] = useState('');
  const [svcQuantity, setSvcQuantity] = useState('');
  const [svcDesc, setSvcDesc] = useState('');
  const [svcLocationId, setSvcLocationId] = useState<string | null>(null);
  const [svcLocationName, setSvcLocationName] = useState<string | null>(null);
  const [svcSaving, setSvcSaving] = useState(false);

  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [waterPickerOpen, setWaterPickerOpen] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');

  const locationOptions = useMemo(() => {
    const q = locationQuery.trim();
    return (q.length >= 2 ? searchLocations(q) : locations).slice(0, 40);
  }, [locationQuery, locations, searchLocations]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    if (locations.length === 0) void fetchLocations();
    const existing = await getGuideProfile(user.id);
    if (existing) {
      setBio(existing.bio ?? '');
      setYears(existing.years_experience != null ? String(existing.years_experience) : '');
      setEmail(existing.contact_email ?? '');
      setPhone(formatUsPhone(existing.contact_phone ?? ''));
      setBookingUrl(existing.booking_url ?? '');
      setStatus(existing.status);
      setHasSavedProfile(true);
      const [svc, wtr] = await Promise.all([fetchGuideServices(user.id), fetchGuideWaters(user.id)]);
      setServices(svc);
      setWaters(wtr);
    }
    setLoading(false);
  }, [user, locations.length, fetchLocations]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (!user) {
      Alert.alert('Sign in required', 'Sign in to set up a guide profile.');
      return;
    }
    Keyboard.dismiss();
    setSaving(true);
    try {
      const input: GuideProfileInput = {
        bio: bio.trim() || null,
        years_experience: years.trim() ? Number(years.trim()) : null,
        contact_email: email.trim() || null,
        contact_phone: phone.trim() || null,
        booking_url: bookingUrl.trim() || null,
      };
      const result = await upsertGuideProfile(user.id, input);
      if (result) {
        // Persist waters only after the profile row exists (guide_waters FKs it).
        await setGuideWaters(user.id, waters.map((w) => w.id));
        setStatus(result.status);
        setHasSavedProfile(true);
        Alert.alert('Saved', result.status === 'approved' ? 'Your guide profile is updated.' : 'Saved. An admin will review your profile for verification.');
      } else {
        Alert.alert('Could not save', 'Something went wrong. Try again.');
      }
    } finally {
      setSaving(false);
    }
  }, [user, bio, waters, years, email, phone, bookingUrl]);

  const toggleWater = useCallback((loc: Location) => {
    setWaters((prev) =>
      prev.some((w) => w.id === loc.id)
        ? prev.filter((w) => w.id !== loc.id)
        : [...prev, { id: loc.id, name: loc.name }],
    );
  }, []);

  const addService = useCallback(async () => {
    if (!user) return;
    if (!hasSavedProfile) {
      Alert.alert('Save your profile first', 'Tap "Save profile" before adding offerings.');
      return;
    }
    if (!svcTitle.trim()) {
      Alert.alert('Title needed', 'Give the offering a title (e.g. "Half day on the Provo").');
      return;
    }
    Keyboard.dismiss();
    setSvcSaving(true);
    try {
      const created = await addGuideService(user.id, {
        offering_type: svcType,
        title: svcTitle.trim(),
        location_id: svcLocationId,
        price_cents: svcPrice.trim() ? Math.round(Number(svcPrice.trim()) * 100) : null,
        duration_label: svcType === 'booking' ? svcDuration.trim() || null : null,
        quantity_available: svcType === 'booking' && svcQuantity.trim() ? Number(svcQuantity.trim()) : null,
        description: svcDesc.trim() || null,
        active: true,
      });
      if (created) {
        setServices((prev) => [...prev, created]);
        setServiceModalOpen(false);
        setSvcType('booking');
        setSvcTitle('');
        setSvcDuration('');
        setSvcPrice('');
        setSvcQuantity('');
        setSvcDesc('');
        setSvcLocationId(null);
        setSvcLocationName(null);
      } else {
        Alert.alert('Could not add', 'You may need to save your guide profile first.');
      }
    } finally {
      setSvcSaving(false);
    }
  }, [user, hasSavedProfile, svcType, svcTitle, svcDuration, svcPrice, svcQuantity, svcDesc, svcLocationId]);

  const removeService = useCallback((id: string) => {
    Alert.alert('Remove service', 'Delete this service?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const ok = await deleteGuideService(id);
            if (ok) setServices((prev) => prev.filter((s) => s.id !== id));
          })();
        },
      },
    ]);
  }, []);

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Close">
          <Ionicons name="close" size={26} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.headerTitle}>Guide profile</Text>
        <Pressable
          onPress={() => {
            Keyboard.dismiss();
            if (!hasSavedProfile) {
              Alert.alert('Save first', 'Save your profile, then you can preview how it looks to anglers.');
              return;
            }
            if (user) router.push(`/guide/${user.id}`);
          }}
        >
          <Text style={[styles.previewLink, !hasSavedProfile && styles.previewLinkDisabled]}>Preview</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + Spacing.xxl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {status && status !== 'approved' ? (
          <View style={styles.statusBanner}>
            <Ionicons name="time-outline" size={16} color={colors.warning} />
            <Text style={styles.statusText}>
              {status === 'pending' ? 'Pending admin verification.' : 'Profile suspended — contact support.'}
            </Text>
          </View>
        ) : null}

        <Field label="Bio" value={bio} onChangeText={setBio} placeholder="Tell anglers about your guiding style and waters." multiline styles={styles} colors={colors} />

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Waters I guide</Text>
          <View style={styles.chipWrap}>
            {waters.map((w) => (
              <View key={w.id} style={styles.chip}>
                <Text style={styles.chipText} numberOfLines={1}>{w.name}</Text>
                <Pressable hitSlop={8} onPress={() => setWaters((prev) => prev.filter((x) => x.id !== w.id))} accessibilityLabel={`Remove ${w.name}`}>
                  <Ionicons name="close" size={14} color={colors.textSecondary} />
                </Pressable>
              </View>
            ))}
            <Pressable
              style={styles.addChip}
              onPress={() => {
                Keyboard.dismiss();
                setLocationQuery('');
                setWaterPickerOpen(true);
              }}
            >
              <Ionicons name="add" size={16} color={colors.primary} />
              <Text style={styles.addChipText}>Add water</Text>
            </Pressable>
          </View>
          <Text style={styles.helperText}>Anglers find you on the report for each water you list.</Text>
        </View>

        <Field label="Years of experience" value={years} onChangeText={setYears} placeholder="e.g. 8" keyboardType="number-pad" styles={styles} colors={colors} />
        <Field label="Contact email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" styles={styles} colors={colors} />
        <Field label="Contact phone" value={phone} onChangeText={(t) => setPhone(formatUsPhone(t))} placeholder="(555) 123-4567" keyboardType="phone-pad" maxLength={14} styles={styles} colors={colors} />
        <Field label="Booking link (optional)" value={bookingUrl} onChangeText={setBookingUrl} placeholder="calendly.com/…" autoCapitalize="none" keyboardType="url" styles={styles} colors={colors} />

        <Pressable style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.saveButtonText}>Save profile</Text>}
        </Pressable>

        {/* Offerings */}
        <View style={styles.servicesHeader}>
          <Text style={styles.sectionTitle}>Offerings</Text>
          <Pressable onPress={() => setServiceModalOpen(true)} style={styles.addServiceButton}>
            <Ionicons name="add" size={18} color={colors.primary} />
            <Text style={styles.addServiceText}>Add</Text>
          </Pressable>
        </View>
        {services.length === 0 ? (
          <Text style={styles.muted}>No offerings yet. Add a bookable trip (e.g. "Half day — $200") or a guide book PDF.</Text>
        ) : (
          services.map((s) => (
            <View key={s.id} style={styles.serviceRow}>
              <Ionicons
                name={s.offering_type === 'download' ? 'document-text-outline' : 'calendar-outline'}
                size={20}
                color={colors.textSecondary}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.serviceTitle}>{s.title}</Text>
                <Text style={styles.serviceMeta}>
                  {[
                    s.offering_type === 'download' ? 'Guide book' : s.duration_label,
                    s.price_cents != null ? `$${(s.price_cents / 100).toFixed(0)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <Pressable onPress={() => removeService(s.id)} hitSlop={8}>
                <Ionicons name="trash-outline" size={20} color={colors.error} />
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={serviceModalOpen} transparent animationType="fade" onRequestClose={() => setServiceModalOpen(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable style={styles.modalBackdrop} onPress={Keyboard.dismiss}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <Text style={styles.modalTitle}>New offering</Text>
              <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
                <View style={styles.typeToggleRow}>
                  <Pressable
                    style={[styles.typeToggle, svcType === 'booking' ? styles.typeToggleOn : styles.typeToggleOff]}
                    onPress={() => setSvcType('booking')}
                  >
                    <Ionicons name="calendar-outline" size={16} color={svcType === 'booking' ? colors.textInverse : colors.text} />
                    <Text style={svcType === 'booking' ? styles.typeToggleTextOn : styles.typeToggleTextOff}>Trip booking</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.typeToggle, svcType === 'download' ? styles.typeToggleOn : styles.typeToggleOff]}
                    onPress={() => setSvcType('download')}
                  >
                    <Ionicons name="document-text-outline" size={16} color={svcType === 'download' ? colors.textInverse : colors.text} />
                    <Text style={svcType === 'download' ? styles.typeToggleTextOn : styles.typeToggleTextOff}>Guide book (PDF)</Text>
                  </Pressable>
                </View>

                <TextInput
                  style={styles.modalInput}
                  placeholder={svcType === 'booking' ? 'Title (e.g. Half day on the Provo)' : 'Title (e.g. Provo River guide book)'}
                  placeholderTextColor={colors.textTertiary}
                  value={svcTitle}
                  onChangeText={setSvcTitle}
                  returnKeyType="done"
                />

                {/* Location dropdown */}
                <Pressable
                  style={styles.locationField}
                  onPress={() => {
                    Keyboard.dismiss();
                    setLocationQuery('');
                    setLocationPickerOpen(true);
                  }}
                >
                  <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
                  <Text style={[styles.locationFieldText, !svcLocationName && styles.locationFieldPlaceholder]} numberOfLines={1}>
                    {svcLocationName ?? 'Location (optional)'}
                  </Text>
                  {svcLocationName ? (
                    <Pressable
                      hitSlop={8}
                      onPress={() => {
                        setSvcLocationId(null);
                        setSvcLocationName(null);
                      }}
                    >
                      <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
                    </Pressable>
                  ) : (
                    <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
                  )}
                </Pressable>

                {svcType === 'booking' ? (
                  <>
                    <TextInput style={styles.modalInput} placeholder="Duration (e.g. Half day)" placeholderTextColor={colors.textTertiary} value={svcDuration} onChangeText={setSvcDuration} returnKeyType="done" />
                    <TextInput style={styles.modalInput} placeholder="Max party size (optional)" placeholderTextColor={colors.textTertiary} value={svcQuantity} onChangeText={setSvcQuantity} keyboardType="number-pad" returnKeyType="done" />
                  </>
                ) : null}
                <TextInput style={styles.modalInput} placeholder="Price in USD (e.g. 200)" placeholderTextColor={colors.textTertiary} value={svcPrice} onChangeText={setSvcPrice} keyboardType="decimal-pad" returnKeyType="done" />
                <TextInput style={[styles.modalInput, { minHeight: 70, textAlignVertical: 'top' }]} placeholder="Description (optional)" placeholderTextColor={colors.textTertiary} value={svcDesc} onChangeText={setSvcDesc} multiline />
                <Text style={styles.paymentNote}>
                  {svcType === 'download'
                    ? 'Payment & PDF delivery are arranged directly with you (Venmo/contact) for now. In‑app purchase & download are coming later.'
                    : 'Payment is arranged directly with you (Venmo/contact). Requests notify you in the app.'}
                </Text>
                <View style={styles.modalActions}>
                  <Pressable
                    style={styles.modalCancel}
                    onPress={() => {
                      Keyboard.dismiss();
                      setServiceModalOpen(false);
                      setSvcLocationId(null);
                      setSvcLocationName(null);
                    }}
                  >
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.modalSubmit} onPress={addService} disabled={svcSaving}>
                    {svcSaving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.modalSubmitText}>Add offering</Text>}
                  </Pressable>
                </View>
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>

        {/* Location picker — overlays the offering form (iOS can't stack two RN Modals). */}
        {locationPickerOpen ? (
          <View style={[StyleSheet.absoluteFill, styles.container, { paddingTop: insets.top }]}>
            <View style={styles.header}>
              <Pressable onPress={() => setLocationPickerOpen(false)} accessibilityLabel="Close">
                <Ionicons name="close" size={26} color={colors.textSecondary} />
              </Pressable>
              <Text style={styles.headerTitle}>Choose location</Text>
              <View style={{ width: 26 }} />
            </View>
            <View style={{ padding: Spacing.lg, paddingBottom: 0 }}>
              <TextInput
                style={styles.input}
                placeholder="Search locations…"
                placeholderTextColor={colors.textTertiary}
                value={locationQuery}
                onChangeText={setLocationQuery}
                autoCorrect={false}
                autoFocus
              />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: Spacing.lg, paddingTop: Spacing.sm }}>
              {locationOptions.length === 0 ? (
                <Text style={styles.muted}>
                  {locations.length === 0 ? 'Loading locations…' : 'No locations match. Try a different search.'}
                </Text>
              ) : (
                locationOptions.map((loc: Location) => (
                  <Pressable
                    key={loc.id}
                    style={styles.locationOptionRow}
                    onPress={() => {
                      setSvcLocationId(loc.id);
                      setSvcLocationName(loc.name);
                      setLocationPickerOpen(false);
                    }}
                  >
                    <Ionicons name="water-outline" size={18} color={colors.primary} />
                    <Text style={styles.locationOptionText} numberOfLines={1}>{loc.name}</Text>
                    {svcLocationId === loc.id ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        ) : null}
      </Modal>

      {/* Waters I guide — multi-select picker */}
      <Modal visible={waterPickerOpen} animationType="slide" onRequestClose={() => setWaterPickerOpen(false)}>
        <View style={[styles.container, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <Pressable onPress={() => setWaterPickerOpen(false)} accessibilityLabel="Close">
              <Ionicons name="close" size={26} color={colors.textSecondary} />
            </Pressable>
            <Text style={styles.headerTitle}>Waters I guide</Text>
            <Pressable onPress={() => setWaterPickerOpen(false)}>
              <Text style={styles.previewLink}>Done</Text>
            </Pressable>
          </View>
          <View style={{ padding: Spacing.lg, paddingBottom: 0 }}>
            <TextInput
              style={styles.input}
              placeholder="Search waters…"
              placeholderTextColor={colors.textTertiary}
              value={locationQuery}
              onChangeText={setLocationQuery}
              autoCorrect={false}
              autoFocus
            />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: Spacing.lg, paddingTop: Spacing.sm }}>
            {locationOptions.length === 0 ? (
              <Text style={styles.muted}>
                {locations.length === 0 ? 'Loading waters…' : 'No waters match. Try a different search.'}
              </Text>
            ) : (
              locationOptions.map((loc: Location) => {
                const selected = waters.some((w) => w.id === loc.id);
                return (
                  <Pressable key={loc.id} style={styles.locationOptionRow} onPress={() => toggleWater(loc)}>
                    <Ionicons name="water-outline" size={18} color={colors.primary} />
                    <Text style={styles.locationOptionText} numberOfLines={1}>{loc.name}</Text>
                    <Ionicons
                      name={selected ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={selected ? colors.primary : colors.textTertiary}
                    />
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function Field({
  label,
  styles,
  colors,
  ...inputProps
}: {
  label: string;
  styles: ReturnType<typeof createStyles>;
  colors: ThemeColors;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, inputProps.multiline && { minHeight: 90, textAlignVertical: 'top' }]}
        placeholderTextColor={colors.textTertiary}
        {...inputProps}
      />
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
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
    previewLink: { fontSize: FontSize.sm, fontWeight: '600', color: colors.primary },
    previewLinkDisabled: { color: colors.textTertiary },
    locationField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      backgroundColor: colors.background,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: Spacing.sm,
    },
    locationFieldText: { flex: 1, fontSize: FontSize.md, color: colors.text },
    locationFieldPlaceholder: { color: colors.textTertiary },
    locationOptionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderLight,
    },
    locationOptionText: { flex: 1, fontSize: FontSize.md, color: colors.text },
    statusBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      backgroundColor: colors.warning + '18',
      borderRadius: BorderRadius.md,
      padding: Spacing.sm,
      marginBottom: Spacing.md,
    },
    statusText: { flex: 1, fontSize: FontSize.sm, color: colors.textSecondary },
    field: { marginBottom: Spacing.md },
    fieldLabel: { fontSize: FontSize.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: Spacing.xs },
    chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      maxWidth: '100%',
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingLeft: Spacing.md,
      paddingRight: Spacing.sm,
      paddingVertical: Spacing.sm,
    },
    chipText: { flexShrink: 1, fontSize: FontSize.sm, fontWeight: '600', color: colors.text },
    addChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.primary,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    addChipText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.primary },
    helperText: { fontSize: FontSize.xs, color: colors.textTertiary, marginTop: Spacing.xs },
    input: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
    },
    saveButton: { backgroundColor: colors.primary, borderRadius: BorderRadius.md, paddingVertical: Spacing.md, alignItems: 'center', marginTop: Spacing.sm },
    saveButtonDisabled: { backgroundColor: colors.textTertiary },
    saveButtonText: { color: colors.textInverse, fontSize: FontSize.md, fontWeight: '700' },
    servicesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xxl },
    sectionTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text },
    addServiceButton: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    addServiceText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.primary },
    muted: { fontSize: FontSize.sm, color: colors.textTertiary, marginTop: Spacing.sm },
    serviceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.md,
      marginTop: Spacing.sm,
    },
    serviceTitle: { fontSize: FontSize.md, fontWeight: '600', color: colors.text },
    serviceMeta: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 2 },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: Spacing.lg },
    modalCard: { backgroundColor: colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg, maxHeight: '85%' },
    modalTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, marginBottom: Spacing.md },
    typeToggleRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
    typeToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, borderWidth: 1 },
    typeToggleOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    typeToggleOff: { backgroundColor: colors.background, borderColor: colors.border },
    typeToggleTextOn: { fontSize: FontSize.sm, fontWeight: '700', color: colors.textInverse },
    typeToggleTextOff: { fontSize: FontSize.sm, fontWeight: '600', color: colors.text },
    paymentNote: { fontSize: FontSize.xs, color: colors.textTertiary, marginBottom: Spacing.sm, lineHeight: 16 },
    modalInput: {
      backgroundColor: colors.background,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: Spacing.sm,
    },
    modalActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
    modalCancel: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: colors.border },
    modalCancelText: { fontSize: FontSize.md, fontWeight: '600', color: colors.textSecondary },
    modalSubmit: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: BorderRadius.md, backgroundColor: colors.primary },
    modalSubmitText: { fontSize: FontSize.md, fontWeight: '700', color: colors.textInverse },
  });
}
