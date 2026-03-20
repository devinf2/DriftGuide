import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, BorderRadius } from '@/src/constants/theme';
import { useTripStore } from '@/src/stores/tripStore';
import { CLARITY_LABELS } from '@/src/services/waterFlow';
import { WaterClarity } from '@/src/types';
import { MaterialIcons } from '@expo/vector-icons';

const CLARITY_OPTIONS: Exclude<WaterClarity, 'unknown'>[] = [
  'clear',
  'slightly_stained',
  'stained',
  'murky',
  'blown_out',
];

export default function TripSurveyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { activeTrip, updateTripSurvey } = useTripStore();
  const [rating, setRating] = useState<number | null>(null);
  const [userReportedClarity, setUserReportedClarity] = useState<WaterClarity | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = rating !== null;
  const trip = activeTrip?.id === id ? activeTrip : null;

  const handleSubmit = async () => {
    if (!id || !trip || !canSubmit) return;
    setSubmitting(true);
    try {
      const synced = await updateTripSurvey(id, {
        rating,
        user_reported_clarity: userReportedClarity,
        notes: notes.trim() || null,
      });
      if (!synced) {
        Alert.alert(
          'Saved on device',
          'Survey will sync when you\'re back online or when you open the app with connection.',
          [{ text: 'OK' }],
        );
      }
      router.replace(`/trip/${id}/summary`);
    } catch {
      setSubmitting(false);
    }
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
            paddingTop: insets.top + Spacing.xl,
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
                color={rating !== null && star <= rating ? Colors.warning : Colors.border}
              />
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>How was the water? (optional)</Text>
        <View style={styles.clarityRow}>
          {CLARITY_OPTIONS.map((key) => (
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
          placeholderTextColor={Colors.textTertiary}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />

        <Pressable
          style={[styles.primaryButton, styles.submitButton, !canSubmit && styles.primaryButtonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit || submitting}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.textInverse} />
          ) : (
            <Text style={styles.primaryButtonText}>Done</Text>
          )}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
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
    color: Colors.textSecondary,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  title: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.xl,
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textSecondary,
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
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  clarityPillSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '15',
  },
  clarityPillText: {
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  clarityPillTextSelected: {
    fontWeight: '600',
    color: Colors.primary,
  },
  notesInput: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    fontSize: FontSize.md,
    color: Colors.text,
    minHeight: 88,
    textAlignVertical: 'top',
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.xl,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  submitButton: {
    marginBottom: Spacing.lg,
  },
  primaryButtonText: {
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
});
