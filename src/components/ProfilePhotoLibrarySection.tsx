import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import {
  addPhoto,
  deletePhoto,
  fetchPhotosWithTrip,
  PhotoQueuedOfflineError,
  type PhotoWithTrip,
} from '@/src/services/photoService';
import { fetchTripsFromCloud } from '@/src/services/sync';
import { useAuthStore } from '@/src/stores/authStore';
import type { Trip } from '@/src/types';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { format } from 'date-fns';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { OfflineTripPhotoImage } from '@/src/components/OfflineTripPhotoImage';
import { getPinnedTripIds } from '@/src/services/tripPhotoOfflineCache';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useEffectiveSafeTopInset } from '@/src/hooks/useEffectiveSafeTopInset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const NUM_COLS = 3;
/** Tighter grid; must match profile tab horizontal scroll padding. */
const GRID_GAP = Spacing.xs;
const GRID_H_INSET = Spacing.md;

function formatPhotoThumbDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return format(d, 'MMM d');
  } catch {
    return null;
  }
}

type ProfilePhotoLibrarySectionProps = {
  /** Increment to reload the grid (e.g. parent pull-to-refresh). */
  refreshSignal?: number;
  /** When set, loads that user’s album (RLS). Read-only: no add/delete. */
  peerUserId?: string | null;
};

export function ProfilePhotoLibrarySection({ refreshSignal = 0, peerUserId = null }: ProfilePhotoLibrarySectionProps) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createProfilePhotoLibraryStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const effectiveTop = useEffectiveSafeTopInset();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const { user } = useAuthStore();
  const { isConnected } = useNetworkStatus();
  const albumOwnerId = peerUserId ?? user?.id ?? null;
  const readOnlyAlbum = Boolean(peerUserId && user?.id && peerUserId !== user.id);

  const thumbSize = useMemo(
    () => (winWidth - GRID_H_INSET * 2 - GRID_GAP * (NUM_COLS - 1)) / NUM_COLS,
    [winWidth],
  );

  const [photos, setPhotos] = useState<PhotoWithTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [selectedFlyPatterns, setSelectedFlyPatterns] = useState<string[]>([]);
  const [selectedSpecies, setSelectedSpecies] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<'location' | 'fly' | 'species' | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoWithTrip | null>(null);
  const [addPhotoUri, setAddPhotoUri] = useState<string | null>(null);
  const [addPhotoCaption, setAddPhotoCaption] = useState('');
  const [addPhotoSpecies, setAddPhotoSpecies] = useState('');
  const [addPhotoTripId, setAddPhotoTripId] = useState<string | null>(null);
  const [addPhotoFlyPattern, setAddPhotoFlyPattern] = useState('');
  const [addPhotoFlySize, setAddPhotoFlySize] = useState('');
  const [addPhotoFlyColor, setAddPhotoFlyColor] = useState('');
  const [addPhotoTrips, setAddPhotoTrips] = useState<Trip[]>([]);
  const [addPhotoTripsLoading, setAddPhotoTripsLoading] = useState(false);
  const [addPhotoDropdownOpen, setAddPhotoDropdownOpen] = useState(false);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [hasTripsSavedForOffline, setHasTripsSavedForOffline] = useState(false);

  const loadPhotos = useCallback(async () => {
    if (!albumOwnerId) return;
    setLoading(true);
    try {
      const pinnedIds = await getPinnedTripIds();
      setHasTripsSavedForOffline(pinnedIds.length > 0);
      if (!isConnected) {
        setPhotos([]);
        return;
      }
      const list = await fetchPhotosWithTrip(albumOwnerId);
      setPhotos(list);
    } catch (e) {
      if (!isConnected) {
        setPhotos([]);
      } else {
        Alert.alert('Error', (e as Error).message);
        setPhotos([]);
      }
    } finally {
      setLoading(false);
    }
  }, [albumOwnerId, isConnected]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  useFocusEffect(
    useCallback(() => {
      loadPhotos();
    }, [loadPhotos]),
  );

  useEffect(() => {
    if (refreshSignal === 0) return;
    void loadPhotos();
  }, [refreshSignal, loadPhotos]);

  useEffect(() => {
    if (!addPhotoUri || !user?.id || readOnlyAlbum) return;
    let cancelled = false;
    setAddPhotoTripsLoading(true);
    fetchTripsFromCloud(user.id)
      .then((trips) => {
        if (!cancelled) setAddPhotoTrips(trips);
      })
      .finally(() => {
        if (!cancelled) setAddPhotoTripsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [addPhotoUri, user?.id, readOnlyAlbum]);

  const locations = useMemo(() => {
    const map = new Map<string, string>();
    photos.forEach((p) => {
      const loc = p.trip?.location;
      if (loc?.id && loc?.name) map.set(loc.id, loc.name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [photos]);

  const flyOptions = useMemo(() => {
    const set = new Set<string>();
    photos.forEach((p) => {
      if (p.fly_pattern?.trim()) set.add(p.fly_pattern.trim());
    });
    return Array.from(set).sort();
  }, [photos]);

  const speciesOptions = useMemo(() => {
    const set = new Set<string>();
    photos.forEach((p) => {
      if (p.species?.trim()) set.add(p.species.trim());
    });
    return Array.from(set).sort();
  }, [photos]);

  const filteredPhotos = useMemo(() => {
    return photos.filter((p) => {
      if (selectedLocationIds.length > 0) {
        const tripLocId = p.trip?.location?.id;
        if (!tripLocId || !selectedLocationIds.includes(tripLocId)) return false;
      }
      if (selectedFlyPatterns.length > 0) {
        const fp = (p.fly_pattern ?? '').trim();
        if (!fp || !selectedFlyPatterns.includes(fp)) return false;
      }
      if (selectedSpecies.length > 0) {
        const sp = (p.species ?? '').trim();
        if (!sp || !selectedSpecies.includes(sp)) return false;
      }
      const dateStr = p.captured_at ?? p.created_at ?? '';
      if (dateFrom.trim()) {
        if (!dateStr || dateStr < dateFrom.trim()) return false;
      }
      if (dateTo.trim()) {
        const to = dateTo.trim();
        const toEnd = to.length === 10 ? `${to}T23:59:59` : to;
        if (!dateStr || dateStr > toEnd) return false;
      }
      return true;
    });
  }, [photos, selectedLocationIds, selectedFlyPatterns, selectedSpecies, dateFrom, dateTo]);

  const hasActiveFilters =
    selectedLocationIds.length > 0 ||
    selectedFlyPatterns.length > 0 ||
    selectedSpecies.length > 0 ||
    dateFrom.trim() !== '' ||
    dateTo.trim() !== '';

  const toggleLocation = useCallback((id: string) => {
    setSelectedLocationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);
  const toggleFly = useCallback((fly: string) => {
    setSelectedFlyPatterns((prev) =>
      prev.includes(fly) ? prev.filter((x) => x !== fly) : [...prev, fly],
    );
  }, []);
  const toggleSpecies = useCallback((species: string) => {
    setSelectedSpecies((prev) =>
      prev.includes(species) ? prev.filter((x) => x !== species) : [...prev, species],
    );
  }, []);

  const handlePickAddPhoto = useCallback(async () => {
    if (!user?.id) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to add photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setAddPhotoCaption('');
    setAddPhotoSpecies('');
    setAddPhotoTripId(null);
    setAddPhotoFlyPattern('');
    setAddPhotoFlySize('');
    setAddPhotoFlyColor('');
    setAddPhotoUri(result.assets[0].uri);
  }, [user?.id]);

  const handleSaveAddPhoto = useCallback(async () => {
    if (!user?.id || !addPhotoUri) return;
    setUploading(true);
    try {
      await addPhoto(
        {
          userId: user.id,
          uri: addPhotoUri,
          tripId: addPhotoTripId ?? undefined,
          caption: addPhotoCaption.trim() || undefined,
          species: addPhotoSpecies.trim() || undefined,
          fly_pattern: addPhotoFlyPattern.trim() || undefined,
          fly_size: addPhotoFlySize.trim() || undefined,
          fly_color: addPhotoFlyColor.trim() || undefined,
        },
        { isOnline: isConnected },
      );
      setAddPhotoUri(null);
      await loadPhotos();
    } catch (e) {
      if (e instanceof PhotoQueuedOfflineError) {
        Alert.alert('Saved on device', "Photo will upload when you're back online.");
        setAddPhotoUri(null);
      } else {
        Alert.alert('Upload failed', (e as Error).message);
      }
    } finally {
      setUploading(false);
    }
  }, [
    user?.id,
    addPhotoUri,
    addPhotoTripId,
    addPhotoCaption,
    addPhotoSpecies,
    addPhotoFlyPattern,
    addPhotoFlySize,
    addPhotoFlyColor,
    loadPhotos,
    isConnected,
  ]);

  const handleCancelAddPhoto = useCallback(() => {
    setAddPhotoUri(null);
    setAddPhotoDropdownOpen(false);
  }, []);

  const handleConfirmDeletePhoto = useCallback(
    (photo: PhotoWithTrip) => {
      if (!user?.id) return;
      if (!isConnected) {
        Alert.alert('Offline', 'Connect to the internet to delete photos from your library.');
        return;
      }
      Alert.alert(
        'Delete photo?',
        'This removes the photo from your library and cloud storage. This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                setDeletingPhotoId(photo.id);
                try {
                  await deletePhoto(photo.id, user.id);
                  setSelectedPhoto(null);
                  setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
                } catch (e) {
                  Alert.alert('Could not delete', (e as Error).message);
                } finally {
                  setDeletingPhotoId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [user?.id, isConnected],
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Photos</Text>
        <View style={styles.sectionHeaderActions}>
          <Pressable
            onPress={() => setFilterModalVisible(true)}
            style={styles.headerIconBtn}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Filter photos"
          >
            <View style={styles.filterIconWrap}>
              <MaterialCommunityIcons
                name={hasActiveFilters ? 'filter' : 'filter-outline'}
                size={20}
                color={colors.primary}
              />
              {hasActiveFilters ? <View style={styles.filterBadge} /> : null}
            </View>
          </Pressable>
          {!readOnlyAlbum ? (
            <Pressable
              onPress={handlePickAddPhoto}
              style={styles.headerIconBtn}
              hitSlop={12}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel="Add photo"
            >
              {uploading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <MaterialCommunityIcons name="plus-circle-outline" size={22} color={colors.primary} />
              )}
            </Pressable>
          ) : null}
        </View>
      </View>
      {readOnlyAlbum ? (
        <Text style={styles.peerAlbumHint}>Trip photos they chose to show on their profile.</Text>
      ) : null}

      {loading ? (
        <View style={styles.placeholder}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : filteredPhotos.length === 0 ? (
        <View style={styles.empty}>
          <MaterialCommunityIcons name="image-multiple-outline" size={48} color={colors.textTertiary} />
          <Text style={styles.emptyText}>
            {!isConnected && photos.length === 0
              ? hasTripsSavedForOffline
                ? "You're offline. Open a trip from your journal to view photos saved for offline."
                : 'No photos downloaded for offline use.'
              : photos.length === 0
                ? 'No photos yet.'
                : 'No photos match the filters.'}
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {filteredPhotos.map((photo) => {
            const dateLabel = formatPhotoThumbDate(photo.captured_at ?? photo.created_at);
            return (
              <Pressable
                key={photo.id}
                style={[styles.thumb, { width: thumbSize, height: thumbSize }]}
                onPress={() => setSelectedPhoto(photo)}
              >
                <OfflineTripPhotoImage
                  remoteUri={photo.url}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
                {dateLabel ? (
                  <View style={styles.dateBanner} pointerEvents="none">
                    <Text style={styles.dateBannerText} numberOfLines={1}>
                      {dateLabel}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}

      <Modal visible={!!addPhotoUri} transparent animationType="fade">
        <Pressable style={styles.addPhotoModalOverlay} onPress={() => setAddPhotoDropdownOpen(false)}>
          <View style={styles.addPhotoModal}>
            <Text style={styles.addPhotoModalTitle}>Photo details</Text>
            <ScrollView style={styles.addPhotoModalScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.filterLabel}>Caption (optional)</Text>
              <TextInput
                style={styles.addPhotoModalInput}
                placeholder="Add a caption"
                placeholderTextColor={colors.textTertiary}
                value={addPhotoCaption}
                onChangeText={setAddPhotoCaption}
              />
              <Text style={styles.filterLabel}>Species (optional)</Text>
              <TextInput
                style={styles.addPhotoModalInput}
                placeholder="e.g. Brown Trout"
                placeholderTextColor={colors.textTertiary}
                value={addPhotoSpecies}
                onChangeText={setAddPhotoSpecies}
              />
              <Text style={styles.filterLabel}>Trip (optional)</Text>
              <Pressable
                style={styles.dropdownTrigger}
                onPress={() => setAddPhotoDropdownOpen((o) => !o)}
              >
                <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                  {addPhotoTripId == null
                    ? 'None'
                    : addPhotoTrips.find((t) => t.id === addPhotoTripId)?.location?.name ?? 'Trip'}
                </Text>
                <MaterialCommunityIcons
                  name={addPhotoDropdownOpen ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.textSecondary}
                />
              </Pressable>
              {addPhotoDropdownOpen && (
                <ScrollView style={styles.dropdownOptions} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  <Pressable
                    style={styles.dropdownOptionRow}
                    onPress={() => {
                      setAddPhotoTripId(null);
                      setAddPhotoDropdownOpen(false);
                    }}
                  >
                    <Text style={styles.dropdownOptionText}>None</Text>
                  </Pressable>
                  {addPhotoTripsLoading ? (
                    <ActivityIndicator size="small" color={colors.primary} style={{ padding: Spacing.md }} />
                  ) : (
                    addPhotoTrips.map((t) => (
                      <Pressable
                        key={t.id}
                        style={styles.dropdownOptionRow}
                        onPress={() => {
                          setAddPhotoTripId(t.id);
                          setAddPhotoDropdownOpen(false);
                        }}
                      >
                        <Text style={styles.dropdownOptionText}>{t.location?.name ?? 'Trip'}</Text>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              )}
              <Text style={styles.filterLabel}>Fly pattern (optional)</Text>
              <TextInput
                style={styles.addPhotoModalInput}
                placeholder="e.g. Elk Hair Caddis"
                placeholderTextColor={colors.textTertiary}
                value={addPhotoFlyPattern}
                onChangeText={setAddPhotoFlyPattern}
              />
              <Text style={styles.filterLabel}>Fly size (optional)</Text>
              <TextInput
                style={styles.addPhotoModalInput}
                placeholder="e.g. 14"
                placeholderTextColor={colors.textTertiary}
                value={addPhotoFlySize}
                onChangeText={setAddPhotoFlySize}
                keyboardType="numeric"
              />
              <Text style={styles.filterLabel}>Fly color (optional)</Text>
              <TextInput
                style={styles.addPhotoModalInput}
                placeholder="e.g. Tan"
                placeholderTextColor={colors.textTertiary}
                value={addPhotoFlyColor}
                onChangeText={setAddPhotoFlyColor}
              />
            </ScrollView>
            <View style={styles.addPhotoModalButtons}>
              <Pressable style={styles.addPhotoModalCancel} onPress={handleCancelAddPhoto}>
                <Text style={styles.addPhotoModalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.addPhotoModalSave, uploading && styles.addPhotoModalSaveDisabled]}
                onPress={handleSaveAddPhoto}
                disabled={uploading}
              >
                {uploading ? (
                  <ActivityIndicator size="small" color={colors.textInverse} />
                ) : (
                  <Text style={styles.addPhotoModalSaveText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={filterModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setFilterModalVisible(false);
          setOpenDropdown(null);
        }}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => {
            setFilterModalVisible(false);
            setOpenDropdown(null);
          }}
        >
          <Pressable style={styles.filterModalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>Filters</Text>
              <Pressable
                onPress={() => {
                  setFilterModalVisible(false);
                  setOpenDropdown(null);
                }}
                hitSlop={12}
              >
                <MaterialCommunityIcons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.filterModalBody} keyboardShouldPersistTaps="handled">
              <Text style={styles.filterLabel}>Location</Text>
              <Pressable
                style={styles.dropdownTrigger}
                onPress={() => setOpenDropdown((d) => (d === 'location' ? null : 'location'))}
              >
                <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                  {selectedLocationIds.length === 0
                    ? 'All locations'
                    : locations
                        .filter((l) => selectedLocationIds.includes(l.id))
                        .map((l) => l.name)
                        .join(', ')}
                </Text>
                <MaterialCommunityIcons
                  name={openDropdown === 'location' ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.textSecondary}
                />
              </Pressable>
              {openDropdown === 'location' && (
                <ScrollView style={styles.dropdownOptions} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {locations.map((loc) => (
                    <Pressable
                      key={loc.id}
                      style={styles.dropdownOptionRow}
                      onPress={() => toggleLocation(loc.id)}
                    >
                      <MaterialCommunityIcons
                        name={selectedLocationIds.includes(loc.id) ? 'checkbox-marked' : 'checkbox-blank-outline'}
                        size={22}
                        color={selectedLocationIds.includes(loc.id) ? colors.primary : colors.border}
                      />
                      <Text style={styles.dropdownOptionText}>{loc.name}</Text>
                    </Pressable>
                  ))}
                  {locations.length === 0 && (
                    <Text style={styles.dropdownEmpty}>No locations from photos yet</Text>
                  )}
                </ScrollView>
              )}

              <Text style={styles.filterLabel}>Fly</Text>
              <Pressable
                style={styles.dropdownTrigger}
                onPress={() => setOpenDropdown((d) => (d === 'fly' ? null : 'fly'))}
              >
                <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                  {selectedFlyPatterns.length === 0 ? 'All flies' : selectedFlyPatterns.join(', ')}
                </Text>
                <MaterialCommunityIcons
                  name={openDropdown === 'fly' ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.textSecondary}
                />
              </Pressable>
              {openDropdown === 'fly' && (
                <ScrollView style={styles.dropdownOptions} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {flyOptions.map((fly) => (
                    <Pressable key={fly} style={styles.dropdownOptionRow} onPress={() => toggleFly(fly)}>
                      <MaterialCommunityIcons
                        name={selectedFlyPatterns.includes(fly) ? 'checkbox-marked' : 'checkbox-blank-outline'}
                        size={22}
                        color={selectedFlyPatterns.includes(fly) ? colors.primary : colors.border}
                      />
                      <Text style={styles.dropdownOptionText}>{fly}</Text>
                    </Pressable>
                  ))}
                  {flyOptions.length === 0 && (
                    <Text style={styles.dropdownEmpty}>No fly tags from photos yet</Text>
                  )}
                </ScrollView>
              )}

              <Text style={styles.filterLabel}>Species</Text>
              <Pressable
                style={styles.dropdownTrigger}
                onPress={() => setOpenDropdown((d) => (d === 'species' ? null : 'species'))}
              >
                <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                  {selectedSpecies.length === 0 ? 'All species' : selectedSpecies.join(', ')}
                </Text>
                <MaterialCommunityIcons
                  name={openDropdown === 'species' ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.textSecondary}
                />
              </Pressable>
              {openDropdown === 'species' && (
                <ScrollView style={styles.dropdownOptions} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {speciesOptions.map((sp) => (
                    <Pressable key={sp} style={styles.dropdownOptionRow} onPress={() => toggleSpecies(sp)}>
                      <MaterialCommunityIcons
                        name={selectedSpecies.includes(sp) ? 'checkbox-marked' : 'checkbox-blank-outline'}
                        size={22}
                        color={selectedSpecies.includes(sp) ? colors.primary : colors.border}
                      />
                      <Text style={styles.dropdownOptionText}>{sp}</Text>
                    </Pressable>
                  ))}
                  {speciesOptions.length === 0 && (
                    <Text style={styles.dropdownEmpty}>No species from photos yet</Text>
                  )}
                </ScrollView>
              )}

              <Text style={styles.filterLabel}>Date range</Text>
              <View style={styles.dateRow}>
                <TextInput
                  style={styles.dateInput}
                  placeholder="From (YYYY-MM-DD)"
                  placeholderTextColor={colors.textTertiary}
                  value={dateFrom}
                  onChangeText={setDateFrom}
                />
                <Text style={styles.dateSep}>–</Text>
                <TextInput
                  style={styles.dateInput}
                  placeholder="To (YYYY-MM-DD)"
                  placeholderTextColor={colors.textTertiary}
                  value={dateTo}
                  onChangeText={setDateTo}
                />
              </View>
            </ScrollView>
            <View style={styles.filterModalFooter}>
              <Pressable
                style={styles.applyButton}
                onPress={() => {
                  setFilterModalVisible(false);
                  setOpenDropdown(null);
                }}
              >
                <Text style={styles.applyButtonText}>Apply</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={selectedPhoto != null}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <View style={[styles.fullScreenPhoto, { paddingTop: effectiveTop, paddingBottom: insets.bottom }]}>
          <Pressable
            style={[styles.fullScreenClose, { top: insets.top + Spacing.sm }]}
            onPress={() => setSelectedPhoto(null)}
          >
            <MaterialCommunityIcons name="close" size={28} color={colors.textInverse} />
          </Pressable>
          {selectedPhoto && (
            <ScrollView
              style={styles.fullScreenScroll}
              contentContainerStyle={[
                styles.fullScreenScrollContent,
                { paddingBottom: insets.bottom + Spacing.xl },
              ]}
              showsVerticalScrollIndicator={false}
            >
              <OfflineTripPhotoImage
                remoteUri={selectedPhoto.url}
                style={[styles.fullScreenImage, { width: winWidth, height: Math.round(winHeight * 0.55) }]}
                contentFit="contain"
              />
              <View style={styles.photoInfo}>
                {selectedPhoto.trip?.location?.name ? (
                  <Text style={styles.photoInfoRow}>
                    <MaterialCommunityIcons name="map-marker" size={16} color={colors.textInverse} />{' '}
                    {selectedPhoto.trip.location.name}
                  </Text>
                ) : null}
                {selectedPhoto.fly_pattern || selectedPhoto.fly_size || selectedPhoto.fly_color ? (
                  <Text style={styles.photoInfoRow}>
                    <MaterialCommunityIcons name="hook" size={16} color={colors.textInverse} />{' '}
                    {[
                      selectedPhoto.fly_pattern,
                      selectedPhoto.fly_size ? `#${selectedPhoto.fly_size}` : null,
                      selectedPhoto.fly_color,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  </Text>
                ) : null}
                {selectedPhoto.captured_at || selectedPhoto.created_at ? (
                  <Text style={styles.photoInfoRow}>
                    <MaterialCommunityIcons name="calendar" size={16} color={colors.textInverse} />{' '}
                    {format(new Date(selectedPhoto.captured_at || selectedPhoto.created_at!), 'MMM d, yyyy')}
                  </Text>
                ) : null}
                {selectedPhoto.species ? (
                  <Text style={styles.photoInfoRow}>
                    <MaterialCommunityIcons name="fish" size={16} color={colors.textInverse} />{' '}
                    {selectedPhoto.species}
                  </Text>
                ) : null}
                {selectedPhoto.caption ? (
                  <Text style={styles.photoInfoCaption}>{selectedPhoto.caption}</Text>
                ) : null}
                {!readOnlyAlbum ? (
                  <Pressable
                    style={styles.deletePhotoButton}
                    onPress={() => handleConfirmDeletePhoto(selectedPhoto)}
                    disabled={deletingPhotoId === selectedPhoto.id}
                    accessibilityRole="button"
                    accessibilityLabel="Delete photo"
                  >
                    {deletingPhotoId === selectedPhoto.id ? (
                      <ActivityIndicator size="small" color={colors.error} />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} />
                        <Text style={styles.deletePhotoButtonText}>Delete photo</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

function createProfilePhotoLibraryStyles(colors: ThemeColors) {
  return StyleSheet.create({
  wrap: {
    marginTop: Spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    flex: 1,
    fontSize: FontSize.md,
    fontWeight: '700',
    color: colors.text,
  },
  peerAlbumHint: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
    marginBottom: Spacing.sm,
    lineHeight: 20,
  },
  sectionHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  headerIconBtn: {
    padding: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterIconWrap: {
    position: 'relative',
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadge: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  placeholder: {
    minHeight: 120,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    minHeight: 120,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emptyText: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },
  thumb: {
    borderRadius: BorderRadius.sm,
    overflow: 'hidden',
  },
  dateBanner: {
    position: 'absolute',
    bottom: 3,
    left: 3,
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    maxWidth: '92%',
  },
  dateBannerText: {
    color: colors.textInverse,
    fontSize: FontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  addPhotoModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  addPhotoModal: {
    backgroundColor: colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 360,
    maxHeight: '85%',
  },
  addPhotoModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: Spacing.md,
  },
  addPhotoModalScroll: {
    maxHeight: 320,
    marginBottom: Spacing.sm,
  },
  addPhotoModalInput: {
    backgroundColor: colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: Spacing.sm,
  },
  addPhotoModalButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  addPhotoModalCancel: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderRadius: BorderRadius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addPhotoModalCancelText: {
    fontSize: FontSize.md,
    color: colors.textSecondary,
  },
  addPhotoModalSave: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.md,
    backgroundColor: colors.primary,
    minHeight: 40,
  },
  addPhotoModalSaveDisabled: {
    opacity: 0.7,
  },
  addPhotoModalSaveText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.textInverse,
  },
  filterModalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    paddingBottom: 34,
    maxHeight: '80%',
  },
  filterModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  filterModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  filterModalBody: {
    maxHeight: 400,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  filterLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: Spacing.xs,
  },
  dropdownTriggerText: {
    fontSize: FontSize.md,
    color: colors.text,
    flex: 1,
    marginRight: Spacing.sm,
  },
  dropdownOptions: {
    backgroundColor: colors.background,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: Spacing.sm,
    maxHeight: 180,
    paddingVertical: Spacing.xs,
  },
  dropdownOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  dropdownOptionText: {
    fontSize: FontSize.md,
    color: colors.text,
    flex: 1,
  },
  dropdownEmpty: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
    padding: Spacing.sm,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  dateInput: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    fontSize: FontSize.sm,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateSep: {
    fontSize: FontSize.sm,
    color: colors.textSecondary,
  },
  filterModalFooter: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  applyButton: {
    backgroundColor: colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.textInverse,
  },
  fullScreenPhoto: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  fullScreenClose: {
    position: 'absolute',
    right: Spacing.lg,
    zIndex: 10,
    padding: Spacing.sm,
  },
  fullScreenScroll: {
    flex: 1,
  },
  fullScreenScrollContent: {
    flexGrow: 1,
  },
  fullScreenImage: {
    marginTop: Spacing.sm,
  },
  photoInfo: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.xs,
  },
  photoInfoRow: {
    fontSize: FontSize.md,
    color: colors.textInverse,
    marginBottom: Spacing.xs,
  },
  photoInfoCaption: {
    fontSize: FontSize.sm,
    color: colors.textTertiary,
    marginTop: Spacing.xs,
  },
  deletePhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: colors.error,
    minHeight: 44,
  },
  deletePhotoButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: colors.error,
  },
  });
}
