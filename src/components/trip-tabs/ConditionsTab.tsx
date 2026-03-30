import { useState, useEffect, ReactNode } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, FontSize, BorderRadius } from '@/src/constants/theme';
import { getWeatherIconName, formatSkyLabel } from '@/src/services/conditions';
import { getHourlyForecast } from '@/src/services/weather';
import {
  buildConditionsSummary,
  getFlowStatus,
  FLOW_STATUS_LABELS,
  FLOW_STATUS_DESCRIPTIONS,
  FLOW_STATUS_COLORS,
  inferClarityFromWeather,
  CLARITY_LABELS,
  CLARITY_DESCRIPTIONS,
} from '@/src/services/waterFlow';
import { getSeason } from '@/src/services/ai';
import { formatFlowRate, formatTemperature } from '@/src/utils/formatters';
import { getMoonPhase, MOON_PHASE_LABELS } from '@/src/utils/moonPhase';
import { MoonPhaseShape } from '@/src/components/MoonPhaseShape';
import type { Location, WeatherData, WaterFlowData, WaterClarity } from '@/src/types';
import type { HourlyForecastItem } from '@/src/types';

export interface ConditionsTabProps {
  weatherData: WeatherData | null;
  waterFlowData: WaterFlowData | null;
  conditionsLoading?: boolean;
  onRefresh?: () => void;
  location: Location | null | undefined;
  /** Optional note below summary (e.g. "Conditions at time of trip") */
  note?: string;
  /** If false, hide hourly forecast (e.g. for past trip summary). Default true. */
  showHourly?: boolean;
  /** When no weather/water data and no children, show this message instead of unavailable cards (e.g. summary) */
  emptyMessage?: string;
  /** Optional content after water card (e.g. Conditions Timeline in summary) */
  children?: ReactNode;
}

export function ConditionsTab({
  weatherData,
  waterFlowData,
  conditionsLoading = false,
  onRefresh,
  location,
  note,
  showHourly = true,
  emptyMessage,
  children,
}: ConditionsTabProps) {
  const hasData = !!(weatherData || waterFlowData || children);
  const baselineCfs = (location?.metadata as Record<string, unknown> | null)?.baseline_flow_cfs as number | undefined;
  const flowStatus = waterFlowData ? getFlowStatus(waterFlowData.flow_cfs, baselineCfs) : null;
  const summary = buildConditionsSummary(weatherData, waterFlowData, flowStatus, location?.name);
  const moonPhase = getMoonPhase(new Date());

  const [hourlyForecast, setHourlyForecast] = useState<HourlyForecastItem[]>([]);
  const [hourlyLoading, setHourlyLoading] = useState(false);

  useEffect(() => {
    const lat = location?.latitude;
    const lng = location?.longitude;
    if (lat == null || lng == null) {
      setHourlyForecast([]);
      return;
    }
    setHourlyLoading(true);
    getHourlyForecast(lat, lng)
      .then(setHourlyForecast)
      .catch(() => setHourlyForecast([]))
      .finally(() => setHourlyLoading(false));
  }, [location?.latitude, location?.longitude]);

  return (
    <ScrollView style={styles.conditionsContainer} contentContainerStyle={styles.conditionsContent}>
      <View style={styles.conditionsHeaderRow}>
        <Text style={styles.conditionsSectionTitle}>Current Conditions</Text>
        {onRefresh != null && (
          <Pressable style={styles.refreshButton} onPress={onRefresh} disabled={conditionsLoading}>
            <Text style={styles.refreshButtonText}>{conditionsLoading ? 'Loading...' : 'Refresh'}</Text>
          </Pressable>
        )}
      </View>

      {conditionsLoading && !weatherData && !waterFlowData && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Fetching conditions...</Text>
        </View>
      )}

      {!hasData && emptyMessage != null && (
        <View style={styles.conditionCardEmpty}>
          <MaterialIcons name="cloud-off" size={32} color={Colors.textTertiary} />
          <Text style={styles.conditionEmptyText}>{emptyMessage}</Text>
          <Text style={styles.conditionEmptyHint}>Conditions are captured when you start a trip with location data.</Text>
        </View>
      )}

      {hasData && (weatherData || waterFlowData) && (
        <View style={styles.summaryCard}>
          <View style={styles.summaryCardHeader}>
            <MaterialIcons name="auto-awesome" size={18} color={Colors.accent} />
            <Text style={styles.summaryCardTitle}>What This Means</Text>
          </View>
          <Text style={styles.summaryCardText}>{summary}</Text>
          {note != null && note !== '' && (
            <Text style={styles.conditionsNote}>{note}</Text>
          )}
        </View>
      )}

      {weatherData ? (
        <View style={styles.conditionCard}>
          <View style={styles.conditionCardHeader}>
            <MaterialIcons name="cloud" size={20} color={Colors.secondary} />
            <Text style={styles.conditionCardTitle}>Weather</Text>
          </View>
          <View style={styles.weatherHeroRow}>
            <Ionicons
              name={getWeatherIconName(weatherData.condition) as keyof typeof Ionicons.glyphMap}
              size={36}
              color={Colors.secondary}
              style={styles.weatherHeroIcon}
            />
            <View style={styles.weatherHeroMain}>
              <Text style={styles.weatherHeroCondition}>{formatSkyLabel(weatherData.condition)}</Text>
              <Text style={styles.weatherHeroTemp}>{weatherData.temperature_f}°F</Text>
            </View>
            <View style={styles.weatherHeroWind}>
              <Text style={styles.weatherHeroWindLabel}>Wind</Text>
              <Text style={styles.weatherHeroWindValue}>
                {weatherData.wind_speed_mph} mph {weatherData.wind_direction}
              </Text>
            </View>
          </View>
          <View style={styles.conditionGrid}>
            <View style={styles.conditionGridItem}>
              <Text style={styles.conditionGridLabel}>Pressure</Text>
              <Text style={styles.conditionGridValue}>{weatherData.barometric_pressure} inHg</Text>
            </View>
            <View style={styles.conditionGridItem}>
              <Text style={styles.conditionGridLabel}>Cloud Cover</Text>
              <Text style={styles.conditionGridValue}>{weatherData.cloud_cover}%</Text>
            </View>
            <View style={styles.conditionGridItem}>
              <Text style={styles.conditionGridLabel}>Humidity</Text>
              <Text style={styles.conditionGridValue}>{weatherData.humidity}%</Text>
            </View>
            <View style={styles.conditionGridItem}>
              <Text style={styles.conditionGridLabel}>Moon</Text>
              <View style={styles.moonPhaseRow}>
                <MoonPhaseShape
                  phase={moonPhase}
                  size={28}
                  southernHemisphere={location?.latitude != null && location.latitude < 0}
                />
                <Text style={styles.conditionGridValue}>{MOON_PHASE_LABELS[moonPhase]}</Text>
              </View>
            </View>
          </View>
        </View>
      ) : !conditionsLoading && emptyMessage == null ? (
        <View style={styles.conditionCardEmpty}>
          <MaterialIcons name="cloud-off" size={32} color={Colors.textTertiary} />
          <Text style={styles.conditionEmptyText}>Weather data unavailable</Text>
          <Text style={styles.conditionEmptyHint}>Location may not have coordinates set</Text>
        </View>
      ) : null}

      {showHourly && location?.latitude != null && location?.longitude != null && (
        <View style={styles.conditionCard}>
          <View style={styles.conditionCardHeader}>
            <MaterialIcons name="schedule" size={20} color={Colors.secondary} />
            <Text style={styles.conditionCardTitle}>Today&apos;s forecast</Text>
          </View>
          {hourlyLoading ? (
            <View style={styles.hourlyLoadingRow}>
              <ActivityIndicator size="small" color={Colors.primary} />
              <Text style={styles.hourlyLoadingText}>Loading hourly...</Text>
            </View>
          ) : hourlyForecast.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.hourlyScroll}>
              {hourlyForecast.map((slot, i) => (
                <View key={i} style={styles.hourlySlot}>
                  <Text style={styles.hourlySlotTime}>{slot.time}</Text>
                  <Ionicons
                    name={getWeatherIconName(slot.condition) as keyof typeof Ionicons.glyphMap}
                    size={28}
                    color={Colors.secondary}
                    style={styles.hourlySlotIcon}
                  />
                  <Text style={styles.hourlySlotTemp}>{slot.temp_f}°</Text>
                  <Text style={styles.hourlySlotCondition} numberOfLines={1}>
                    {formatSkyLabel(slot.condition)}
                  </Text>
                  {slot.wind_speed_mph != null && slot.wind_speed_mph > 0 && (
                    <Text style={styles.hourlySlotWind}>
                      {slot.wind_speed_mph} mph {slot.wind_direction ?? ''}
                    </Text>
                  )}
                  {slot.pop != null && slot.pop > 0 && (
                    <Text style={styles.hourlySlotPop} numberOfLines={1}>
                      {slot.pop}%
                    </Text>
                  )}
                </View>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.conditionEmptyHint}>
              Forecast unavailable. Add OpenWeatherMap API key for hourly forecast.
            </Text>
          )}
        </View>
      )}

      {waterFlowData ? (
        <View style={styles.conditionCard}>
          <View style={styles.conditionCardHeader}>
            <MaterialIcons name="waves" size={20} color={Colors.water} />
            <Text style={styles.conditionCardTitle}>Water Conditions</Text>
          </View>
          <View style={styles.conditionMainStat}>
            <Text style={styles.conditionMainValue}>{formatFlowRate(waterFlowData.flow_cfs)}</Text>
            <Text style={styles.conditionMainLabel}>Stream Flow</Text>
          </View>
          {flowStatus && flowStatus.status !== 'unknown' && (
            <View
              style={[
                styles.clarityBadge,
                {
                  backgroundColor: FLOW_STATUS_COLORS[flowStatus.status].bg,
                  borderColor: FLOW_STATUS_COLORS[flowStatus.status].border,
                },
              ]}
            >
              <Text style={styles.clarityBadgeLabel}>
                Flow: {FLOW_STATUS_LABELS[flowStatus.status]}
                {flowStatus.ratio !== null ? ` (${Math.round(flowStatus.ratio * 100)}% of normal)` : ''}
              </Text>
              <Text style={styles.clarityBadgeDesc}>{FLOW_STATUS_DESCRIPTIONS[flowStatus.status]}</Text>
            </View>
          )}
          <View style={styles.conditionGageClarityRow}>
            <View style={styles.conditionGridItem}>
              <Text style={styles.conditionGridLabel}>Gage Height</Text>
              <Text style={styles.conditionGridValue}>
                {waterFlowData.gage_height_ft != null ? `${waterFlowData.gage_height_ft} ft` : '—'}
              </Text>
            </View>
            <View style={styles.conditionGridItem}>
              <Text style={styles.conditionGridLabel}>Clarity</Text>
              <Text style={styles.conditionGridValue}>
                {waterFlowData.clarity === 'unknown'
                  ? (() => {
                      const estimate = inferClarityFromWeather(
                        weatherData ?? null,
                        waterFlowData.flow_cfs,
                        baselineCfs,
                        getSeason(new Date())
                      );
                      return estimate !== 'unknown'
                        ? `Unavailable · Estimate: ${CLARITY_LABELS[estimate]}`
                        : 'Unavailable';
                    })()
                  : CLARITY_LABELS[waterFlowData.clarity as WaterClarity]}
              </Text>
            </View>
          </View>
          <View style={styles.conditionGrid}>
            {waterFlowData.water_temp_f !== null && (
              <View style={styles.conditionGridItem}>
                <Text style={styles.conditionGridLabel}>Water Temp</Text>
                <Text style={styles.conditionGridValue}>{formatTemperature(waterFlowData.water_temp_f)}</Text>
              </View>
            )}
            {waterFlowData.turbidity_ntu !== null && (
              <View style={styles.conditionGridItem}>
                <Text style={styles.conditionGridLabel}>Turbidity</Text>
                <Text style={styles.conditionGridValue}>{waterFlowData.turbidity_ntu} NTU</Text>
              </View>
            )}
          </View>
        </View>
      ) : !conditionsLoading && emptyMessage == null ? (
        <View style={styles.conditionCardEmpty}>
          <MaterialIcons name="waves" size={32} color={Colors.textTertiary} />
          <Text style={styles.conditionEmptyText}>Water flow data unavailable</Text>
          <Text style={styles.conditionEmptyHint}>No USGS station linked to this location</Text>
        </View>
      ) : null}

      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  conditionsContainer: {
    flex: 1,
  },
  conditionsContent: {
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  conditionsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  conditionsSectionTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  conditionsNote: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginTop: Spacing.sm,
  },
  refreshButton: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  refreshButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primary,
  },
  loadingContainer: {
    alignItems: 'center',
    padding: Spacing.xxl,
    gap: Spacing.md,
  },
  loadingText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: Colors.accent,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  summaryCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  summaryCardTitle: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryCardText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 24,
  },
  conditionCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  conditionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  conditionCardTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  conditionMainStat: {
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  conditionMainValue: {
    fontSize: FontSize.xxxl,
    fontWeight: '700',
    color: Colors.primary,
  },
  conditionMainLabel: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  weatherHeroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  weatherHeroIcon: {
    marginRight: 4,
  },
  weatherHeroMain: {
    flex: 1,
  },
  weatherHeroCondition: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textTransform: 'capitalize',
  },
  weatherHeroTemp: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 2,
  },
  weatherHeroWind: {
    alignItems: 'flex-end',
  },
  weatherHeroWindLabel: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  weatherHeroWindValue: {
    fontSize: FontSize.sm,
    color: Colors.text,
    marginTop: 2,
  },
  conditionGageClarityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  conditionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  conditionGridItem: {
    width: '47%',
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  conditionGridLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  conditionGridValue: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
    marginTop: 4,
  },
  moonPhaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: 4,
  },
  clarityBadge: {
    marginTop: Spacing.md,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1.5,
  },
  clarityBadgeLabel: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.text,
  },
  clarityBadgeDesc: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 20,
  },
  conditionCardEmpty: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
  },
  conditionEmptyText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  conditionEmptyHint: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginTop: 4,
  },
  hourlyLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  hourlyLoadingText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  hourlyScroll: {
    marginHorizontal: -Spacing.md,
  },
  hourlySlot: {
    width: 72,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    marginRight: Spacing.xs,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
  },
  hourlySlotTime: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  hourlySlotIcon: {
    marginVertical: 4,
  },
  hourlySlotTemp: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  hourlySlotCondition: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  hourlySlotWind: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  hourlySlotPop: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: 2,
  },
});
