import { supabase } from './supabase';
import {
  GuideBooking,
  GuideBookingStatus,
  GuideProfile,
  GuideProfileWithProfile,
  GuidePublicStats,
  GuideReviewWithReviewer,
  GuideService,
} from '@/src/types';

/**
 * Guide / Pro marketplace data layer. Bookings are contact-based (no in-app
 * payment); reviews are primarily seeded from completed trips attributed to the
 * guide (trips.guide_id). Verification is admin-only (see guideService.verifyGuide).
 */

// --- Guide profile ---

export async function getGuideProfile(profileId: string): Promise<GuideProfileWithProfile | null> {
  const { data, error } = await supabase
    .from('guide_profiles')
    .select('*, profile:profiles!guide_profiles_profile_id_fkey(id, display_name, avatar_url, username)')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) {
    console.warn('[getGuideProfile] failed', { profileId, error });
    return null;
  }
  return (data as GuideProfileWithProfile) ?? null;
}

export type GuideProfileInput = Partial<
  Pick<
    GuideProfile,
    'bio' | 'home_water' | 'years_experience' | 'contact_email' | 'contact_phone' | 'booking_url' | 'rates'
  >
>;

/** Create or update the signed-in user's guide profile. Status stays admin-controlled by triggers. */
export async function upsertGuideProfile(profileId: string, input: GuideProfileInput): Promise<GuideProfile | null> {
  const { data, error } = await supabase
    .from('guide_profiles')
    .upsert({ profile_id: profileId, ...input }, { onConflict: 'profile_id' })
    .select()
    .single();
  if (error) {
    console.error('[upsertGuideProfile] failed', { profileId, error });
    return null;
  }
  return data as GuideProfile;
}

// --- Waters guided (guide_waters: the "Waters I guide" multi-select) ---

export type GuideWater = { id: string; name: string };

/** The waters a guide has declared they run (independent of offerings). */
export async function fetchGuideWaters(guideId: string): Promise<GuideWater[]> {
  const { data, error } = await supabase
    .from('guide_waters')
    .select('location:locations!inner(id, name)')
    .eq('guide_id', guideId);
  if (error) {
    console.warn('[fetchGuideWaters] failed', { guideId, error });
    return [];
  }
  return ((data as Array<Record<string, unknown>>) ?? [])
    .map((r) => r.location as GuideWater | null)
    .filter((w): w is GuideWater => w != null && !!w.id);
}

/** Replace the guide's full set of waters with `locationIds` (drop-all then insert). */
export async function setGuideWaters(guideId: string, locationIds: string[]): Promise<boolean> {
  const ids = [...new Set(locationIds.filter(Boolean))];
  const { error: delErr } = await supabase.from('guide_waters').delete().eq('guide_id', guideId);
  if (delErr) {
    console.error('[setGuideWaters] delete failed', { guideId, error: delErr });
    return false;
  }
  if (ids.length === 0) return true;
  const { error: insErr } = await supabase
    .from('guide_waters')
    .insert(ids.map((location_id) => ({ guide_id: guideId, location_id })));
  if (insErr) {
    console.error('[setGuideWaters] insert failed', { guideId, error: insErr });
    return false;
  }
  return true;
}

/**
 * Admin-only: guide profiles awaiting review (status 'pending'). RLS returns
 * pending rows only to admins (and the owner), so a non-admin caller gets just
 * their own — the home bell that consumes this is already admin-gated. Powers
 * the "new guide to review" notification list.
 */
export async function fetchPendingGuides(): Promise<GuideProfileWithProfile[]> {
  const { data, error } = await supabase
    .from('guide_profiles')
    .select('*, profile:profiles!guide_profiles_profile_id_fkey(id, display_name, avatar_url, username)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[fetchPendingGuides] failed', error);
    return [];
  }
  return (data as GuideProfileWithProfile[]) ?? [];
}

/** Admin-only: approve + verify a guide (checkmark). RLS + trigger enforce admin. */
export async function verifyGuide(profileId: string, adminId: string): Promise<boolean> {
  const { error } = await supabase
    .from('guide_profiles')
    .update({ status: 'approved', verified_at: new Date().toISOString(), verified_by: adminId })
    .eq('profile_id', profileId);
  if (error) {
    console.error('[verifyGuide] failed', { profileId, error });
    return false;
  }
  return true;
}

export async function getGuidePublicStats(guideId: string): Promise<GuidePublicStats> {
  const { data, error } = await supabase.rpc('guide_public_stats', { p_guide_id: guideId });
  if (error || !data?.[0]) {
    if (error) console.warn('[getGuidePublicStats] failed', { guideId, error });
    return { avg_rating: 0, review_count: 0, trips_completed: 0 };
  }
  const row = data[0] as GuidePublicStats;
  return {
    avg_rating: Number(row.avg_rating) || 0,
    review_count: Number(row.review_count) || 0,
    trips_completed: Number(row.trips_completed) || 0,
  };
}

// --- Services ---

export async function fetchGuideServices(guideId: string): Promise<GuideService[]> {
  const { data, error } = await supabase
    .from('guide_services')
    .select('*')
    .eq('guide_id', guideId)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[fetchGuideServices] failed', { guideId, error });
    return [];
  }
  return (data as GuideService[]) ?? [];
}

export type GuideServiceInput = Pick<
  GuideService,
  | 'offering_type'
  | 'title'
  | 'location_id'
  | 'price_cents'
  | 'duration_label'
  | 'description'
  | 'quantity_available'
  | 'active'
>;

export async function addGuideService(guideId: string, input: GuideServiceInput): Promise<GuideService | null> {
  const { data, error } = await supabase
    .from('guide_services')
    .insert({ guide_id: guideId, ...input })
    .select()
    .single();
  if (error) {
    console.error('[addGuideService] failed', { guideId, error });
    return null;
  }
  return data as GuideService;
}

export async function updateGuideService(id: string, patch: Partial<GuideServiceInput>): Promise<boolean> {
  const { error } = await supabase.from('guide_services').update(patch).eq('id', id);
  if (error) {
    console.error('[updateGuideService] failed', { id, error });
    return false;
  }
  return true;
}

export async function deleteGuideService(id: string): Promise<boolean> {
  const { error } = await supabase.from('guide_services').delete().eq('id', id);
  if (error) {
    console.error('[deleteGuideService] failed', { id, error });
    return false;
  }
  return true;
}

// --- Bookings (inquiries) ---

export interface BookingRequestInput {
  guideId: string;
  requesterId: string;
  serviceId?: string | null;
  requestedDate?: string | null;
  partySize?: number | null;
  message?: string | null;
}

export async function requestBooking(input: BookingRequestInput): Promise<GuideBooking | null> {
  const { data, error } = await supabase
    .from('guide_bookings')
    .insert({
      guide_id: input.guideId,
      requester_id: input.requesterId,
      service_id: input.serviceId ?? null,
      requested_date: input.requestedDate ?? null,
      party_size: input.partySize ?? null,
      message: input.message?.trim() || null,
      status: 'requested',
    })
    .select()
    .single();
  if (error) {
    console.error('[requestBooking] failed', { guideId: input.guideId, error });
    return null;
  }
  return data as GuideBooking;
}

export async function fetchGuideBookings(guideId: string): Promise<GuideBooking[]> {
  const { data, error } = await supabase
    .from('guide_bookings')
    .select('*')
    .eq('guide_id', guideId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[fetchGuideBookings] failed', { guideId, error });
    return [];
  }
  return (data as GuideBooking[]) ?? [];
}

export async function updateBookingStatus(id: string, status: GuideBookingStatus): Promise<boolean> {
  const { error } = await supabase.from('guide_bookings').update({ status }).eq('id', id);
  if (error) {
    console.error('[updateBookingStatus] failed', { id, status, error });
    return false;
  }
  return true;
}

// --- Reviews ---

export async function fetchGuideReviews(guideId: string): Promise<GuideReviewWithReviewer[]> {
  const { data, error } = await supabase
    .from('guide_reviews')
    .select('*, reviewer:profiles!guide_reviews_reviewer_id_fkey(id, display_name, avatar_url)')
    .eq('guide_id', guideId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[fetchGuideReviews] failed', { guideId, error });
    return [];
  }
  return (data as GuideReviewWithReviewer[]) ?? [];
}

export interface GuideReviewInput {
  guideId: string;
  reviewerId: string;
  tripId?: string | null;
  rating: number;
  body?: string | null;
}

export async function submitGuideReview(input: GuideReviewInput): Promise<boolean> {
  const { error } = await supabase.from('guide_reviews').insert({
    guide_id: input.guideId,
    reviewer_id: input.reviewerId,
    trip_id: input.tripId ?? null,
    rating: input.rating,
    body: input.body?.trim() || null,
  });
  if (error) {
    console.error('[submitGuideReview] failed', { guideId: input.guideId, error });
    return false;
  }
  return true;
}

// --- Trip history (trips this guide has run) ---

export interface GuideTripSummary {
  id: string;
  location_id: string | null;
  location_name: string | null;
  start_time: string | null;
  end_time: string | null;
  total_fish: number | null;
  rating: number | null;
}

/** Completed trips attributed to the guide (public trips are visible to everyone via RLS). */
export async function fetchGuideTripHistory(guideId: string): Promise<GuideTripSummary[]> {
  const { data, error } = await supabase
    .from('trips')
    .select('id, location_id, start_time, end_time, total_fish, rating, location:locations!trips_location_id_fkey(name)')
    .eq('guide_id', guideId)
    .eq('status', 'completed')
    .is('deleted_at', null)
    .order('end_time', { ascending: false })
    .limit(50);
  if (error) {
    console.warn('[fetchGuideTripHistory] failed', { guideId, error });
    return [];
  }
  return ((data as Array<Record<string, unknown>>) ?? []).map((r) => ({
    id: r.id as string,
    location_id: (r.location_id as string) ?? null,
    location_name: ((r.location as { name?: string } | null)?.name as string) ?? null,
    start_time: (r.start_time as string) ?? null,
    end_time: (r.end_time as string) ?? null,
    total_fish: (r.total_fish as number) ?? null,
    rating: (r.rating as number) ?? null,
  }));
}

// --- Guides for a location (Report "Find a guide") ---

export interface GuideLocationCard {
  profileId: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  avgRating: number;
  reviewCount: number;
}

/**
 * Approved guides discoverable on this water, enriched with rating and sorted
 * best-rated first. For the Report's "Find a guide". A guide surfaces here if
 * they either declared the water (guide_waters) or tagged an active offering to
 * it (guide_services.location_id) — the two sources are unioned.
 * Pass the related water ids (self + parent + sections) so a guide tied to the
 * river shows on its sections and vice versa.
 */
export async function fetchGuidesForLocation(
  locationIds: string | string[],
): Promise<GuideLocationCard[]> {
  const ids = (Array.isArray(locationIds) ? locationIds : [locationIds]).filter(Boolean);
  if (ids.length === 0) return [];

  const guideJoin =
    'guide:guide_profiles!inner(profile_id, status, verified_at, profile:profiles!guide_profiles_profile_id_fkey(id, display_name, avatar_url))';

  const [servicesRes, watersRes] = await Promise.all([
    supabase
      .from('guide_services')
      .select(`guide_id, ${guideJoin}`)
      .in('location_id', ids)
      .eq('active', true)
      .eq('guide.status', 'approved'),
    supabase
      .from('guide_waters')
      .select(guideJoin)
      .in('location_id', ids)
      .eq('guide.status', 'approved'),
  ]);

  if (servicesRes.error) console.warn('[fetchGuidesForLocation] services failed', { ids, error: servicesRes.error });
  if (watersRes.error) console.warn('[fetchGuidesForLocation] waters failed', { ids, error: watersRes.error });

  // Dedupe guides across both sources (offering-tagged + declared water).
  const byId = new Map<string, { verified: boolean; displayName: string; avatarUrl: string | null }>();
  const ingest = (rows: Array<Record<string, unknown>> | null) => {
    for (const row of rows ?? []) {
      const g = row.guide as
        | { profile_id: string; verified_at: string | null; profile: { display_name?: string; avatar_url?: string | null } | null }
        | null;
      if (!g?.profile_id || byId.has(g.profile_id)) continue;
      byId.set(g.profile_id, {
        verified: g.verified_at != null,
        displayName: g.profile?.display_name ?? 'Guide',
        avatarUrl: g.profile?.avatar_url ?? null,
      });
    }
  };
  ingest(servicesRes.data as Array<Record<string, unknown>> | null);
  ingest(watersRes.data as Array<Record<string, unknown>> | null);

  const guideIds = [...byId.keys()];
  const stats = await Promise.all(guideIds.map((id) => getGuidePublicStats(id)));
  const cards: GuideLocationCard[] = guideIds.map((id, i) => ({
    profileId: id,
    displayName: byId.get(id)!.displayName,
    avatarUrl: byId.get(id)!.avatarUrl,
    verified: byId.get(id)!.verified,
    avgRating: stats[i].avg_rating,
    reviewCount: stats[i].review_count,
  }));

  // Best-rated first; ties fall back to review volume.
  cards.sort((a, b) => b.avgRating - a.avgRating || b.reviewCount - a.reviewCount);
  return cards;
}
