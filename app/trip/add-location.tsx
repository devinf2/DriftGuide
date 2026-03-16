import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, ScrollView,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import MapView, { Marker, MapPressEvent, Region } from 'react-native-maps';
import * as ExpoLocation from 'expo-location';
import { Colors, Spacing, FontSize, BorderRadius, LocationTypeColors } from '@/src/constants/theme';
import { useLocationStore } from '@/src/stores/locationStore';
import { useAuthStore } from '@/src/stores/authStore';
import { LocationType, NearbyLocationResult } from '@/src/types';
import { searchNearbyLocations, addCommunityLocation } from '@/src/services/locationService';

const UTAH_CENTER: Region = {
  latitude: 40.7608,
  longitude: -111.8910,
  latitudeDelta: 2.5,
  longitudeDelta: 2.5,
};

const LOCATION_TYPES: { value: LocationType; label: string }[] = [
  { value: 'stream', label: 'Creek / Stream' },
  { value: 'river', label: 'River' },
  { value: 'lake', label: 'Lake' },
  { value: 'reservoir', label: 'Reservoir' },
  { value: 'pond', label: 'Pond' },
];

export default function AddLocationScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { fetchLocations, setLastAddedLocationId } = useLocationStore();

  const mapRef = useRef<MapView>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [name, setName] = useState('');
  const [locationType, setLocationType] = useState<LocationType>('stream');
  const [nearbyResults, setNearbyResults] = useState<NearbyLocationResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [initialRegion, setInitialRegion] = useState<Region>(UTAH_CENTER);

  useEffect(() => {
    (async () => {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        const region: Region = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          latitudeDelta: 0.3,
          longitudeDelta: 0.3,
        };
        setInitialRegion(region);
        mapRef.current?.animateToRegion(region, 600);
      }
    })();
  }, []);

  const runNearbySearch = useCallback(async (lat: number, lng: number, searchName: string) => {
    setSearching(true);
    try {
      const results = await searchNearbyLocations(lat, lng, searchName);
      setNearbyResults(results);
    } catch {
      setNearbyResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleMapPress = useCallback((e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPin({ latitude, longitude });
    runNearbySearch(latitude, longitude, name);
  }, [name, runNearbySearch]);

  const handleMarkerDragEnd = useCallback((e: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    setPin({ latitude, longitude });
    runNearbySearch(latitude, longitude, name);
  }, [name, runNearbySearch]);

  const handleNameChange = useCallback((text: string) => {
    setName(text);
    if (pin) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = setTimeout(() => {
        runNearbySearch(pin.latitude, pin.longitude, text);
      }, 400);
    }
  }, [pin, runNearbySearch]);

  const handleSelectExisting = useCallback((locationId: string) => {
    setLastAddedLocationId(locationId);
    router.back();
  }, [router, setLastAddedLocationId]);

  const handleAddNew = useCallback(async () => {
    if (!pin || !name.trim() || !user) return;

    setSaving(true);
    try {
      const newLoc = await addCommunityLocation(
        name.trim(),
        locationType,
        pin.latitude,
        pin.longitude,
        user.id,
      );

      if (newLoc) {
        await fetchLocations();
        setLastAddedLocationId(newLoc.id);
        router.back();
      } else {
        Alert.alert('Error', 'Could not add location. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Could not add location. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [pin, name, locationType, user, fetchLocations, setLastAddedLocationId, router]);

  const canAdd = pin && name.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Name & Type Inputs */}
      <View style={styles.inputSection}>
        <TextInput
          style={styles.nameInput}
          placeholder="Location name (e.g. Hobble Creek)"
          placeholderTextColor={Colors.textTertiary}
          value={name}
          onChangeText={handleNameChange}
          returnKeyType="done"
        />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.typeRowContent}
          style={styles.typeRow}
        >
          {LOCATION_TYPES.map(t => {
            const typeColor = LocationTypeColors[t.value];
            const isActive = locationType === t.value;
            return (
              <Pressable
                key={t.value}
                style={[
                  styles.typeChip,
                  { borderLeftWidth: 3, borderLeftColor: typeColor },
                  isActive && [styles.typeChipActive, { backgroundColor: `${typeColor}18`, borderColor: typeColor }],
                ]}
                onPress={() => setLocationType(t.value)}
              >
                <Text style={[styles.typeChipText, isActive && [styles.typeChipTextActive, { color: typeColor }]]}>
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={initialRegion}
          onPress={handleMapPress}
          showsUserLocation
          showsMyLocationButton
          mapType="standard"
        >
          {pin && (
            <Marker
              coordinate={pin}
              draggable
              onDragEnd={handleMarkerDragEnd}
              pinColor={Colors.primary}
            />
          )}
        </MapView>
        {!pin && (
          <View style={styles.mapHint} pointerEvents="none">
            <View style={styles.mapHintBubble}>
              <Text style={styles.mapHintText}>Tap the map to drop a pin</Text>
            </View>
          </View>
        )}
      </View>

      {/* Bottom: nearby results + add button */}
      <View style={styles.bottomSection}>
        {searching ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.loadingText}>Checking for nearby locations...</Text>
          </View>
        ) : pin && nearbyResults.length > 0 ? (
          <ScrollView style={styles.nearbyList} keyboardShouldPersistTaps="handled">
            <Text style={styles.nearbyHeader}>Nearby — is this one of these?</Text>
            {nearbyResults.map(loc => (
              <Pressable
                key={loc.id}
                style={styles.nearbyItem}
                onPress={() => handleSelectExisting(loc.id)}
              >
                <View style={styles.nearbyInfo}>
                  <Text style={styles.nearbyName}>{loc.name}</Text>
                  <Text style={styles.nearbyMeta}>
                    {loc.distance_km < 1
                      ? `${Math.round(loc.distance_km * 1000)}m away`
                      : `${loc.distance_km.toFixed(1)}km away`}
                    {loc.status === 'community' ? ' · Community' : ''}
                  </Text>
                </View>
                <Text style={styles.useButton}>Use This</Text>
              </Pressable>
            ))}
            <Pressable
              style={[styles.addNewButton, !canAdd && styles.addNewButtonDisabled]}
              onPress={handleAddNew}
              disabled={!canAdd || saving}
            >
              {saving ? (
                <ActivityIndicator color={Colors.textInverse} />
              ) : (
                <Text style={styles.addNewButtonText}>
                  {canAdd ? `None of these — Add "${name.trim()}"` : 'Enter a name first'}
                </Text>
              )}
            </Pressable>
          </ScrollView>
        ) : pin ? (
          <View style={styles.emptyNearby}>
            <Text style={styles.emptyNearbyText}>No existing locations nearby</Text>
            <Pressable
              style={[styles.addNewButton, !canAdd && styles.addNewButtonDisabled]}
              onPress={handleAddNew}
              disabled={!canAdd || saving}
            >
              {saving ? (
                <ActivityIndicator color={Colors.textInverse} />
              ) : (
                <Text style={styles.addNewButtonText}>
                  {canAdd ? `Add "${name.trim()}"` : 'Enter a name to add'}
                </Text>
              )}
            </Pressable>
          </View>
        ) : (
          <Text style={styles.placeholderText}>
            Drop a pin to find or add a location
          </Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  inputSection: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
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
  typeRow: {
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  typeRowContent: {
    gap: Spacing.sm,
    paddingRight: Spacing.md,
  },
  typeChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  typeChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  typeChipText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  typeChipTextActive: {
    color: Colors.textInverse,
  },

  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  mapHint: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapHintBubble: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
  },
  mapHintText: {
    color: '#FFFFFF',
    fontSize: FontSize.md,
    fontWeight: '600',
  },

  bottomSection: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    maxHeight: 260,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  loadingText: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
  },
  nearbyList: {
    flexGrow: 0,
  },
  nearbyHeader: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  nearbyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  nearbyInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  nearbyName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  nearbyMeta: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  useButton: {
    fontSize: FontSize.sm,
    fontWeight: '700',
    color: Colors.primary,
  },
  addNewButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  addNewButtonDisabled: {
    backgroundColor: Colors.textTertiary,
  },
  addNewButtonText: {
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: '700',
  },
  emptyNearby: {
    alignItems: 'center',
  },
  emptyNearbyText: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginBottom: Spacing.xs,
  },
  placeholderText: {
    fontSize: FontSize.md,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingVertical: Spacing.sm,
  },
});
