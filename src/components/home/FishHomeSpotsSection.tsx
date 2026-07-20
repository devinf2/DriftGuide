import { DriftGuideMessage } from '@/src/components/home/DriftGuideMessage';
import { RecommendedSpotCard, recommendedSpotsLoadingStyles } from '@/src/components/home/RecommendedSpotCard';
import type { HomeHotSpotData } from '@/src/utils/homeHotSpots';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';

function createHeaderStyles(colors: ThemeColors) {
  return StyleSheet.create({
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.md,
    },
    sectionTitle: {
      fontSize: FontSize.md,
      fontWeight: '700',
      color: colors.text,
      fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: undefined }),
    },
    countPill: {
      marginLeft: 'auto',
      paddingHorizontal: Spacing.sm,
      paddingVertical: 2,
      borderRadius: BorderRadius.full,
      backgroundColor: colors.secondary + '1A',
    },
    countPillText: {
      fontSize: FontSize.xs,
      fontWeight: '700',
      color: colors.secondary,
    },
  });
}

export function FishHomeSpotsSection({
  hotSpotLoading,
  hotSpotList,
  onOpenSpot,
}: {
  hotSpotLoading: boolean;
  hotSpotList: HomeHotSpotData[];
  onOpenSpot: (locationId: string) => void;
}) {
  const { colors } = useAppTheme();
  const headerStyles = useMemo(() => createHeaderStyles(colors), [colors]);
  const loadStyles = useMemo(() => recommendedSpotsLoadingStyles(colors), [colors]);

  return (
    <DriftGuideMessage>
      <View>
        <View style={headerStyles.sectionHeader}>
          <Ionicons name="location-sharp" size={20} color={colors.secondary} />
          <Text style={headerStyles.sectionTitle}>Recommended Locations</Text>
          {!hotSpotLoading && hotSpotList.length > 0 ? (
            <View style={headerStyles.countPill}>
              <Text style={headerStyles.countPillText}>{hotSpotList.length}</Text>
            </View>
          ) : null}
        </View>

        {hotSpotLoading ? (
          <View style={loadStyles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : hotSpotList[0] ? (
          hotSpotList.map((hotSpot, i) => (
            <RecommendedSpotCard
              key={hotSpot.location.id}
              data={hotSpot}
              rank={i + 1}
              isTopPick={i === 0}
              onPress={() => onOpenSpot(hotSpot.location.id)}
            />
          ))
        ) : (
          <View style={loadStyles.emptyBox}>
            <Text style={loadStyles.emptyText}>
              {
                "When you have waters in the app, we'll highlight where conditions look strongest so you can pick where to fish."
              }
            </Text>
          </View>
        )}
      </View>
    </DriftGuideMessage>
  );
}
