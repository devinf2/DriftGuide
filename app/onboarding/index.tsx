import { CountryPickerModal } from '@/src/components/CountryPickerModal';
import { OnboardingWalkthrough } from '@/src/components/OnboardingWalkthrough';
import { TripPhotoVisibilityDropdown } from '@/src/components/TripPhotoVisibilityDropdown';
import { UsStatePickerModal } from '@/src/components/UsStatePickerModal';
import {
  isUsCountry,
  matchStoredHomeCountry,
  US_COUNTRY_CODE,
  type CountryOption,
} from '@/src/constants/countries';
import { matchStoredProfileHomeState } from '@/src/constants/usStates';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { TripPhotoVisibility } from '@/src/types';
import { hasSeenWalkthrough, markWalkthroughSeen } from '@/src/utils/walkthroughSeen';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scrollContent: { padding: Spacing.xl, paddingBottom: Spacing.xxl },
    title: {
      fontSize: FontSize.xl,
      fontWeight: '700',
      color: colors.text,
      marginBottom: Spacing.xs,
    },
    subtitle: { fontSize: FontSize.md, color: colors.textSecondary, marginBottom: Spacing.xl, lineHeight: 22 },
    label: { fontSize: FontSize.sm, fontWeight: '600', color: colors.textSecondary, marginBottom: Spacing.xs },
    input: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      fontSize: FontSize.md,
      color: colors.text,
      marginBottom: Spacing.lg,
    },
    pickerButton: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      marginBottom: Spacing.lg,
    },
    pickerButtonText: { fontSize: FontSize.md, color: colors.text },
    pickerPlaceholder: { fontSize: FontSize.md, color: colors.textTertiary },
    themeRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.xl },
    themeOption: {
      flex: 1,
      paddingVertical: Spacing.lg,
      borderRadius: BorderRadius.md,
      borderWidth: 2,
      alignItems: 'center',
    },
    themeOptionText: { fontSize: FontSize.md, fontWeight: '600' },
    primaryBtn: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.lg,
      alignItems: 'center',
      marginTop: Spacing.sm,
    },
    primaryBtnDisabled: { opacity: 0.6 },
    primaryBtnText: { color: colors.textInverse, fontSize: FontSize.lg, fontWeight: '700' },
    error: { color: colors.error, fontSize: FontSize.sm, textAlign: 'center', marginBottom: Spacing.md },
    photoVisBlock: {
      marginBottom: Spacing.lg,
      padding: Spacing.md,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
  });
}

export default function OnboardingScreen() {
  const router = useRouter();
  const { colors, darkModeEnabled } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const profile = useAuthStore((s) => s.profile);
  const completeProfileOnboarding = useAuthStore((s) => s.completeProfileOnboarding);
  const fetchLocations = useLocationStore((s) => s.fetchLocations);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [country, setCountry] = useState<CountryOption | null>(null);
  const [homeState, setHomeState] = useState<{ code: string; name: string } | null>(null);
  const [region, setRegion] = useState('');
  const [darkPref, setDarkPref] = useState(darkModeEnabled);
  const [countryModalOpen, setCountryModalOpen] = useState(false);
  const [stateModalOpen, setStateModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [defaultTripPhotoVisibility, setDefaultTripPhotoVisibility] =
    useState<TripPhotoVisibility>('private');

  // Show the swipeable intro once for brand-new users before the empty cold-start.
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [walkthroughChecked, setWalkthroughChecked] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const seen = await hasSeenWalkthrough();
      if (!active) return;
      setShowWalkthrough(!seen);
      setWalkthroughChecked(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  const isUs = isUsCountry(country?.code);

  useEffect(() => {
    setFirstName(profile?.first_name?.trim() ?? '');
    setLastName(profile?.last_name?.trim() ?? '');
    // Prefer the stored country; fall back to inferring US from a legacy home_state.
    const storedCountry =
      matchStoredHomeCountry(profile?.home_country) ??
      (profile?.home_state?.trim()
        ? matchStoredHomeCountry(US_COUNTRY_CODE)
        : null);
    setCountry(storedCountry);
    setHomeState(matchStoredProfileHomeState(profile?.home_state));
    setRegion(profile?.home_region?.trim() ?? '');
  }, [
    profile?.first_name,
    profile?.last_name,
    profile?.home_country,
    profile?.home_region,
    profile?.home_state,
  ]);

  useEffect(() => {
    setDarkPref(darkModeEnabled);
  }, [darkModeEnabled]);

  const handleCountrySelect = (c: CountryOption) => {
    setCountry(c);
    // Switching away from the US clears the state selection so it can't leak into a non-US region.
    if (!isUsCountry(c.code)) {
      setHomeState(null);
    }
  };

  const handleWalkthroughDone = () => {
    void markWalkthroughSeen();
    setShowWalkthrough(false);
  };

  const handleContinue = async () => {
    setError(null);
    setSubmitting(true);
    try {
      // For US the region is the chosen state; otherwise it's the free-text region.
      const homeRegion = isUs ? homeState?.name ?? '' : region;
      const result = await completeProfileOnboarding({
        firstName,
        lastName,
        homeCountry: country?.name ?? '',
        homeRegion,
        darkModeEnabled: darkPref,
        defaultTripPhotoVisibility: defaultTripPhotoVisibility,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      void fetchLocations();
      router.replace('/');
    } finally {
      setSubmitting(false);
    }
  };

  // Avoid flashing the form before we know whether to show the walkthrough.
  if (!walkthroughChecked) {
    return (
      <SafeAreaView style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (showWalkthrough) {
    return <OnboardingWalkthrough onDone={handleWalkthroughDone} />;
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Set up your profile</Text>
          <Text style={styles.subtitle}>
            A few details personalize DriftGuide and improve offline maps near home.
          </Text>

          <Text style={styles.label}>First name</Text>
          <TextInput
            style={styles.input}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="First name"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="words"
            autoCorrect={false}
          />

          <Text style={styles.label}>Last name</Text>
          <TextInput
            style={styles.input}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Last name"
            placeholderTextColor={colors.textTertiary}
            autoCapitalize="words"
            autoCorrect={false}
          />

          <View style={styles.photoVisBlock}>
            <Text style={styles.label}>Trip photos on profile</Text>
            <Text style={[styles.subtitle, { marginBottom: Spacing.md, marginTop: -4 }]}>
              Default for new trips. You can change this later in Settings.
            </Text>
            <TripPhotoVisibilityDropdown
              fullWidth
              label="Visible to"
              value={defaultTripPhotoVisibility}
              onChange={setDefaultTripPhotoVisibility}
            />
          </View>

          <Text style={styles.label}>Home country</Text>
          <Pressable style={styles.pickerButton} onPress={() => setCountryModalOpen(true)}>
            {country ? (
              <Text style={styles.pickerButtonText}>
                {country.name} ({country.code})
              </Text>
            ) : (
              <Text style={styles.pickerPlaceholder}>Tap to choose your country</Text>
            )}
          </Pressable>

          {isUs ? (
            <>
              <Text style={styles.label}>Home state (optional)</Text>
              <Pressable style={styles.pickerButton} onPress={() => setStateModalOpen(true)}>
                {homeState ? (
                  <Text style={styles.pickerButtonText}>
                    {homeState.name} ({homeState.code})
                  </Text>
                ) : (
                  <Text style={styles.pickerPlaceholder}>Tap to choose your state</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.label}>Region (optional)</Text>
              <TextInput
                style={styles.input}
                value={region}
                onChangeText={setRegion}
                placeholder="State, province, or region"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="words"
                autoCorrect={false}
              />
            </>
          )}

          <Text style={styles.label}>Appearance</Text>
          <View style={styles.themeRow}>
            <Pressable
              style={[
                styles.themeOption,
                {
                  borderColor: darkPref ? colors.primary : colors.border,
                  backgroundColor: darkPref ? colors.surfaceElevated : colors.surface,
                },
              ]}
              onPress={() => setDarkPref(true)}
            >
              <Text style={[styles.themeOptionText, { color: colors.text }]}>Dark</Text>
            </Pressable>
            <Pressable
              style={[
                styles.themeOption,
                {
                  borderColor: !darkPref ? colors.primary : colors.border,
                  backgroundColor: !darkPref ? colors.surfaceElevated : colors.surface,
                },
              ]}
              onPress={() => setDarkPref(false)}
            >
              <Text style={[styles.themeOptionText, { color: colors.text }]}>Light</Text>
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.primaryBtn, submitting && styles.primaryBtnDisabled]}
            onPress={handleContinue}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.primaryBtnText}>Continue</Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <CountryPickerModal
        visible={countryModalOpen}
        onClose={() => setCountryModalOpen(false)}
        onSelect={handleCountrySelect}
      />

      <UsStatePickerModal
        visible={stateModalOpen}
        onClose={() => setStateModalOpen(false)}
        onSelect={setHomeState}
      />
    </SafeAreaView>
  );
}
