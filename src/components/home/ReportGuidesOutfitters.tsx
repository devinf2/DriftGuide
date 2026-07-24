import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { fetchGuidesForLocation, type GuideLocationCard } from '@/src/services/guideService';
import { fetchBusinessesForLocation, fetchBusinessesNearPoint } from '@/src/services/businessService';
import type { Business, BusinessCategory } from '@/src/types';

/** km → a short US-miles label ("<1 mi", "3 mi"). */
function milesLabel(km: number): string {
  const mi = km * 0.621371;
  return mi < 1 ? '<1 mi' : `${Math.round(mi)} mi`;
}

const CATEGORY_LABEL: Record<BusinessCategory, string> = {
  fly_shop: 'Fly shop',
  outfitter: 'Outfitter',
  lodge: 'Lodge',
  guide_service: 'Guide service',
  other: 'Shop',
};

type ShopItem = { business: Business; distanceKm: number | null; tagged: boolean };

/**
 * Report section: guides who work this water (avatar + star, best-rated first) and
 * shops for this water — those explicitly tagged to it first, then nearby ones by
 * proximity. Renders nothing when both are empty.
 */
export function ReportGuidesOutfitters({
  locationIds,
  lat,
  lng,
}: {
  locationIds?: string[] | null;
  lat?: number | null;
  lng?: number | null;
}) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const [guides, setGuides] = useState<GuideLocationCard[]>([]);
  const [shops, setShops] = useState<ShopItem[]>([]);

  const idsKey = (locationIds ?? []).join(',');

  useEffect(() => {
    let alive = true;
    const ids = locationIds ?? [];

    if (ids.length === 0) setGuides([]);
    else void fetchGuidesForLocation(ids).then((g) => alive && setGuides(g));

    void (async () => {
      const [tagged, nearby] = await Promise.all([
        ids.length ? fetchBusinessesForLocation(ids) : Promise.resolve([]),
        lat != null && lng != null ? fetchBusinessesNearPoint(lat, lng) : Promise.resolve([]),
      ]);
      if (!alive) return;
      const seen = new Set<string>();
      const merged: ShopItem[] = [];
      for (const b of tagged) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        merged.push({ business: b, distanceKm: null, tagged: true });
      }
      for (const b of nearby) {
        if (seen.has(b.id)) continue;
        seen.add(b.id);
        merged.push({ business: b, distanceKm: b.distance_km, tagged: false });
      }
      setShops(merged);
    })();

    return () => {
      alive = false;
    };
    // idsKey collapses the array identity so we don't refetch every render.
  }, [idsKey, lat, lng]); // eslint-disable-line react-hooks/exhaustive-deps

  if (guides.length === 0 && shops.length === 0) return null;

  return (
    <>
      {guides.length > 0 ? (
        <>
          <View style={styles.divider} />
          <Text style={styles.label}>Find a guide</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.guideRow}>
            {guides.map((g) => (
              <Pressable
                key={g.profileId}
                style={styles.guide}
                onPress={() => router.push(`/guide/${g.profileId}`)}
                accessibilityRole="button"
                accessibilityLabel={g.displayName}
              >
                <View style={styles.avatarWrap}>
                  {g.avatarUrl ? (
                    <Image source={{ uri: g.avatarUrl }} style={styles.avatar} contentFit="cover" />
                  ) : (
                    <View style={[styles.avatar, styles.avatarPlaceholder]}>
                      <Ionicons name="person" size={26} color={colors.textInverse} />
                    </View>
                  )}
                  {g.verified ? (
                    <View style={styles.badge}>
                      <MaterialCommunityIcons name="check-decagram" size={16} color={colors.info} />
                    </View>
                  ) : null}
                </View>
                <Text style={styles.guideName} numberOfLines={1}>
                  {g.displayName}
                </Text>
                <View style={styles.starRow}>
                  <Ionicons name="star" size={12} color={colors.warning} />
                  <Text style={styles.starText}>{g.reviewCount > 0 ? g.avgRating.toFixed(1) : 'New'}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </>
      ) : null}

      {shops.length > 0 ? (
        <>
          <View style={styles.divider} />
          <Text style={styles.label}>Local shops</Text>
          <View>
            {shops.map(({ business: b, distanceKm, tagged }) => (
              <Pressable
                key={b.id}
                style={styles.shopRow}
                onPress={() => router.push(`/business/${b.id}`)}
                accessibilityRole="button"
                accessibilityLabel={b.name}
              >
                <Ionicons name="storefront-outline" size={18} color={colors.textSecondary} />
                <View style={styles.shopText}>
                  <Text style={styles.shopName} numberOfLines={1}>
                    {b.name}
                  </Text>
                  <Text style={styles.shopMeta} numberOfLines={1}>
                    {CATEGORY_LABEL[b.category]}
                    {tagged ? ' · On this water' : distanceKm != null ? ` · ${milesLabel(distanceKm)}` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginVertical: Spacing.lg,
    },
    label: {
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: colors.textTertiary,
      marginBottom: Spacing.sm,
    },
    guideRow: { gap: Spacing.lg, paddingVertical: Spacing.xs, paddingRight: Spacing.md },
    guide: { alignItems: 'center', width: 76 },
    avatarWrap: { width: 60, height: 60 },
    avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.surfaceElevated },
    avatarPlaceholder: { backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
    badge: { position: 'absolute', bottom: -2, right: -2, backgroundColor: colors.surface, borderRadius: 10 },
    guideName: { fontSize: FontSize.xs, fontWeight: '600', color: colors.text, marginTop: 6, textAlign: 'center' },
    starRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
    starText: { fontSize: FontSize.xs, color: colors.textSecondary, fontWeight: '600' },
    shopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.borderLight,
    },
    shopText: { flex: 1, minWidth: 0 },
    shopName: { fontSize: FontSize.md, fontWeight: '600', color: colors.text },
    shopMeta: { fontSize: FontSize.xs, color: colors.textTertiary, marginTop: 2 },
  });
}
