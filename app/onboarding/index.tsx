import { UsStatePickerModal } from '@/src/components/UsStatePickerModal';
import { matchStoredProfileHomeState } from '@/src/constants/usStates';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAuthStore } from '@/src/stores/authStore';
import { useLocationStore } from '@/src/stores/locationStore';
import { useAppTheme } from '@/src/theme/ThemeProvider';
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
  const [homeState, setHomeState] = useState<{ code: string; name: string } | null>(null);
  const [darkPref, setDarkPref] = useState(darkModeEnabled);
  const [stateModalOpen, setStateModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setFirstName(profile?.first_name?.trim() ?? '');
    setLastName(profile?.last_name?.trim() ?? '');
    setHomeState(matchStoredProfileHomeState(profile?.home_state));
  }, [profile?.first_name, profile?.last_name, profile?.home_state]);

  useEffect(() => {
    setDarkPref(darkModeEnabled);
  }, [darkModeEnabled]);

  const handleContinue = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await completeProfileOnboarding({
        firstName,
        lastName,
        homeState: homeState?.name ?? '',
        darkModeEnabled: darkPref,
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

          <Text style={styles.label}>Home state</Text>
          <Pressable style={styles.pickerButton} onPress={() => setStateModalOpen(true)}>
            {homeState ? (
              <Text style={styles.pickerButtonText}>
                {homeState.name} ({homeState.code})
              </Text>
            ) : (
              <Text style={styles.pickerPlaceholder}>Tap to choose your state</Text>
            )}
          </Pressable>

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

      <UsStatePickerModal
        visible={stateModalOpen}
        onClose={() => setStateModalOpen(false)}
        onSelect={setHomeState}
      />
    </SafeAreaView>
  );
}
