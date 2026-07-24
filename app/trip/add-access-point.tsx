import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ExpoLocation from 'expo-location';
import { CatchPinPickerMap } from '@/src/components/map/CatchPinPickerMap';
import { DEFAULT_MAP_CENTER } from '@/src/constants/mapDefaults';
import { Colors, Spacing, FontSize, BorderRadius } from '@/src/constants/theme';
import { useLocationStore } from '@/src/stores/locationStore';
import { useAuthStore } from '@/src/stores/authStore';
import { createAccessPoint } from '@/src/services/accessPointService';

export default function AddAccessPointScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ locationId?: string }>();
  const locationId = params.locationId ? String(params.locationId) : '';
  const { user } = useAuthStore();
  const { getLocationById, fetchLocations, locations } = useLocationStore();

  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const parentLocation = locationId ? getLocationById(locationId) : undefined;

  const mapFallbackCenter: [number, number] = useMemo(() => {
    if (
      parentLocation?.latitude != null &&
      parentLocation?.longitude != null &&
      Number.isFinite(parentLocation.latitude) &&
      Number.isFinite(parentLocation.longitude)
    ) {
      return [parentLocation.longitude, parentLocation.latitude];
    }
    return DEFAULT_MAP_CENTER;
  }, [parentLocation?.latitude, parentLocation?.longitude]);

  useEffect(() => {
    if (locations.length === 0) fetchLocations();
  }, [locations.length, fetchLocations]);

  useEffect(() => {
    const loc = parentLocation;
    if (loc?.latitude != null && loc.longitude != null) {
      setPin({ latitude: loc.latitude, longitude: loc.longitude });
      setFocusNonce((n) => n + 1);
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
        setPin({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        setFocusNonce((n) => n + 1);
      }
    })();
  }, [parentLocation]);

  const handleSave = useCallback(async () => {
    if (!pin || !user || !locationId) return;
    setSaving(true);
    try {
      // Name is optional — default to "{River} access".
      const finalName =
        name.trim() || (parentLocation?.name ? `${parentLocation.name} access` : 'Access point');
      const row = await createAccessPoint({
        locationId,
        name: finalName,
        latitude: pin.latitude,
        longitude: pin.longitude,
        userId: user.id,
      });
      if (row) {
        Alert.alert(
          'Access point added',
          "It's on the map now. If you're offline, it'll sync automatically when you reconnect.",
          [{ text: 'OK', onPress: () => router.back() }],
        );
      } else {
        Alert.alert('Error', 'Could not save. Try again.');
      }
    } catch {
      Alert.alert('Error', 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }, [pin, name, user, locationId, parentLocation?.name, router]);

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

  // Name is optional for access points — only a pin is required.
  const canSave = Boolean(pin);

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
          Mark a trailhead, parking area, or boat ramp — not a secret fishing lie. A name is optional.
        </Text>
        <TextInput
          style={styles.nameInput}
          placeholder={
            parentLocation?.name
              ? `Optional — defaults to "${parentLocation.name} access"`
              : 'Access name (optional)'
          }
          placeholderTextColor={Colors.textTertiary}
          value={name}
          onChangeText={setName}
          returnKeyType="done"
        />
      </View>

      <View style={styles.mapContainer}>
        <CatchPinPickerMap
          latitude={pin?.latitude ?? null}
          longitude={pin?.longitude ?? null}
          onCoordinateChange={(lat, lng) => setPin({ latitude: lat, longitude: lng })}
          interactionMode="pan_center"
          focusRequestKey={focusNonce}
          mapFallbackCenter={mapFallbackCenter}
          containerStyle={styles.map}
          hintPosition="below"
          hintText="Pan and zoom to place the access point. The pin marks the map center."
        />
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
  mapContainer: { flex: 1, minHeight: 0 },
  map: { flex: 1, minHeight: 0 },
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
