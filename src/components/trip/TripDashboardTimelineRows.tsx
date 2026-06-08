import { TimelineCatchNodePhoto } from '@/src/components/catch/TimelineCatchPhotoStrip';
import { CatchDetailsBlock, getTimelineRowPresentation } from '@/src/components/trip/tripTimelinePresentation';
import {
  createTripDashboardTimelineStyles,
} from '@/src/components/trip/tripDashboardTimelineStyles';
import { type ThemeColors } from '@/src/constants/theme';
import type { CatchData, Fly, FlyCatalog, FlyChangeData, NoteData, TripEvent } from '@/src/types';
import type { EventSyncStatus } from '@/src/types/sync';
import { resolveCatchHeroPhotoUrl } from '@/src/utils/catchPhotos';
import { formatEventTime } from '@/src/utils/formatters';
import {
  getCatchDetailLines,
  type TimelineDisplayRow,
} from '@/src/utils/journalTimeline';
import {
  resolveFlyImageSourceFromChangeData,
} from '@/src/utils/resolveFlyPhotoUrl';
import { tripLifecycleNoteTimelineIcon } from '@/src/utils/timelineTripNoteIcon';
import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { Image as RnImage, Pressable, Text, View } from 'react-native';

export type TripDashboardTimelineRowsProps = {
  rows: TimelineDisplayRow[];
  colors: ThemeColors;
  userFlies?: Fly[];
  flyCatalog?: FlyCatalog[];
  albumPhotoUrlsByCatchId?: ReadonlyMap<string, readonly string[]>;
  expandedCatchIds: Set<string>;
  onToggleCatchExpanded: (eventId: string) => void;
  onCatchPhotoPress?: (event: TripEvent) => void;
  onCatchEditPress?: (event: TripEvent) => void;
  onFlyViewPress?: (event: TripEvent) => void;
  onRowMenuPress?: (event: TripEvent, index: number) => void;
  showRowMenu?: boolean;
  attributionLabelForEvent?: (event: TripEvent) => string | undefined;
  attributionAvatarUriForEvent?: (event: TripEvent) => string | null | undefined;
  compactAttributionLabels?: boolean;
  eventSyncStatusForEvent?: (event: TripEvent) => EventSyncStatus;
};

function labelForSyncStatus(s: EventSyncStatus): string {
  switch (s) {
    case 'synced':
      return 'Synced to cloud';
    case 'pending':
      return 'Waiting to upload';
    case 'syncing':
      return 'Uploading';
    case 'error':
      return 'Upload failed, will retry';
    default:
      return '';
  }
}

function TimelineSyncDot({
  status,
  colors,
  compact = false,
}: {
  status: EventSyncStatus;
  colors: ThemeColors;
  compact?: boolean;
}) {
  const styles = createTripDashboardTimelineStyles(colors);
  const color =
    status === 'error' ? colors.error : status === 'synced' ? colors.success : colors.warning;
  return (
    <View
      style={[styles.timelineSyncCol, compact && { paddingTop: 0, alignSelf: 'center' }]}
      accessibilityRole="text"
      accessibilityLabel={labelForSyncStatus(status)}
    >
      <View style={[styles.timelineSyncDot, { backgroundColor: color }]} />
    </View>
  );
}

export function TripDashboardTimelineRows({
  rows,
  colors,
  userFlies = [],
  flyCatalog = [],
  albumPhotoUrlsByCatchId,
  expandedCatchIds,
  onToggleCatchExpanded,
  onCatchPhotoPress,
  onCatchEditPress,
  onFlyViewPress,
  onRowMenuPress,
  showRowMenu = true,
  attributionLabelForEvent,
  attributionAvatarUriForEvent,
  compactAttributionLabels = false,
  eventSyncStatusForEvent,
}: TripDashboardTimelineRowsProps) {
  const styles = useMemo(() => createTripDashboardTimelineStyles(colors), [colors]);
  const showAttribution = attributionLabelForEvent != null;

  return (
    <>
      {rows.map(({ key, event, flySlot, eventIndex: index, catchFly }, displayIdx) => {
        const isFirst = displayIdx === 0;
        const isLast = displayIdx === rows.length - 1;
        const { title, subtitle } = getTimelineRowPresentation(event, flySlot);
        const noteText =
          event.event_type === 'note' ? ((event.data as NoteData).text ?? '') : '';
        const lifecycleIcon =
          event.event_type === 'note' ? tripLifecycleNoteTimelineIcon(noteText, colors) : null;
        const flyData =
          event.event_type === 'fly_change' ? (event.data as FlyChangeData) : null;
        const flyThumb =
          flyData && flySlot
            ? resolveFlyImageSourceFromChangeData(
                flyData,
                flySlot === 'secondary' ? 'dropper' : 'primary',
                userFlies,
                flyCatalog,
              )
            : null;
        const isCatch = event.event_type === 'catch';
        const catchData = isCatch ? (event.data as CatchData) : null;
        const catchDetailLines = catchData ? getCatchDetailLines(catchData, catchFly) : [];
        const isCatchExpanded = isCatch && expandedCatchIds.has(event.id);
        const catchHeroUrl =
          catchData != null
            ? resolveCatchHeroPhotoUrl(event.id, catchData, albumPhotoUrlsByCatchId)
            : null;
        const bodyPress =
          event.event_type === 'fly_change' && flySlot
            ? () => onFlyViewPress?.(event)
            : undefined;
        const catchHasExpandableDetails = isCatch && catchDetailLines.length > 0;
        const onCatchPhotoNodePress =
          isCatch && catchHeroUrl ? () => onCatchPhotoPress?.(event) : undefined;
        const onCatchExpandPress = catchHasExpandableDetails
          ? () => onToggleCatchExpanded(event.id)
          : undefined;
        const onCatchBodyPress = isCatch
          ? () => {
              if (catchHasExpandableDetails) {
                onToggleCatchExpanded(event.id);
                return;
              }
              onCatchEditPress?.(event);
            }
          : undefined;
        const isCompactRow = !subtitle && !isCatch;

        const recorderLabel = showAttribution
          ? (attributionLabelForEvent?.(event)?.trim() || 'Angler')
          : '';
        const attributionUri = showAttribution
          ? attributionAvatarUriForEvent?.(event)?.trim() || null
          : null;
        const attributionInitial =
          recorderLabel.length > 0 ? recorderLabel.charAt(0).toUpperCase() : '?';
        const syncStatus = eventSyncStatusForEvent?.(event);

        return (
          <View key={key} style={styles.timelineItem}>
            {showAttribution ? (
              <View style={styles.timelineMetaCol}>
                {attributionUri ? (
                  <Image
                    source={{ uri: attributionUri }}
                    style={styles.timelineAvatar}
                    contentFit="cover"
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <View style={[styles.timelineAvatar, styles.timelineAvatarPlaceholder]}>
                    <Text style={styles.timelineAvatarLetter}>{attributionInitial}</Text>
                  </View>
                )}
                <Text
                  style={[styles.timelineTime, styles.timelineTimeInMetaCol]}
                >
                  {formatEventTime(event.timestamp)}
                </Text>
              </View>
            ) : (
              <Text style={[styles.timelineTime, isCompactRow && styles.timelineTimeCompact]}>
                {formatEventTime(event.timestamp)}
              </Text>
            )}

            <View style={styles.timelineRail}>
              {!isFirst ? <View style={styles.timelineLineAbove} pointerEvents="none" /> : null}
              {onCatchPhotoNodePress ? (
                <Pressable
                  onPress={onCatchPhotoNodePress}
                  accessibilityRole="button"
                  accessibilityLabel="View catch photo full screen"
                  style={[
                    styles.timelineNode,
                    styles.timelineNodeCatch,
                    styles.timelineNodeCatchPhoto,
                  ]}
                >
                  <TimelineCatchNodePhoto
                    catchEventId={event.id}
                    data={catchData!}
                    albumPhotoUrlsByCatchId={albumPhotoUrlsByCatchId}
                    imageStyle={styles.timelineNodeCatchImage}
                  />
                </Pressable>
              ) : (
                <View
                  style={[
                    styles.timelineNode,
                    event.event_type === 'fly_change' && flySlot && styles.timelineNodeFly,
                    event.event_type === 'bite' && styles.timelineNodeBite,
                    event.event_type === 'catch' && styles.timelineNodeCatch,
                    event.event_type === 'note' && styles.timelineNodeNote,
                  ]}
                >
                  {event.event_type === 'fly_change' && flySlot ? (
                    flyThumb ? (
                      <RnImage
                        source={flyThumb}
                        style={styles.timelineNodeFlyImage}
                        resizeMode="contain"
                      />
                    ) : (
                      <MaterialCommunityIcons name="hook" size={18} color={colors.secondary} />
                    )
                  ) : isCatch ? (
                    <MaterialCommunityIcons name="fish" size={18} color={colors.primaryLight} />
                  ) : event.event_type === 'bite' ? (
                    <MaterialCommunityIcons name="fish" size={18} color={colors.success} />
                  ) : event.event_type === 'ai_query' ? (
                    <MaterialIcons name="smart-toy" size={16} color={colors.info} />
                  ) : event.event_type === 'fish_on' ? (
                    <MaterialIcons name="highlight-off" size={18} color={colors.primary} />
                  ) : event.event_type === 'got_off' ? (
                    <MaterialIcons name="highlight-off" size={16} color={colors.textSecondary} />
                  ) : lifecycleIcon ? (
                    <MaterialIcons name={lifecycleIcon.name} size={16} color={lifecycleIcon.color} />
                  ) : (
                    <MaterialIcons name="edit-note" size={16} color={colors.info} />
                  )}
                </View>
              )}
              {!isLast ? <View style={[styles.timelineLineSegment, styles.timelineLineSegmentLower]} /> : null}
            </View>

            <Pressable
              style={[
                styles.timelineBody,
                showAttribution && styles.timelineBodyWithAttribution,
                isCompactRow && styles.timelineBodyCompact,
              ]}
              onPress={isCatch ? onCatchBodyPress : bodyPress}
              disabled={isCatch ? onCatchBodyPress == null : bodyPress == null}
              accessibilityRole={isCatch || bodyPress ? 'button' : undefined}
              accessibilityState={catchHasExpandableDetails ? { expanded: isCatchExpanded } : undefined}
              accessibilityLabel={
                isCatch
                  ? catchHasExpandableDetails
                    ? isCatchExpanded
                      ? `Collapse catch details, ${title}`
                      : `Expand catch details, ${title}`
                    : title
                  : bodyPress
                    ? title
                    : undefined
              }
            >
              <Text style={styles.timelineRowTitle}>{title}</Text>
              {subtitle ? <Text style={styles.timelineRowSubtitle}>{subtitle}</Text> : null}
              {isCatch && isCatchExpanded && catchData ? (
                <CatchDetailsBlock data={catchData} flyLabel={catchFly} styles={styles} />
              ) : null}
            </Pressable>

            {catchHasExpandableDetails ? (
              <Pressable
                style={[styles.timelineRowExpandBtn, isCompactRow && styles.timelineRowExpandBtnCompact]}
                onPress={onCatchExpandPress}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityState={{ expanded: isCatchExpanded }}
                accessibilityLabel={isCatchExpanded ? 'Collapse catch details' : 'Expand catch details'}
              >
                <MaterialIcons
                  name={isCatchExpanded ? 'expand-less' : 'expand-more'}
                  size={22}
                  color={colors.textSecondary}
                />
              </Pressable>
            ) : null}

            {syncStatus ? (
              <TimelineSyncDot status={syncStatus} colors={colors} compact={isCompactRow} />
            ) : null}

            {showRowMenu && onRowMenuPress ? (
              <Pressable
                style={[styles.timelineRowMenuBtn, isCompactRow && styles.timelineRowMenuBtnCompact]}
                onPress={() => onRowMenuPress(event, index)}
                hitSlop={12}
                accessibilityLabel="Timeline row actions"
              >
                <MaterialIcons name="more-vert" size={22} color={colors.textSecondary} />
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </>
  );
}
