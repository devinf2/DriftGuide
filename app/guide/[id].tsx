import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spacing, FontSize, BorderRadius, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import {
  GuideProfileWithProfile,
  GuidePublicStats,
  GuideReviewWithReviewer,
  GuideService,
} from '@/src/types';
import {
  getGuideProfile,
  getGuidePublicStats,
  fetchGuideServices,
  fetchGuideReviews,
  fetchGuideTripHistory,
  fetchGuideWaters,
  requestBooking,
  submitGuideReview,
  verifyGuide,
  type GuideTripSummary,
  type GuideWater,
} from '@/src/services/guideService';
import { confirmOpenExternalUrl, openPhone, openEmail } from '@/src/utils/openDirections';

function priceLabel(cents?: number | null): string | null {
  if (cents == null) return null;
  const dollars = cents / 100;
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}

export default function GuideProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.profile?.is_admin === true);

  const [guide, setGuide] = useState<GuideProfileWithProfile | null>(null);
  const [stats, setStats] = useState<GuidePublicStats>({ avg_rating: 0, review_count: 0, trips_completed: 0 });
  const [services, setServices] = useState<GuideService[]>([]);
  const [reviews, setReviews] = useState<GuideReviewWithReviewer[]>([]);
  const [trips, setTrips] = useState<GuideTripSummary[]>([]);
  const [waters, setWaters] = useState<GuideWater[]>([]);
  const [loading, setLoading] = useState(true);

  // Booking modal
  const [bookingService, setBookingService] = useState<GuideService | null>(null);
  const [bookingDate, setBookingDate] = useState('');
  const [bookingParty, setBookingParty] = useState('');
  const [bookingMessage, setBookingMessage] = useState('');
  const [bookingSubmitting, setBookingSubmitting] = useState(false);

  // Review modal
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [g, s, sv, rv, tp, wt] = await Promise.all([
      getGuideProfile(id),
      getGuidePublicStats(id),
      fetchGuideServices(id),
      fetchGuideReviews(id),
      fetchGuideTripHistory(id),
      fetchGuideWaters(id),
    ]);
    setGuide(g);
    setStats(s);
    setServices(sv);
    setReviews(rv);
    setTrips(tp);
    setWaters(wt);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const isOwner = guide?.profile_id != null && guide.profile_id === user?.id;
  const isVerified = guide?.verified_at != null;

  const submitBooking = useCallback(async () => {
    if (!user || !guide) {
      Alert.alert('Sign in required', 'Sign in to request a booking.');
      return;
    }
    setBookingSubmitting(true);
    try {
      const created = await requestBooking({
        guideId: guide.profile_id,
        requesterId: user.id,
        serviceId: bookingService?.id ?? null,
        requestedDate: bookingDate.trim() || null,
        partySize: bookingParty.trim() ? Number(bookingParty.trim()) : null,
        message: bookingMessage,
      });
      if (created) {
        setBookingService(null);
        setBookingDate('');
        setBookingParty('');
        setBookingMessage('');
        Alert.alert('Request sent', 'The guide has been notified and will reach out to confirm.');
      } else {
        Alert.alert('Could not send', 'Something went wrong. Try again.');
      }
    } finally {
      setBookingSubmitting(false);
    }
  }, [user, guide, bookingService, bookingDate, bookingParty, bookingMessage]);

  const submitReview = useCallback(async () => {
    if (!user || !guide) {
      Alert.alert('Sign in required', 'Sign in to leave a review.');
      return;
    }
    setReviewSubmitting(true);
    try {
      const ok = await submitGuideReview({
        guideId: guide.profile_id,
        reviewerId: user.id,
        rating: reviewRating,
        body: reviewBody,
      });
      if (ok) {
        setReviewOpen(false);
        setReviewBody('');
        setReviewRating(5);
        await load();
      } else {
        Alert.alert('Could not submit', 'Something went wrong. Try again.');
      }
    } finally {
      setReviewSubmitting(false);
    }
  }, [user, guide, reviewRating, reviewBody, load]);

  const handleVerify = useCallback(async () => {
    if (!guide || !user) return;
    const ok = await verifyGuide(guide.profile_id, user.id);
    if (ok) await load();
    else Alert.alert('Could not verify', 'Check that you have admin permissions.');
  }, [guide, user, load]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!guide) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.muted}>This guide isn’t available.</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.back()}>
          <Text style={styles.primaryButtonText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const name = guide.profile?.display_name || 'Guide';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingTop: Spacing.sm }}>
          <Pressable
            style={styles.grabberHitArea}
            onPress={() => router.back()}
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={8}
          >
            <View style={styles.grabber} />
          </Pressable>

          <View style={styles.header}>
            {guide.profile?.avatar_url ? (
              <Image source={{ uri: guide.profile.avatar_url }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Ionicons name="person" size={36} color={colors.textInverse} />
              </View>
            )}
            <View style={styles.nameRow}>
              <Text style={styles.name}>{name}</Text>
              {isVerified ? (
                <MaterialCommunityIcons name="check-decagram" size={20} color={colors.info} />
              ) : null}
            </View>
            {waters.length > 0 ? (
              <Text style={styles.waters} numberOfLines={1}>
                {waters.map((w) => w.name).join(' · ')}
              </Text>
            ) : null}

            {/* Stats */}
            <View style={styles.statsRow}>
              <Stat label="Rating" value={stats.review_count > 0 ? `★ ${stats.avg_rating}` : '—'} sub={`${stats.review_count} review${stats.review_count === 1 ? '' : 's'}`} styles={styles} />
              <Stat label="Trips" value={String(stats.trips_completed)} sub="completed" styles={styles} />
              {typeof guide.years_experience === 'number' ? (
                <Stat
                  label="Experience"
                  value={`${guide.years_experience} yr${guide.years_experience === 1 ? '' : 's'}`}
                  sub="guiding"
                  styles={styles}
                />
              ) : null}
            </View>
          </View>

          <View style={styles.body}>
            {guide.status !== 'approved' && (isOwner || isAdmin) ? (
              <View style={styles.pendingNotice}>
                <Ionicons name="time-outline" size={16} color={colors.warning} />
                <Text style={styles.pendingText}>
                  {guide.status === 'pending'
                    ? 'Pending verification. Your profile is visible to everyone once an admin approves it.'
                    : 'This profile is suspended.'}
                </Text>
              </View>
            ) : null}

            {guide.bio ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>About</Text>
                <Text style={styles.bodyText}>{guide.bio}</Text>
              </View>
            ) : null}

            {/* Contact */}
            <View style={styles.contactRow}>
              {guide.contact_phone ? (
                <ContactButton icon="call-outline" label="Call" onPress={() => openPhone(guide.contact_phone!)} styles={styles} colors={colors} />
              ) : null}
              {guide.contact_email ? (
                <ContactButton icon="mail-outline" label="Email" onPress={() => openEmail(guide.contact_email!)} styles={styles} colors={colors} />
              ) : null}
              {guide.booking_url ? (
                <ContactButton
                  icon="open-outline"
                  label="Book"
                  onPress={() => confirmOpenExternalUrl(guide.booking_url!, `${name}’s booking page`)}
                  styles={styles}
                  colors={colors}
                />
              ) : null}
            </View>

            {/* Offerings */}
            {services.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Offerings</Text>
                {services.filter((s) => s.active || isOwner).map((s) => (
                  <View key={s.id} style={styles.serviceCard}>
                    <Ionicons
                      name={s.offering_type === 'download' ? 'document-text-outline' : 'calendar-outline'}
                      size={20}
                      color={colors.textSecondary}
                    />
                    <View style={styles.serviceInfo}>
                      <Text style={styles.serviceTitle}>{s.title}</Text>
                      <Text style={styles.serviceMeta}>
                        {[
                          s.offering_type === 'download' ? 'Guide book (PDF)' : s.duration_label,
                          priceLabel(s.price_cents),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                      {s.description ? <Text style={styles.serviceDesc}>{s.description}</Text> : null}
                    </View>
                    {!isOwner ? (
                      <Pressable style={styles.requestButton} onPress={() => setBookingService(s)}>
                        <Text style={styles.requestButtonText}>{s.offering_type === 'download' ? 'Get' : 'Request'}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}

            {/* Trip history */}
            {trips.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Trips guided</Text>
                {trips.map((t) => (
                  <Pressable key={t.id} style={styles.tripRow} onPress={() => router.push(`/trip/${t.id}`)}>
                    <Ionicons name="fish" size={16} color={colors.primary} />
                    <View style={styles.tripInfo}>
                      <Text style={styles.tripName}>{t.location_name ?? 'Trip'}</Text>
                      {t.end_time ? <Text style={styles.tripDate}>{new Date(t.end_time).toLocaleDateString()}</Text> : null}
                    </View>
                    {typeof t.total_fish === 'number' ? <Text style={styles.tripFish}>{t.total_fish} 🐟</Text> : null}
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* Reviews */}
            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Reviews</Text>
                {!isOwner ? (
                  <Pressable onPress={() => setReviewOpen(true)} style={styles.linkButton}>
                    <Text style={styles.linkButtonText}>Leave a review</Text>
                  </Pressable>
                ) : null}
              </View>
              {reviews.length === 0 ? (
                <Text style={styles.muted}>No reviews yet.</Text>
              ) : (
                reviews.map((r) => (
                  <View key={r.id} style={styles.reviewCard}>
                    <View style={styles.reviewHeader}>
                      <Text style={styles.reviewName}>{r.reviewer?.display_name ?? 'Angler'}</Text>
                      <Text style={styles.reviewStars}>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</Text>
                    </View>
                    {r.body ? <Text style={styles.reviewBody}>{r.body}</Text> : null}
                  </View>
                ))
              )}
            </View>

            {/* Management */}
            {isOwner ? (
              <Pressable style={styles.editButton} onPress={() => router.push('/guide/edit')}>
                <Ionicons name="create-outline" size={18} color={colors.primary} />
                <Text style={styles.editButtonText}>Edit guide profile</Text>
              </Pressable>
            ) : null}
            {isAdmin && !isVerified ? (
              <Pressable style={styles.verifyButton} onPress={handleVerify}>
                <MaterialCommunityIcons name="check-decagram" size={18} color={colors.textInverse} />
                <Text style={styles.verifyButtonText}>Verify guide (admin)</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>

      {/* Booking modal */}
      <Modal visible={bookingService != null} transparent animationType="fade" onRequestClose={() => setBookingService(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {bookingService?.offering_type === 'download' ? 'Get' : 'Request'}: {bookingService?.title}
            </Text>
            {bookingService?.offering_type === 'booking' ? (
              <>
                <TextInput style={styles.modalInput} placeholder="Preferred date (e.g. Aug 12)" placeholderTextColor={colors.textTertiary} value={bookingDate} onChangeText={setBookingDate} />
                <TextInput style={styles.modalInput} placeholder="Party size" placeholderTextColor={colors.textTertiary} value={bookingParty} onChangeText={setBookingParty} keyboardType="number-pad" />
              </>
            ) : null}
            <TextInput style={[styles.modalInput, styles.modalTextarea]} placeholder="Message (optional)" placeholderTextColor={colors.textTertiary} value={bookingMessage} onChangeText={setBookingMessage} multiline />
            <Text style={styles.modalNote}>
              {bookingService?.offering_type === 'download'
                ? 'Payment & PDF delivery are arranged directly with the guide (Venmo/contact). In‑app purchase is coming later.'
                : 'Payment is arranged directly with the guide (Venmo/contact). Sending this notifies them in the app.'}
            </Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setBookingService(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSubmit} onPress={submitBooking} disabled={bookingSubmitting}>
                {bookingSubmitting ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.modalSubmitText}>Send request</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Review modal */}
      <Modal visible={reviewOpen} transparent animationType="fade" onRequestClose={() => setReviewOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rate {name}</Text>
            <View style={styles.starPicker}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} onPress={() => setReviewRating(n)}>
                  <Ionicons name={n <= reviewRating ? 'star' : 'star-outline'} size={32} color={colors.warning} />
                </Pressable>
              ))}
            </View>
            <TextInput style={[styles.modalInput, styles.modalTextarea]} placeholder="Share how the trip went (optional)" placeholderTextColor={colors.textTertiary} value={reviewBody} onChangeText={setReviewBody} multiline />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setReviewOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSubmit} onPress={submitReview} disabled={reviewSubmitting}>
                {reviewSubmitting ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.modalSubmitText}>Submit</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Stat({ label, value, sub, styles }: { label: string; value: string; sub: string; styles: ReturnType<typeof createStyles> }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statSub}>{sub}</Text>
    </View>
  );
}

function ContactButton({
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
    <Pressable style={styles.contactButton} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={styles.contactButtonText}>{label}</Text>
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    centered: { justifyContent: 'center', alignItems: 'center', gap: Spacing.md },
    muted: { fontSize: FontSize.sm, color: colors.textTertiary },
    grabberHitArea: { alignItems: 'center', paddingVertical: Spacing.sm },
    grabber: { width: 40, height: 5, borderRadius: 2.5, backgroundColor: colors.border },
    header: { alignItems: 'center', paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
    avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.surfaceElevated },
    avatarPlaceholder: { backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center' },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.sm },
    name: {
      fontSize: FontSize.xxl,
      fontWeight: '700',
      color: colors.text,
      fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    },
    waters: { fontSize: FontSize.md, color: colors.textSecondary, marginTop: 4, paddingHorizontal: Spacing.lg, textAlign: 'center' },
    statsRow: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xl, marginTop: Spacing.lg },
    stat: { alignItems: 'center' },
    statValue: { fontSize: FontSize.xl, fontWeight: '700', color: colors.text },
    statLabel: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 2 },
    statSub: { fontSize: FontSize.xs, color: colors.textTertiary },
    body: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
    pendingNotice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      backgroundColor: colors.warning + '18',
      borderRadius: BorderRadius.md,
      padding: Spacing.sm,
      marginTop: Spacing.md,
    },
    pendingText: { flex: 1, fontSize: FontSize.xs, color: colors.textSecondary },
    section: { marginTop: Spacing.xl },
    sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, marginBottom: Spacing.sm },
    bodyText: { fontSize: FontSize.md, color: colors.textSecondary, lineHeight: 22 },
    contactRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg, flexWrap: 'wrap' },
    contactButton: {
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
    contactButtonText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.primary },
    serviceCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    serviceInfo: { flex: 1, minWidth: 0 },
    serviceTitle: { fontSize: FontSize.md, fontWeight: '700', color: colors.text },
    serviceMeta: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 2 },
    serviceDesc: { fontSize: FontSize.sm, color: colors.textTertiary, marginTop: 4 },
    requestButton: { backgroundColor: colors.primary, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
    requestButtonText: { color: colors.textInverse, fontWeight: '700', fontSize: FontSize.sm },
    tripRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderLight },
    tripInfo: { flex: 1, minWidth: 0 },
    tripName: { fontSize: FontSize.md, color: colors.text, fontWeight: '600' },
    tripDate: { fontSize: FontSize.xs, color: colors.textTertiary, marginTop: 2 },
    tripFish: { fontSize: FontSize.sm, color: colors.textSecondary },
    linkButton: { paddingVertical: 4 },
    linkButtonText: { fontSize: FontSize.sm, fontWeight: '600', color: colors.primary },
    reviewCard: { backgroundColor: colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
    reviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    reviewName: { fontSize: FontSize.md, fontWeight: '600', color: colors.text },
    reviewStars: { fontSize: FontSize.sm, color: colors.warning },
    reviewBody: { fontSize: FontSize.sm, color: colors.textSecondary, marginTop: 4, lineHeight: 20 },
    editButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: Spacing.xl,
    },
    editButtonText: { color: colors.primary, fontSize: FontSize.md, fontWeight: '600' },
    verifyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.md,
      paddingVertical: Spacing.md,
      marginTop: Spacing.sm,
    },
    verifyButtonText: { color: colors.textInverse, fontSize: FontSize.md, fontWeight: '700' },
    primaryButton: { backgroundColor: colors.primary, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
    primaryButtonText: { color: colors.textInverse, fontWeight: '700' },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: Spacing.lg },
    modalCard: { backgroundColor: colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.lg },
    modalTitle: { fontSize: FontSize.lg, fontWeight: '700', color: colors.text, marginBottom: Spacing.md },
    modalInput: {
      backgroundColor: colors.background,
      borderRadius: BorderRadius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: Spacing.sm,
    },
    modalTextarea: { minHeight: 80, textAlignVertical: 'top' },
    modalNote: { fontSize: FontSize.xs, color: colors.textTertiary, lineHeight: 16, marginBottom: Spacing.xs },
    starPicker: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xs, marginBottom: Spacing.md },
    modalActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
    modalCancel: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: colors.border },
    modalCancelText: { fontSize: FontSize.md, fontWeight: '600', color: colors.textSecondary },
    modalSubmit: { flex: 1, alignItems: 'center', paddingVertical: Spacing.md, borderRadius: BorderRadius.md, backgroundColor: colors.primary },
    modalSubmitText: { fontSize: FontSize.md, fontWeight: '700', color: colors.textInverse },
  });
}
