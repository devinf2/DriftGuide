import { DriftGuideMessage } from '@/src/components/home/DriftGuideMessage';
import { RecommendedSpotCard, recommendedSpotsLoadingStyles } from '@/src/components/home/RecommendedSpotCard';
import type { HomeHotSpotData } from '@/src/utils/homeHotSpots';
import { FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

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
    seeMore: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.md,
    },
    seeMoreText: {
      fontSize: FontSize.xs,
      fontWeight: '600',
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
  const [expanded, setExpanded] = useState(false);
  const { colors } = useAppTheme();
  const headerStyles = useMemo(() => createHeaderStyles(colors), [colors]);
  const loadStyles = useMemo(() => recommendedSpotsLoadingStyles(colors), [colors]);

  return (
    <DriftGuideMessage>
      <View>
        <View style={headerStyles.sectionHeader}>
          <Ionicons name="location-sharp" size={20} color={colors.secondary} />
          <Text style={headerStyles.sectionTitle}>Recommended Spots</Text>
        </View>

        {hotSpotLoading ? (
          <View style={loadStyles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : hotSpotList[0] ? (
          <>
            <RecommendedSpotCard
              data={hotSpotList[0]}
              isTopPick
              onPress={() => onOpenSpot(hotSpotList[0].location.id)}
            />
            {expanded &&
              hotSpotList.slice(1).map((hotSpot) => (
                <RecommendedSpotCard
                  key={hotSpot.location.id}
                  data={hotSpot}
                  isTopPick={false}
                  onPress={() => onOpenSpot(hotSpot.location.id)}
                />
              ))}
            {hotSpotList.length > 1 && !expanded ? (
              <Pressable style={headerStyles.seeMore} onPress={() => setExpanded(true)}>
                <Text style={headerStyles.seeMoreText}>More waters to consider</Text>
                <Ionicons name="chevron-down" size={16} color={colors.secondary} />
              </Pressable>
            ) : null}
            {expanded && hotSpotList.length > 1 ? (
              <Pressable style={headerStyles.seeMore} onPress={() => setExpanded(false)}>
                <Text style={headerStyles.seeMoreText}>Show fewer</Text>
                <Ionicons name="chevron-up" size={16} color={colors.secondary} />
              </Pressable>
            ) : null}
          </>
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
