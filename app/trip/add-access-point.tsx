import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MapView, { Marker, MapPressEvent, Region } from 'react-native-maps';
import * as ExpoLocation from 'expo-location';
import { Colors, Spacing, FontSize, BorderRadius } from '@/src/constants/theme';
import { useLocationStore } from '@/src/stores/locationStore';
import { useAuthStore } from '@/src/stores/authStore';
import { createAccessPoint } from '@/src/services/accessPointService';
import { MapZoomControls } from '@/src/components/map/MapZoomControls';
import { zoomMapRegion } from '@/src/components/map/mapZoom';

export default function AddAccessPointScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ locationId?: string }>();
  const locationId = params.locationId ? String(params.locationId) : '';
  const { user } = useAuthStore();
  const { getLocationById, fetchLocations, locations } = useLocationStore();

  const mapRef = useRef<MapView>(null);
  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const defaultRegion: Region = {
    latitude: 40.7608,
    longitude: -111.8910,
    latitudeDelta: 0.25,
    longitudeDelta: 0.25,
  };
  const mapRegionRef = useRef<Region>(defaultRegion);
  const [initialRegion, setInitialRegion] = useState<Region>(defaultRegion);

  const parentLocation = locationId ? getLocationById(locationId) : undefined;

  useEffect(() => {
    mapRegionRef.current = initialRegion;
  }, [initialRegion]);

  useEffect(() => {
    if (locations.length === 0) fetchLocations();
  }, [locations.length, fetchLocations]);

  useEffect(() => {
    const loc = parentLocation;
    if (loc?.latitude != null && loc.longitude != null) {
      const region: Region = {
        latitude: loc.latitude,
        longitude: loc.longitude,
        latitudeDelta: 0.08,
        longitudeDelta: 0.08,
      };
      setInitialRegion(region);
      setPin({ latitude: loc.latitude, longitude: loc.longitude });
      mapRef.current?.animateToRegion(region, 400);
    }
  }, [parentLocation?.id, parentLocation?.latitude, parentLocation?.longitude]);

  useEffect(() => {
    (async () => {
      if (parentLocation) return;
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const pos = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        const region: Region = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          latitudeDelta: 0.25,
          longitudeDelta: 0.25,
        };
        setInitialRegion(region);
        mapRef.current?.animateToRegion(region, 600);
      }
    })();
  }, [parentLocation]);

  const handleMapPress = useCallback((e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPin({ latitude, longitude });
  }, []);

  const handleRegionChangeComplete = useCallback((region: Region) => {
    mapRegionRef.current = region;
    setInitialRegion(region);
  }, []);

  const handleMapZoomIn = useCallback(() => {
    const next = zoomMapRegion(mapRegionRef.current, true);
    mapRef.current?.animateToRegion(next, 180);
  }, []);

  const handleMapZoomOut = useCallback(() => {
    const next = zoomMapRegion(mapRegionRef.current, false);
    mapRef.current?.animateToRegion(next, 180);
  }, []);

  const handleSave = useCallback(async () => {
    if (!pin || !name.trim() || !user || !locationId) return;
    setSaving(true);
    try {
      const row = await createAccessPoint({
        locationId,
        name: name.trim(),
        latitude: pin.latitude,
        longitude: pin.longitude,
        userId: user.id,
      });
      if (row) {
        Alert.alert(
          'Submitted',
          'This access point will appear for others after review.',
          [{ text: 'OK', onPress: () => router.back() }],
        );
      } else {
        Alert.alert('Error', 'Could not save. Try again when online.');
      }
    } catch {
      Alert.alert('Error', 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }, [pin, name, user, locationId, router]);

  if (!locationId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Missing location.</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  if (locations.length > 0 && !parentLocation) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Location not found.</Text>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  const canSave = pin && name.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inputSection}>
        <Text style={styles.contextLabel}>
          Location: {parentLocation?.name ?? '…'}
        </Text>
        <Text style={styles.helpText}>
          Mark a trailhead, parking area, or boat ramp — not a secret fishing lie. Submissions are reviewed before they show for everyone.
        </Text>
        <TextInput
          style={styles.nameInput}
          placeholder="Access name (e.g. Charleston parking)"
          placeholderTextColor={Colors.textTertiary}
          value={name}
          onChangeText={setName}
          returnKeyType="done"
        />
      </View>

      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={initialRegion}
          onRegionChangeComplete={handleRegionChangeComplete}
          onPress={handleMapPress}
          showsUserLocation
          showsMyLocationButton
          mapType="standard"
        >
          {pin && (
            <Marker
              coordinate={pin}
              draggable
              onDragEnd={(e) => setPin(e.nativeEvent.coordinate)}
              pinColor={Colors.primary}
            />
          )}
        </MapView>
        <MapZoomControls onZoomIn={handleMapZoomIn} onZoomOut={handleMapZoomOut} />
      </View>

      <View style={styles.footer}>
        <Pressable
          style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!canSave || saving}
        >
          {saving ? (
            <ActivityIndicator color={Colors.textInverse} />
          ) : (
            <Text style={styles.saveBtnText}>Submit for review</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.lg },
  errorText: { fontSize: FontSize.md, color: Colors.textSecondary, marginBottom: Spacing.md },
  backBtn: { padding: Spacing.md },
  backBtnText: { color: Colors.primary, fontWeight: '600' },
  inputSection: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  contextLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: Spacing.xs },
  helpText: { fontSize: FontSize.xs, color: Colors.textTertiary, marginBottom: Spacing.sm },
  nameInput: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  footer: {
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: Colors.textTertiary },
  saveBtnText: { color: Colors.textInverse, fontSize: FontSize.md, fontWeight: '700' },
});
