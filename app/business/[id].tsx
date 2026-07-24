import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { Business, BusinessCategory, BusinessPhoto } from '@/src/types';
import {
  fetchBusinessPhotos,
  getBusinessById,
  addBusinessPhoto,
  softDeleteBusiness,
  setBusinessStatus,
} from '@/src/services/businessService';
import { useBusinessStore } from '@/src/stores/businessStore';
import { fetchDealForBusiness, dealCtaUrl } from '@/src/services/promotionService';
import {
  confirmDrivingDirections,
  confirmOpenExternalUrl,
  openPhone,
  openEmail,
} from '@/src/utils/openDirections';

const CATEGORY_LABEL: Record<BusinessCategory, string> = {
  fly_shop: 'Fly shop',
  outfitter: 'Outfitter',
  lodge: 'Lodge',
  guide_service: 'Guide service',
  other: 'Business',
};

const DAY_LABELS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

export default function BusinessDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.profile?.is_admin === true);
  const upsertBusiness = useBusinessStore((s) => s.upsert);
  const refreshBusinesses = useBusinessStore((s) => s.fetchAll);

  const [business, setBusiness] = useState<Business | null>(null);
  const [photos, setPhotos] = useState<BusinessPhoto[]>([]);
  const [deal, setDeal] = useState<Awaited<ReturnType<typeof fetchDealForBusiness>>>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [b, ph, d] = await Promise.all([
      getBusinessById(id),
      fetchBusinessPhotos(id),
      fetchDealForBusiness(id),
    ]);
    setBusiness(b);
    setPhotos(ph);
    setDeal(d);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = business?.created_by != null && business.created_by === user?.id;
  const canManage = isOwner || isAdmin;

  const addPhoto = useCallback(async () => {
    if (!business || !user) return;
    const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!lib.granted) {
      Alert.alert('Photos', 'Photo library access is needed to add a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]?.uri) return;
    setUploading(true);
    try {
      const created = await addBusinessPhoto(business.id, user.id, result.assets[0].uri, photos.length);
      if (created) setPhotos((prev) => [...prev, created]);
      else Alert.alert('Upload failed', 'Could not add the photo. Try again.');
    } catch {
      Alert.alert('Upload failed', 'Something went wrong uploading the photo.');
    } finally {
      setUploading(false);
    }
  }, [business, user, photos.length]);

  const handleVerify = useCallback(async () => {
    if (!business) return;
    const ok = await setBusinessStatus(business.id, 'verified');
    if (ok) {
      const updated = { ...business, status: 'verified' as const };
      setBusiness(updated);
      upsertBusiness(updated);
      void refreshBusinesses();
    } else {
      Alert.alert('Could not verify', 'Check that you have admin permissions.');
    }
  }, [business, upsertBusiness, refreshBusinesses]);

  const handleDelete = useCallback(() => {
    if (!business || !user) return;
    Alert.alert('Delete business', `Remove "${business.name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const ok = await softDeleteBusiness(business.id, user.id);
            if (ok) {
              void refreshBusinesses();
              router.back();
            } else {
              Alert.alert('Could not delete', 'Try again with a stable connection.');
            }
          })();
        },
      },
    ]);
  }, [business, user, refreshBusinesses, router]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!business) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.notFound}>This business isn’t available.</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.back()}>
          <Text style={styles.primaryButtonText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const hoursEntries = business.hours
    ? DAY_LABELS.map((d) => ({ label: d.label, value: business.hours?.[d.key as keyof typeof business.hours] }))
    : [];
  const hasHours = hoursEntries.some((h) => h.value != null);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }} showsVerticalScrollIndicator={false}>
        {/* Cover */}
        <View style={styles.cover}>
          {business.cover_url ? (
            <Image source={{ uri: business.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.coverPlaceholder]}>
              <Ionicons name="storefront" size={48} color={colors.textInverse} />
            </View>
          )}
          <View style={styles.grabber} />
        </View>

        <View style={styles.body}>
          {/* Header row */}
          <View style={styles.headerRow}>
            {business.logo_url ? (
              <Image source={{ uri: business.logo_url }} style={styles.logo} contentFit="cover" />
            ) : null}
            <View style={styles.headerText}>
              <Text style={styles.name}>{business.name}</Text>
              <View style={styles.metaRow}>
                <Text style={styles.category}>{CATEGORY_LABEL[business.category]}</Text>
                <StatusBadge status={business.status} styles={styles} colors={colors} />
              </View>
              {business.address ? <Text style={styles.address}>{business.address}</Text> : null}
            </View>
          </View>

          {/* Pending notice (owner sees why it isn't public yet) */}
          {business.status === 'pending' ? (
            <View style={styles.pendingNotice}>
              <Ionicons name="time-outline" size={16} color={colors.warning} />
              <Text style={styles.pendingNoticeText}>
                Pending review. It’ll appear for everyone once a moderator approves it.
              </Text>
            </View>
          ) : null}

          {/* Actions */}
          <View style={styles.actionsRow}>
            {business.website_url ? (
              <ActionButton
                icon="globe-outline"
                label="Website"
                onPress={() => confirmOpenExternalUrl(business.website_url!, `${business.name}’s website`)}
                styles={styles}
                colors={colors}
              />
            ) : null}
            {business.phone ? (
              <ActionButton icon="call-outline" label="Call" onPress={() => openPhone(business.phone!)} styles={styles} colors={colors} />
            ) : null}
            <ActionButton
              icon="navigate-outline"
              label="Directions"
              onPress={() => confirmDrivingDirections(business.latitude, business.longitude, business.name)}
              styles={styles}
              colors={colors}
            />
            {business.email ? (
              <ActionButton icon="mail-outline" label="Email" onPress={() => openEmail(business.email!)} styles={styles} colors={colors} />
            ) : null}
          </View>

          {/* Partner deal banner */}
          {deal ? (
            <Pressable
              style={styles.dealBanner}
              onPress={() => {
                const url = dealCtaUrl(deal);
                if (url) confirmOpenExternalUrl(url, deal.partner?.name ? `${deal.partner.name}` : 'the partner community');
              }}
              disabled={!dealCtaUrl(deal)}
              accessibilityRole="button"
              accessibilityLabel={`Partner deal: ${deal.title}`}
            >
              <MaterialCommunityIcons name="tag-heart" size={22} color={colors.textInverse} />
              <View style={styles.dealTextCol}>
                {deal.partner?.name ? <Text style={styles.dealPartner}>{deal.partner.name}</Text> : null}
                <Text style={styles.dealTitle}>{deal.title}</Text>
                {deal.detail ? <Text style={styles.dealDetail}>{deal.detail}</Text> : null}
              </View>
              {dealCtaUrl(deal) ? <Ionicons name="arrow-forward" size={18} color={colors.textInverse} /> : null}
            </Pressable>
          ) : null}

          {/* Description */}
          {business.description ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>About</Text>
              <Text style={styles.description}>{business.description}</Text>
            </View>
          ) : null}

          {/* Hours */}
          {hasHours ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Hours</Text>
              {hoursEntries.map((h) => (
                <View key={h.label} style={styles.hoursRow}>
                  <Text style={styles.hoursDay}>{h.label}</Text>
                  <Text style={styles.hoursValue}>{h.value ? `${h.value.open} – ${h.value.close}` : 'Closed'}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* Photos */}
          {photos.length > 0 || canManage ? (
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Photos</Text>
                {canManage ? (
                  <Pressable onPress={addPhoto} disabled={uploading} style={styles.addPhotoButton}>
                    {uploading ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <>
                        <Ionicons name="add" size={16} color={colors.primary} />
                        <Text style={styles.addPhotoText}>Add</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
              </View>
              {photos.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.galleryContent}>
                  {photos.map((p) => (
                    <Image key={p.id} source={{ uri: p.photo_url }} style={styles.galleryImage} contentFit="cover" />
                  ))}
                </ScrollView>
              ) : (
                <Text style={styles.emptyPhotos}>No photos yet. Add the first one.</Text>
              )}
            </View>
          ) : null}

          {/* Management (admin only) */}
          {isAdmin ? (
            <View style={styles.section}>
              {business.status !== 'verified' ? (
                <Pressable style={styles.verifyButton} onPress={handleVerify}>
                  <MaterialCommunityIcons name="check-decagram" size={18} color={colors.textInverse} />
                  <Text style={styles.verifyButtonText}>Verify (admin)</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.deleteButton} onPress={handleDelete}>
                <Ionicons name="trash-outline" size={18} color={colors.error} />
                <Text style={styles.deleteButtonText}>Delete business</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function StatusBadge({
  status,
  styles,
  colors,
}: {
  status: Business['status'];
  styles: ReturnType<typeof createStyles>;
  colors: ThemeColors;
}) {
  if (status === 'verified') {
    return (
      <View style={[styles.badge, { backgroundColor: colors.success + '22' }]}>
        <MaterialCommunityIcons name="check-decagram" size={12} color={colors.success} />
        <Text style={[styles.badgeText, { color: colors.success }]}>Verified</Text>
      </View>
    );
  }
  if (status === 'pending') {
    return (
      <View style={[styles.badge, { backgroundColor: colors.warning + '22' }]}>
        <Text style={[styles.badgeText, { color: colors.warning }]}>Pending</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, { backgroundColor: colors.info + '22' }]}>
      <Text style={[styles.badgeText, { color: colors.info }]}>Community</Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  styles,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
  colors: ThemeColors;
}) {
  return (
    <Pressable style={styles.actionButton} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={styles.actionButtonText}>{label}</Text>
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { justifyContent: 'center', alignItems: 'center', gap: Spacing.md },
    notFound: { fontSize: FontSize.md, color: colors.textSecondary },
    cover: { height: 180, backgroundColor: colors.surfaceElevated },
    coverPlaceholder: { backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
    grabber: {
      position: 'absolute',
      top: Spacing.sm,
      alignSelf: 'center',
      width: 40,
      height: 5,
      borderRadius: 3,
      backgroundColor: 'rgba(255,255,255,0.6)',
    },
    body: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
    headerRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
    logo: { width: 56, height: 56, borderRadius: BorderRadius.md, backgroundColor: colors.surfaceElevated },
    headerText: { flex: 1, minWidth: 0 },
    name: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 4, flexWrap: 'wrap' },
    category: { fontSize: FontSize.sm, color: colors.textSecondary, fontWeight: '600' },
    address: { fontSize: FontSize.sm, color: colors.textTertiary, marginTop: 4 },
    badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: BorderRadius.full },
    badgeText: { fontSize: FontSize.xs, fontWeight: '700' },
    pendingNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      backgroundColor: colors.warning + '18',
      borderRadius: BorderRadius.md,
      padding: Spacing.sm,
      marginTop: Spacing.md,
    },
    pendingNoticeText: { flex: 1, fontSize: FontSize.xs, color: colors.textSecondary },
    dealBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      backgroundColor: colors.secondary,
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
      marginTop: Spacing.lg,
    },
    dealTextCol: { flex: 1, minWidth: 0 },
    dealPartner: { fontSize: FontSize.xs, fontWeight: '700', color: colors.textInverse, opacity: 0.9, textTransform: 'uppercase', letterSpacing: 0.4 },
    dealTitle: { fontSize: FontSize.md, fontWeight: '700', color: colors.textInverse, marginTop: 2 },
    dealDetail: { fontSize: FontSize.sm, color: colors.textInverse, opacity: 0.92, marginTop: 2 },
    actionsRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg, flexWrap: 'wrap' },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    actionButtonText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.primary },
    section: { marginTop: Spacing.xl },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, marginBottom: Spacing.sm },
    description: { fontSize: FontSize.md, color: colors.textSecondary, lineHeight: 22 },
    hoursRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
    hoursDay: { fontSize: FontSize.sm, color: colors.textSecondary, fontWeight: '600' },
    hoursValue: { fontSize: FontSize.sm, color: colors.text },
    addPhotoButton: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4, paddingHorizontal: 6 },
    addPhotoText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.primary },
    galleryContent: { gap: Spacing.sm, paddingVertical: Spacing.xs },
    galleryImage: { width: 160, height: 120, borderRadius: BorderRadius.md, backgroundColor: colors.surfaceElevated },
    emptyPhotos: { fontSize: FontSize.sm, color: colors.textTertiary },
    verifyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
      marginBottom: Spacing.sm,
    },
    verifyButtonText: { color: colors.textInverse, fontSize: FontSize.md, fontWeight: '700' },
    deleteButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
      borderWidth: 1,
      borderColor: colors.error,
    },
    deleteButtonText: { color: colors.error, fontSize: FontSize.md, fontWeight: '600' },
    primaryButton: { backgroundColor: colors.primary, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
    primaryButtonText: { color: colors.textInverse, fontWeight: '700' },
  });
}
