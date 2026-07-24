import { supabase } from './supabase';
import {
  Business,
  BusinessDeal,
  FeaturedBusinessCard,
  Partner,
  Promotion,
  PromotionPlacement,
} from '@/src/types';

/**
 * Partner deals + promotions reads. Writes are admin-only (RLS) and, for v1,
 * done via the Supabase dashboard/SQL — this service only reads for the app.
 */

type DealWithRelations = BusinessDeal & {
  partner?: Pick<Partner, 'name' | 'community_url'> | null;
  business?: Pick<Business, 'id' | 'name' | 'category' | 'logo_url' | 'cover_url'> | null;
};

/** The active deal for a business (most recent), or null. RLS already filters to active + in-window. */
export async function fetchDealForBusiness(businessId: string): Promise<DealWithRelations | null> {
  const { data, error } = await supabase
    .from('business_deals')
    .select('*, partner:partners(name, community_url)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[fetchDealForBusiness] failed', { businessId, error });
    return null;
  }
  return (data as DealWithRelations) ?? null;
}

/** The effective CTA URL for a deal: explicit cta_url, else the partner's community link. */
export function dealCtaUrl(deal: DealWithRelations | null): string | null {
  if (!deal) return null;
  return deal.cta_url?.trim() || deal.partner?.community_url?.trim() || null;
}

/**
 * Resolve active home-rail promotions into displayable cards, preserving priority
 * order. Handles `business` and `deal` subjects; `guide` subjects (Phase 3) are
 * skipped here until the guide profile screen exists.
 */
export async function fetchHomeFeaturedBusinesses(
  placement: PromotionPlacement = 'home_featured',
): Promise<FeaturedBusinessCard[]> {
  const { data: promos, error } = await supabase
    .from('promotions')
    .select('*')
    .eq('placement', placement)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('[fetchHomeFeaturedBusinesses] promotions failed', error);
    return [];
  }

  const promotions = (promos as Promotion[]) ?? [];
  const businessPromos = promotions.filter((p) => p.subject_type === 'business');
  const dealPromos = promotions.filter((p) => p.subject_type === 'deal');

  const businessIds = businessPromos.map((p) => p.subject_id);
  const dealIds = dealPromos.map((p) => p.subject_id);

  const [businessesById, dealsById] = await Promise.all([
    fetchBusinessesByIds(businessIds),
    fetchDealsByIds(dealIds),
  ]);

  const cards: FeaturedBusinessCard[] = [];
  for (const promo of promotions) {
    if (promo.subject_type === 'business') {
      const b = businessesById.get(promo.subject_id);
      if (!b) continue; // hidden by RLS (e.g. not verified) or deleted
      cards.push({
        promotionId: promo.id,
        businessId: b.id,
        businessName: b.name,
        category: b.category,
        logoUrl: b.logo_url,
        coverUrl: b.cover_url,
      });
    } else if (promo.subject_type === 'deal') {
      const d = dealsById.get(promo.subject_id);
      if (!d?.business) continue;
      cards.push({
        promotionId: promo.id,
        businessId: d.business.id,
        businessName: d.business.name,
        category: d.business.category,
        logoUrl: d.business.logo_url,
        coverUrl: d.business.cover_url,
        dealTitle: d.title,
        ctaUrl: dealCtaUrl(d),
        partnerName: d.partner?.name ?? null,
      });
    }
  }
  return cards;
}

async function fetchBusinessesByIds(ids: string[]): Promise<Map<string, Business>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from('businesses').select('*').in('id', ids).is('deleted_at', null);
  if (error) {
    console.warn('[fetchBusinessesByIds] failed', error);
    return new Map();
  }
  return new Map((data as Business[]).map((b) => [b.id, b]));
}

async function fetchDealsByIds(ids: string[]): Promise<Map<string, DealWithRelations>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('business_deals')
    .select('*, partner:partners(name, community_url), business:businesses(id, name, category, logo_url, cover_url)')
    .in('id', ids);
  if (error) {
    console.warn('[fetchDealsByIds] failed', error);
    return new Map();
  }
  return new Map((data as DealWithRelations[]).map((d) => [d.id, d]));
}
