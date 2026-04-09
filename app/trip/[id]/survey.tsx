import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useTripStore } from '@/src/stores/tripStore';
import { CLARITY_LABELS } from '@/src/services/waterFlow';
import { WaterClarity } from '@/src/types';
import { MaterialIcons } from '@expo/vector-icons';

export const TRIP_SURVEY_CLARITY_OPTIONS: Exclude<WaterClarity, 'unknown'>[] = [
  'clear',
  'slightly_stained',
  'stained',
  'murky',
  'blown_out',
];

export default function TripSurveyScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createTripSurveyStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const { activeTrip, updateTripSurvey } = useTripStore();
  const [rating, setRating] = useState<number | null>(null);
  const [userReportedClarity, setUserReportedClarity] = useState<WaterClarity | null>(null);
  const [notes, setNotes] = useState('');
  const [pendingAction, setPendingAction] = useState<'submit' | 'skip' | null>(null);

  const canSubmit = rating !== null;
  const trip = activeTrip?.id === id ? activeTrip : null;
  const busy = pendingAction !== null;

  const finishSurvey = async (
    action: 'submit' | 'skip',
    payload: {
      rating: number | null;
      user_reported_clarity: WaterClarity | null;
      notes: string | null;
    },
  ) => {
    if (!id || !trip) return;
    setPendingAction(action);
    try {
      const synced = await updateTripSurvey(id, payload);
      if (!synced) {
        Alert.alert(
          'Saved on device',
          'Survey will sync when you\'re back online or when you open the app with connection.',
          [{ text: 'OK' }],
        );
      }
      router.replace(`/trip/${id}/summary`);
    } catch {
      setPendingAction(null);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await finishSurvey('submit', {
      rating,
      user_reported_clarity: userReportedClarity,
      notes: notes.trim() || null,
    });
  };

  const handleSkip = async () => {
    await finishSurvey('skip', {
      rating: null,
      user_reported_clarity: null,
      notes: null,
    });
  };

  if (!trip) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.centered}>
          <Text style={styles.message}>Trip data not found. Going back.</Text>
          <Pressable style={styles.primaryButton} onPress={() => router.replace('/(tabs)/home')}>
            <Text style={styles.primaryButtonText}>Home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: effectiveTop + Spacing.xl,
            paddingBottom: Math.max(insets.bottom, 32) + Spacing.xxl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}
      >
        <Text style={styles.title}>How was your trip?</Text>
        <Text style={styles.subtitle}>Quick survey — helps us improve recommendations</Text>

        <Text style={styles.label}>Rate your trip (1–5 stars)</Text>
        <View style={styles.starRow}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Pressable
              key={star}
              style={styles.starButton}
              onPress={() => setRating(star)}
            >
              <MaterialIcons
                name={rating !== null && star <= rating ? 'star' : 'star-border'}
                size={40}
                color={rating !== null && star <= rating ? colors.warning : colors.border}
              />
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>How was the water? (optional)</Text>
        <View style={styles.clarityRow}>
          {TRIP_SURVEY_CLARITY_OPTIONS.map((key) => (
            <Pressable
              key={key}
              style={[
                styles.clarityPill,
                userReportedClarity === key && styles.clarityPillSelected,
              ]}
              onPress={() => setUserReportedClarity(userReportedClarity === key ? null : key)}
            >
              <Text
                style={[
                  styles.clarityPillText,
                  userReportedClarity === key && styles.clarityPillTextSelected,
                ]}
              >
                {CLARITY_LABELS[key]}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="Anything else about conditions or the day?"
          placeholderTextColor={colors.textTertiary}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />

        <Pressable
          style={[
            styles.primaryButton,
            styles.submitButton,
            (!canSubmit || busy) && styles.primaryButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!canSubmit || busy}
        >
          {pendingAction === 'submit' ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.primaryButtonText}>Done</Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.skipButton, busy && styles.skipButtonDisabled]}
          onPress={handleSkip}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Skip survey"
        >
          {pendingAction === 'skip' ? (
            <ActivityIndicator color={colors.textSecondary} />
          ) : (
            <Text style={styles.skipButtonText}>Skip</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

export function createTripSurveyStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    modalTopBar: {
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.xs,
    },
    modalCancel: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.primary,
      alignSelf: 'flex-start',
    },
    scroll: {
      flex: 1,
    },
    content: {
      padding: Spacing.xl,
      paddingBottom: Spacing.xxl,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: Spacing.xl,
    },
    message: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      marginBottom: Spacing.lg,
      textAlign: 'center',
    },
    title: {
      fontSize: FontSize.xxl,
      fontWeight: '700',
      color: colors.text,
      marginBottom: Spacing.xs,
    },
    subtitle: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginBottom: Spacing.xl,
    },
    label: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: Spacing.sm,
      marginTop: Spacing.md,
    },
    starRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.md,
    },
    starButton: {
      padding: Spacing.xs,
    },
    clarityRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
      marginBottom: Spacing.md,
    },
    clarityPill: {
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    clarityPillSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + '15',
    },
    clarityPillText: {
      fontSize: FontSize.sm,
      color: colors.text,
    },
    clarityPillTextSelected: {
      fontWeight: '600',
      color: colors.primary,
    },
    notesInput: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.md,
      fontSize: FontSize.md,
      color: colors.text,
      minHeight: 88,
      textAlignVertical: 'top',
    },
    primaryButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      alignItems: 'center',
      marginTop: Spacing.xl,
    },
    primaryButtonDisabled: {
      opacity: 0.6,
    },
    submitButton: {
      marginBottom: Spacing.sm,
    },
    skipButton: {
      paddingVertical: Spacing.md,
      alignItems: 'center',
    },
    skipButtonDisabled: {
      opacity: 0.5,
    },
    skipButtonText: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.textSecondary,
    },
    primaryButtonText: {
      color: colors.textInverse,
      fontSize: FontSize.md,
      fontWeight: '600',
    },
  });
}
