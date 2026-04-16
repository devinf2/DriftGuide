import {
  DRIFTGUIDE_HATCH_CHART_ENTRIES,
  hatchActivityForMonth,
  type MonthActivity,
} from '@/src/data/driftGuideHatchChart';
import type { HatchBriefRow } from '@/src/services/ai';
import { format } from 'date-fns';

const HATCH_MODAL_FALLBACK =
  'No calendar match for this name—open the hatch calendar or watch the water.';

function monthTag(monthName: string, level: MonthActivity): string {
  if (level >= 3) return `${monthName}: prime`;
  if (level === 2) return `${monthName}: solid`;
  if (level === 1) return `${monthName}: thin`;
  return `${monthName}: quiet`;
}

/**
 * Map a free-text briefing insect name to a hatch-calendar entry id.
 * Order matters: more specific rules first.
 */
export function resolveInsectToChartId(insect: string): string | null {
  const n = insect.toLowerCase().trim();
  if (!n) return null;
  if (n.includes('october') && n.includes('caddis')) return 'oct-caddis';
  if (n.includes('trico')) return 'trico';
  if (n.includes('callibaetis')) return 'callibaetis';
  if (n.includes('mahogany')) return 'mahogany';
  if (n.includes('march brown') || n.includes('gray drake')) return 'march-brown';
  if (n.includes('skwala')) return 'skwala';
  if (n.includes('salmonfly') || n.includes('pteronarcys')) return 'salmonfly';
  if (n.includes('golden') || n.includes('sally') || n.includes('yellow sally')) return 'golden';
  if (n.includes('green drake') || /\bflav\b/.test(n)) return 'green-drake';
  if (n.includes('pmd') || n.includes('pale morning')) return 'pmd';
  if (
    n.includes('hopper') ||
    n.includes('terrest') ||
    /\bant\b/.test(n) ||
    n.includes('beetle') ||
    n.includes('grasshopper')
  ) {
    return 'terrestrial';
  }
  if (n.includes('caddis') || n.includes('sedge')) return 'caddis';
  if (n.includes('baetis') || n.includes('bwo') || (n.includes('blue') && n.includes('wing')) || (n.includes('blue') && n.includes('olive'))) {
    return 'bwo';
  }
  if (n.includes('midge')) return 'midge';
  return null;
}

export type HatchModalDetailSource = 'api' | 'calendar' | 'none';

const API_DETAIL_MAX_CHARS = 380;

export function getHatchModalDetailCopy(row: HatchBriefRow): { text: string; source: HatchModalDetailSource } {
  let api = row.detail?.trim();
  if (api) {
    if (api.length > API_DETAIL_MAX_CHARS) {
      api = `${api.slice(0, API_DETAIL_MAX_CHARS).trimEnd()}…`;
    }
    return { text: api, source: 'api' };
  }

  const chartId = resolveInsectToChartId(row.insect);
  const entry = chartId ? DRIFTGUIDE_HATCH_CHART_ENTRIES.find((e) => e.id === chartId) : undefined;
  if (!entry) {
    return { text: HATCH_MODAL_FALLBACK, source: 'none' };
  }

  const m0 = new Date().getMonth();
  const monthName = format(new Date(2024, m0, 1), 'MMMM');
  const lvl = hatchActivityForMonth(entry, m0);
  const mTag = monthTag(monthName, lvl);

  // Sizes already shown above the modal body; keep one tight block: timing + where + tip.
  const text = `${entry.peakSummary} ${mTag} on the chart. ${entry.water}. ${entry.tip}`;

  return { text, source: 'calendar' };
}
