import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ExpoLocation from 'expo-location';
import { MaterialIcons } from '@expo/vector-icons';
import { CatchPinPickerMap } from '@/src/components/map/CatchPinPickerMap';
import { BorderRadius, Colors, FontSize, Spacing } from '@/src/constants/theme';
import { tripMapDefaultCenterCoordinate } from '@/src/utils/mapViewport';
import { findTripEndedEvent, findTripStartedEvent } from '@/src/utils/tripStartEndFromEvents';
import type { Trip, TripEvent } from '@/src/types';

const SCREEN_H = Dimensions.get('window').height;
/** Map area: large enough for pan/zoom + +/- controls inside the modal */
const ENDPOINT_MAP_HEIGHT = Math.round(SCREEN_H * 0.58);

export type TripEndpointKind = 'start' | 'end';

export function patchTripEndpointCoords(
  trip: Trip,
  events: TripEvent[],
  kind: TripEndpointKind,
  lat: number,
  lng: number,
): { trip: Trip; events: TripEvent[] } {
  const nextTrip: Trip =
    kind === 'start'
      ? { ...trip, start_latitude: lat, start_longitude: lng }
      : { ...trip, end_latitude: lat, end_longitude: lng };

  if (kind === 'start') {
    const ev = findTripStartedEvent(events);
    if (!ev) return { trip: nextTrip, events };
    return {
      trip: nextTrip,
      events: events.map((e) => (e.id === ev.id ? { ...e, latitude: lat, longitude: lng } : e)),
    };
  }

  const ev = findTripEndedEvent(events);
  if (!ev) return { trip: nextTrip, events };
  return {
    trip: nextTrip,
    events: events.map((e) => (e.id === ev.id ? { ...e, latitude: lat, longitude: lng } : e)),
  };
}

function initialPinForKind(trip: Trip, kind: TripEndpointKind): { lat: number | null; lon: number | null } {
  if (kind === 'start') {
    const la = trip.start_latitude ?? null;
    const lo = trip.start_longitude ?? null;
    if (la != null && lo != null) return { lat: la, lon: lo };
  } else {
    const la = trip.end_latitude ?? null;
    const lo = trip.end_longitude ?? null;
    if (la != null && lo != null) return { lat: la, lon: lo };
  }
  const loc = trip.location;
  if (loc?.latitude != null && loc?.longitude != null) {
    return { lat: loc.latitude, lon: loc.longitude };
  }
  return { lat: null, lon: null };
}

export type TripEndpointPinModalProps = {
  visible: boolean;
  kind: TripEndpointKind;
  trip: Trip;
  events: TripEvent[];
  isConnected: boolean;
  onClose: () => void;
  onPersist: (nextTrip: Trip, nextEvents: TripEvent[]) => Promise<boolean>;
};

export function TripEndpointPinModal({
  visible,
  kind,
  trip,
  events,
  isConnected,
  onClose,
  onPersist,
}: TripEndpointPinModalProps) {
  const [pinLat, setPinLat] = useState<number | null>(null);
  const [pinLon, setPinLon] = useState<number | null>(null);
  const [latText, setLatText] = useState('');
  const [lonText, setLonText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mapFocusKey, setMapFocusKey] = useState(0);

  const mapFallbackCenter = useMemo(() => tripMapDefaultCenterCoordinate(trip), [trip]);

  useEffect(() => {
    if (visible) setMapFocusKey((k) => k + 1);
  }, [visible, kind, trip.id]);

  useEffect(() => {
    if (!visible) return;
    const { lat, lon } = initialPinForKind(trip, kind);
    setPinLat(lat);
    setPinLon(lon);
    setLatText(lat != null ? String(lat) : '');
    setLonText(lon != null ? String(lon) : '');

    if (lat == null || lon == null) {
      void (async () => {
        try {
          const { status } = await ExpoLocation.getForegroundPermissionsAsync();
          if (status !== 'granted') return;
          const loc = await ExpoLocation.getCurrentPositionAsync({
            accuracy: ExpoLocation.Accuracy.Balanced,
          });
          setPinLat((p) => p ?? loc.coords.latitude);
          setPinLon((p) => p ?? loc.coords.longitude);
          setLatText((t) => t || String(loc.coords.latitude));
          setLonText((t) => t || String(loc.coords.longitude));
        } catch {
          /* optional */
        }
      })();
    }
  }, [
    visible,
    kind,
    trip.id,
    trip.start_latitude,
    trip.start_longitude,
    trip.end_latitude,
    trip.end_longitude,
    trip.location?.latitude,
    trip.location?.longitude,
  ]);

  const syncPinFromText = useCallback(() => {
    const la = latText.trim() ? Number(latText.trim()) : NaN;
    const lo = lonText.trim() ? Number(lonText.trim()) : NaN;
    if (Number.isFinite(la) && Number.isFinite(lo)) {
      setPinLat(la);
      setPinLon(lo);
    }
  }, [latText, lonText]);

  const onCoordinateChange = useCallback((lat: number, lng: number) => {
    setPinLat(lat);
    setPinLon(lng);
    setLatText(String(lat));
    setLonText(String(lng));
  }, []);

  const title = kind === 'start' ? 'Trip start pin' : 'Trip end pin';
  const hint =
    kind === 'start'
      ? 'Pan and zoom to set where this trip began. The pin stays in the center.'
      : 'Pan and zoom to set where this trip ended. The pin stays in the center.';

  const handleSave = async () => {
    syncPinFromText();
    const la = latText.trim() ? Number(latText.trim()) : NaN;
    const lo = lonText.trim() ? Number(lonText.trim()) : NaN;
    const lat = Number.isFinite(la) ? la : pinLat;
    const lng = Number.isFinite(lo) ? lo : pinLon;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      Alert.alert('Set a location', 'Choose a point on the map or enter latitude and longitude.');
      return;
    }
    if (!isConnected) {
      Alert.alert('Offline', 'Connect to the internet to save changes.');
      return;
    }
    setSubmitting(true);
    try {
      const { trip: nextTrip, events: nextEvents } = patchTripEndpointCoords(trip, events, kind, lat, lng);
      const ok = await onPersist(nextTrip, nextEvents);
      if (ok) onClose();
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
        />
        <View style={styles.overlay}>
          <View style={styles.card} onStartShouldSetResponder={() => true}>
            <View style={styles.header}>
              <Text style={styles.title}>{title}</Text>
            </View>
            <View style={styles.mapSlot}>
              <CatchPinPickerMap
                latitude={pinLat}
                longitude={pinLon}
                onCoordinateChange={onCoordinateChange}
                hintText={hint}
                hintPosition="below"
                interactionMode="pan_center"
                focusRequestKey={mapFocusKey}
                mapFallbackCenter={mapFallbackCenter}
                showZoomControls
                containerStyle={styles.mapFill}
              />
            </View>
            <View style={styles.coordBlock}>
              <Text style={styles.coordHint}>Optional: fine-tune coordinates</Text>
              <View style={styles.coordRow}>
                <TextInput
                  style={[styles.input, styles.coordInput]}
                  placeholder="Latitude"
                  placeholderTextColor={Colors.textTertiary}
                  value={latText}
                  onChangeText={setLatText}
                  onBlur={syncPinFromText}
                  keyboardType="numbers-and-punctuation"
                />
                <TextInput
                  style={[styles.input, styles.coordInput]}
                  placeholder="Longitude"
                  placeholderTextColor={Colors.textTertiary}
                  value={lonText}
                  onChangeText={setLonText}
                  onBlur={syncPinFromText}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>
            <View style={styles.actions}>
              <Pressable
                style={styles.cancelBtn}
                onPress={() => {
                  Keyboard.dismiss();
                  onClose();
                }}
                disabled={submitting}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, submitting && styles.saveBtnDisabled]}
                onPress={() => void handleSave()}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color={Colors.textInverse} />
                ) : (
                  <>
                    <MaterialIcons name="check" size={20} color={Colors.textInverse} />
                    <Text style={styles.saveText}>Save</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  overlay: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    maxHeight: SCREEN_H * 0.96,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    overflow: 'hidden',
    width: '100%',
    maxHeight: SCREEN_H * 0.94,
  },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  title: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  mapSlot: {
    height: ENDPOINT_MAP_HEIGHT,
    width: '100%',
    paddingHorizontal: Spacing.lg,
  },
  mapFill: {
    flex: 1,
  },
  coordBlock: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  coordHint: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginBottom: Spacing.xs,
  },
  coordRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  coordInput: {
    flex: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.md,
    padding: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  cancelBtn: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  cancelText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
  },
  saveBtnDisabled: {
    opacity: 0.7,
  },
  saveText: {
    fontSize: FontSize.md,
    fontWeight: '700',
    color: Colors.textInverse,
  },
});
