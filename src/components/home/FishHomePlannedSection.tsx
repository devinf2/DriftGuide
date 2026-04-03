import { DriftGuideMessage } from '@/src/components/home/DriftGuideMessage';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { Trip } from '@/src/types';
import { format } from 'date-fns';
import { useMemo } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sectionTitle: {
      fontSize: FontSize.xs,
      fontWeight: '600',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: Spacing.sm,
      marginTop: Spacing.md,
    },
    plannedCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Spacing.xs,
      borderWidth: 1,
      borderColor: colors.border,
    },
    plannedInfo: {
      flex: 1,
      marginRight: Spacing.md,
    },
    plannedName: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.text,
    },
    plannedMeta: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginTop: 2,
      textTransform: 'capitalize',
    },
    plannedActions: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    startTripBtn: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    startTripBtnText: {
      color: colors.textInverse,
      fontSize: FontSize.sm,
      fontWeight: '700',
    },
    deleteTripBtn: {
      backgroundColor: colors.borderLight,
      borderRadius: BorderRadius.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    deleteTripBtnText: {
      color: colors.error,
      fontSize: FontSize.sm,
      fontWeight: '600',
    },
  });
}

export function FishHomePlannedSection({
  plannedTrips,
  plannedTripsLoading,
  onStartTrip,
  onDeleteTrip,
}: {
  plannedTrips: Trip[];
  plannedTripsLoading: boolean;
  onStartTrip: (tripId: string) => void;
  onDeleteTrip: (trip: Trip) => void;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  if (plannedTrips.length === 0) return null;

  return (
    <DriftGuideMessage compactAfter>
      <View>
        <Text style={styles.sectionTitle}>Up next</Text>
        {plannedTripsLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: Spacing.md }} />
        ) : (
          <FlatList
            data={plannedTrips}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            renderItem={({ item }) => (
              <View style={styles.plannedCard}>
                <View style={styles.plannedInfo}>
                  <Text style={styles.plannedName}>{item.location?.name || 'Unknown Location'}</Text>
                  <Text style={styles.plannedMeta}>
                    {item.planned_date
                      ? format(new Date(item.planned_date), 'EEE, MMM d \u00B7 h:mm a')
                      : 'Planned'}
                  </Text>
                </View>
                <View style={styles.plannedActions}>
                  <Pressable style={styles.startTripBtn} onPress={() => onStartTrip(item.id)}>
                    <Text style={styles.startTripBtnText}>Start</Text>
                  </Pressable>
                  <Pressable style={styles.deleteTripBtn} onPress={() => onDeleteTrip(item)}>
                    <Text style={styles.deleteTripBtnText}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            )}
          />
        )}
      </View>
    </DriftGuideMessage>
  );
}
