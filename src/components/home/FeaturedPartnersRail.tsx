import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { FeaturedBusinessCard } from '@/src/types';
import { fetchHomeFeaturedBusinesses } from '@/src/services/promotionService';

const CATEGORY_LABEL: Record<FeaturedBusinessCard['category'], string> = {
  fly_shop: 'Fly shop',
  outfitter: 'Outfitter',
  lodge: 'Lodge',
  guide_service: 'Guide service',
  other: 'Business',
};

/**
 * Home-screen rail of admin-curated featured businesses and partner deals.
 * Renders nothing when there are no active promotions, so it's safe to always mount.
 */
export function FeaturedPartnersRail() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const [cards, setCards] = useState<FeaturedBusinessCard[]>([]);

  useEffect(() => {
    let alive = true;
    void fetchHomeFeaturedBusinesses().then((c) => {
      if (alive) setCards(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (cards.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Featured shops & deals</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {cards.map((card) => (
          <Pressable
            key={card.promotionId}
            style={styles.card}
            onPress={() => router.push(`/business/${card.businessId}`)}
            accessibilityRole="button"
            accessibilityLabel={card.businessName}
          >
            <View style={styles.cover}>
              {card.coverUrl ? (
                <Image source={{ uri: card.coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : card.logoUrl ? (
                <Image source={{ uri: card.logoUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.coverPlaceholder]}>
                  <Ionicons name="storefront" size={28} color={colors.textInverse} />
                </View>
              )}
              {card.dealTitle ? (
                <View style={styles.dealChip}>
                  <MaterialCommunityIcons name="tag-heart" size={12} color={colors.textInverse} />
                  <Text style={styles.dealChipText} numberOfLines={1}>
                    Deal
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={styles.info}>
              <Text style={styles.name} numberOfLines={1}>
                {card.businessName}
              </Text>
              {card.dealTitle ? (
                <Text style={styles.dealTitle} numberOfLines={2}>
                  {card.dealTitle}
                </Text>
              ) : (
                <Text style={styles.category} numberOfLines={1}>
                  {CATEGORY_LABEL[card.category]}
                </Text>
              )}
              {card.partnerName ? (
                <Text style={styles.partner} numberOfLines={1}>
                  via {card.partnerName}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { marginBottom: Spacing.md },
    heading: {
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.text,
      fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
      marginBottom: Spacing.sm,
      paddingHorizontal: Spacing.lg,
    },
    rail: { gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xs },
    card: {
      width: 220,
      borderRadius: BorderRadius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    cover: { height: 110, backgroundColor: colors.surfaceElevated },
    coverPlaceholder: { backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
    dealChip: {
      position: 'absolute',
      top: Spacing.sm,
      left: Spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.secondary,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: BorderRadius.full,
    },
    dealChipText: { fontSize: FontSize.xs, fontWeight: '700', color: colors.textInverse },
    info: { padding: Spacing.md },
    name: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    category: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 2 },
    dealTitle: { fontSize: FontSize.sm, color: colors.secondary, fontWeight: '600', marginTop: 2 },
    partner: { fontSize: FontSize.xs, color: colors.textTertiary, marginTop: 4 },
  });
}
