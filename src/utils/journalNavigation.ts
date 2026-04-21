import { router, type Href } from 'expo-router';

/**
 * Shared stack identity for all journal trip detail screens. Without this, opening
 * trip B after trip A (especially when A was left under the journal tab while another
 * tab is shown) leaves A on the stack and iOS swipe-back returns to A instead of the
 * trips list.
 */
const JOURNAL_TRIP_DETAIL_SINGULAR = 'journal-trip-detail';

/** Push a `/journal/:id` route while collapsing any prior journal trip screen in the stack. */
export function pushJournalTripDetail(href: Href) {
  router.push(href, {
    dangerouslySingular: () => JOURNAL_TRIP_DETAIL_SINGULAR,
  });
}
