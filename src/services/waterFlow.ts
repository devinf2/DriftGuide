import { WaterFlowData, WaterClarity, WeatherData, FlowStatus, FlowStatusInfo } from '@/src/types';

const MOCK_WATER_FLOW: WaterFlowData = {
  station_id: '10163000',
  station_name: 'Provo River',
  flow_cfs: 185,
  water_temp_f: 48,
  gage_height_ft: 2.1,
  turbidity_ntu: 5,
  clarity: 'clear',
  clarity_source: 'mock',
  timestamp: new Date().toISOString(),
};

/**
 * USGS parameter codes:
 * 00060 = Streamflow (CFS)
 * 00010 = Water temperature (°C)
 * 00065 = Gage height (ft)
 * 63680 = Turbidity (NTU)
 */
const PARAM_CODES = '00060,00010,00065,63680';

function turbidityToClarity(ntu: number): WaterClarity {
  if (ntu < 10) return 'clear';
  if (ntu < 25) return 'slightly_stained';
  if (ntu < 75) return 'stained';
  if (ntu < 200) return 'murky';
  return 'blown_out';
}

/**
 * Estimates water clarity from weather, flow, baseline flow, and optional season.
 * Used when sensor (turbidity) data is unavailable. Factors: rain/storm, humidity,
 * flow vs baseline (runoff), and spring runoff.
 */
export function inferClarityFromWeather(
  weather: WeatherData | null,
  flowCfs: number,
  baselineFlowCfs?: number,
  season?: string,
): WaterClarity {
  if (!weather) return 'unknown';

  let score = 0;

  if (weather.humidity > 85) score += 1;
  if (weather.condition.toLowerCase().includes('rain') ||
      weather.condition.toLowerCase().includes('storm') ||
      weather.condition.toLowerCase().includes('thunder') ||
      weather.condition.toLowerCase().includes('snow')) {
    score += 2;
  }

  let ratio: number | null = null;
  if (baselineFlowCfs && flowCfs > 0) {
    ratio = flowCfs / baselineFlowCfs;
    if (ratio > 3) score += 3;
    else if (ratio > 2) score += 2;
    else if (ratio > 1.5) score += 1;
  }

  // Spring runoff / seasonal runoff tends to reduce clarity
  if (season === 'spring' && ratio != null && ratio > 1.5) score += 1;

  if (score >= 4) return 'blown_out';
  if (score >= 3) return 'murky';
  if (score >= 2) return 'stained';
  if (score >= 1) return 'slightly_stained';
  return 'clear';
}

export const CLARITY_LABELS: Record<WaterClarity, string> = {
  clear: 'Clear',
  slightly_stained: 'Slightly Stained',
  stained: 'Stained',
  murky: 'Murky',
  blown_out: 'Blown Out',
  unknown: 'Unknown',
};

export const CLARITY_DESCRIPTIONS: Record<WaterClarity, string> = {
  clear: 'Visibility 3+ feet. Use smaller, natural patterns.',
  slightly_stained: 'Visibility 1-3 feet. Standard patterns work well.',
  stained: 'Visibility under 1 foot. Go bigger and brighter.',
  murky: 'Very low visibility. Use large, dark, or flashy patterns.',
  blown_out: 'Unfishable or very tough. Consider a different location.',
  unknown: 'Water clarity data unavailable.',
};

export function getFlowStatus(currentCfs: number, baselineCfs: number | null | undefined): FlowStatusInfo {
  if (!baselineCfs || baselineCfs <= 0 || currentCfs <= 0) {
    return { status: 'unknown', ratio: null, baseline_cfs: null };
  }
  const ratio = currentCfs / baselineCfs;
  let status: FlowStatus;
  if (ratio < 0.5) status = 'low';
  else if (ratio <= 1.5) status = 'normal';
  else if (ratio <= 2.5) status = 'high';
  else if (ratio <= 4) status = 'very_high';
  else status = 'extreme';
  return { status, ratio, baseline_cfs: baselineCfs };
}

export const FLOW_STATUS_LABELS: Record<FlowStatus, string> = {
  low: 'Below Normal',
  normal: 'Normal',
  high: 'Above Normal',
  very_high: 'High',
  extreme: 'Dangerously High',
  unknown: 'Unknown',
};

export const FLOW_STATUS_DESCRIPTIONS: Record<FlowStatus, string> = {
  low: 'Flow is well below average. Fish may concentrate in deeper pools.',
  normal: 'Flow is within the typical range for this river.',
  high: 'Flow is elevated. Expect faster currents and off-color water.',
  very_high: 'Significantly above normal. Wading may be difficult or unsafe.',
  extreme: 'Dangerously high flow. Avoid wading. Consider a different location.',
  unknown: 'No baseline data for this location.',
};

export const FLOW_STATUS_COLORS: Record<FlowStatus, { bg: string; border: string }> = {
  low: { bg: '#DBEAFE', border: '#3B82F6' },
  normal: { bg: '#DCFCE7', border: '#22C55E' },
  high: { bg: '#FEF9C3', border: '#EAB308' },
  very_high: { bg: '#FED7AA', border: '#F97316' },
  extreme: { bg: '#FECACA', border: '#EF4444' },
  unknown: { bg: '#F3F4F6', border: '#9CA3AF' },
};

export function buildConditionsSummary(
  weather: WeatherData | null,
  waterFlow: WaterFlowData | null,
  flowStatusInfo: FlowStatusInfo | null,
  locationName?: string,
): string {
  const parts: string[] = [];

  if (waterFlow && waterFlow.flow_cfs > 0) {
    const name = locationName || waterFlow.station_name || 'The river';
    if (flowStatusInfo && flowStatusInfo.status !== 'unknown') {
      const pct = flowStatusInfo.ratio !== null ? Math.round(flowStatusInfo.ratio * 100) : null;
      const flowDesc: Record<FlowStatus, string> = {
        low: `${name} is running low at ${waterFlow.flow_cfs} CFS${pct ? ` (${pct}% of typical)` : ''}. Fish will be concentrated in deeper pools and runs — approach carefully and use lighter tippet.`,
        normal: `${name} is flowing at a healthy ${waterFlow.flow_cfs} CFS${pct ? ` (${pct}% of typical)` : ''}. Great wadeable conditions with fish spread through normal holding water.`,
        high: `${name} is running above normal at ${waterFlow.flow_cfs} CFS${pct ? ` (${pct}% of typical)` : ''}. Expect stronger currents — focus on slower seams and eddies near banks.`,
        very_high: `${name} is running high at ${waterFlow.flow_cfs} CFS${pct ? ` (${pct}% of typical)` : ''}. Wading will be tough. Fish the margins and any slack water you can find.`,
        extreme: `${name} is dangerously high at ${waterFlow.flow_cfs} CFS${pct ? ` (${pct}% of typical)` : ''}. Wading is unsafe. Consider a different location or wait for flows to drop.`,
        unknown: '',
      };
      parts.push(flowDesc[flowStatusInfo.status]);
    } else {
      parts.push(`Stream flow is ${waterFlow.flow_cfs} CFS.`);
    }

    if (waterFlow.water_temp_f !== null) {
      const temp = waterFlow.water_temp_f;
      if (temp < 39) {
        parts.push(`Water temp is cold at ${temp}°F — fish will be sluggish. Slow your presentation and fish deep.`);
      } else if (temp < 45) {
        parts.push(`Water temp is ${temp}°F, on the cool side. Nymphing will likely outperform dries.`);
      } else if (temp <= 55) {
        parts.push(`Water temp is ${temp}°F — ideal range for trout activity. Good chance for surface feeds.`);
      } else if (temp <= 62) {
        parts.push(`Water temp is ${temp}°F. Fish are active but look for shaded runs if it warms further.`);
      } else if (temp <= 68) {
        parts.push(`Water temp is ${temp}°F, getting warm. Fish early/late and target cooler tributary inflows.`);
      } else {
        parts.push(`Water temp is ${temp}°F — stressful for trout. Consider fishing early morning or a different, cooler stream.`);
      }
    }

    const clarityNote = CLARITY_DESCRIPTIONS[waterFlow.clarity];
    if (waterFlow.clarity !== 'unknown') {
      parts.push(`Water is ${CLARITY_LABELS[waterFlow.clarity].toLowerCase()}. ${clarityNote}`);
    }
  }

  if (weather) {
    const windNote = weather.wind_speed_mph <= 5
      ? 'Calm winds — excellent casting conditions.'
      : weather.wind_speed_mph <= 12
        ? `Light wind at ${weather.wind_speed_mph} mph from the ${weather.wind_direction}. Manageable for casting.`
        : weather.wind_speed_mph <= 20
          ? `Moderate wind at ${weather.wind_speed_mph} mph from the ${weather.wind_direction}. Shorten your casts and use heavier rigs.`
          : `Strong wind at ${weather.wind_speed_mph} mph. Casting will be difficult — use weighted flies and keep backcasts low.`;
    parts.push(windNote);

    if (weather.barometric_pressure >= 30.1) {
      parts.push('High pressure — fish may be less aggressive. Try subtle presentations.');
    } else if (weather.barometric_pressure <= 29.8) {
      parts.push('Falling or low pressure tends to trigger feeding activity. Good sign.');
    }
  }

  if (parts.length === 0) {
    return 'No conditions data available for this trip.';
  }

  return parts.join(' ');
}

export async function getStreamFlow(stationId: string): Promise<WaterFlowData> {
  try {
    const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${stationId}&parameterCd=${PARAM_CODES}&siteStatus=active`;
    const response = await fetch(url);
    const data = await response.json();

    const timeSeries = data?.value?.timeSeries;
    if (!timeSeries || timeSeries.length === 0) {
      return { ...MOCK_WATER_FLOW, station_id: stationId };
    }

    let flowCfs = 0;
    let waterTempF: number | null = null;
    let gageHeightFt: number | null = null;
    let turbidityNtu: number | null = null;
    let stationName = stationId;

    for (const series of timeSeries) {
      stationName = series.sourceInfo?.siteName || stationId;
      const paramCode = series.variable?.variableCode?.[0]?.value;
      const value = series.values?.[0]?.value?.[0];

      if (!value || value.value === '' || value.value === '-999999') continue;

      switch (paramCode) {
        case '00060':
          flowCfs = parseFloat(value.value);
          break;
        case '00010':
          waterTempF = Math.round(parseFloat(value.value) * 9 / 5 + 32);
          break;
        case '00065':
          gageHeightFt = parseFloat(value.value);
          break;
        case '63680':
          turbidityNtu = parseFloat(value.value);
          break;
      }
    }

    let clarity: WaterClarity;
    let claritySource: 'sensor' | 'inferred';

    if (turbidityNtu !== null) {
      clarity = turbidityToClarity(turbidityNtu);
      claritySource = 'sensor';
    } else {
      clarity = inferClarityFromWeather(null, flowCfs);
      claritySource = 'inferred';
    }

    return {
      station_id: stationId,
      station_name: stationName,
      flow_cfs: flowCfs,
      water_temp_f: waterTempF,
      gage_height_ft: gageHeightFt,
      turbidity_ntu: turbidityNtu,
      clarity,
      clarity_source: claritySource,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return { ...MOCK_WATER_FLOW, station_id: stationId };
  }
}
