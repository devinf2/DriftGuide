import { useCallback, useMemo, useState, useEffect, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image as RNImage,
  Dimensions,
  TextInput,
  Alert,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore } from '@/src/stores/authStore';
import { Colors, Spacing, FontSize, BorderRadius } from '@/src/constants/theme';
import { fetchPhotosWithTrip, addPhoto, PhotoWithTrip } from '@/src/services/photoService';
import { fetchTripsFromCloud } from '@/src/services/sync';
import { Trip } from '@/src/types';
import { format } from 'date-fns';
import * as ImagePicker from 'expo-image-picker';

const NUM_COLS = 3;
const GAP = Spacing.sm;
const THUMB_SIZE =
  (Dimensions.get('window').width - Spacing.xl * 2 - GAP * (NUM_COLS - 1)) / NUM_COLS;

export default function PhotoLibraryScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const { user } = useAuthStore();
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

  const loadPhotos = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const list = await fetchPhotosWithTrip(user.id);
      setPhotos(list);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  useEffect(() => {
    if (!addPhotoUri || !user?.id) return;
    let cancelled = false;
    setAddPhotoTripsLoading(true);
    fetchTripsFromCloud(user.id).then((trips) => {
      if (!cancelled) setAddPhotoTrips(trips);
    }).finally(() => {
      if (!cancelled) setAddPhotoTripsLoading(false);
    });
    return () => { cancelled = true; };
  }, [addPhotoUri, user?.id]);

  const locations = useMemo(() => {
    const map = new Map<string, string>();
    photos.forEach((p) => {
      const loc = (p as PhotoWithTrip).trip?.location;
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
        const tripLocId = (p as PhotoWithTrip).trip?.location?.id;
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
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);
  const toggleFly = useCallback((fly: string) => {
    setSelectedFlyPatterns((prev) =>
      prev.includes(fly) ? prev.filter((x) => x !== fly) : [...prev, fly]
    );
  }, []);
  const toggleSpecies = useCallback((species: string) => {
    setSelectedSpecies((prev) =>
      prev.includes(species) ? prev.filter((x) => x !== species) : [...prev, species]
    );
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => setFilterModalVisible(true)}
          style={styles.headerFilterButton}
          hitSlop={12}
        >
          <MaterialCommunityIcons
            name={hasActiveFilters ? 'filter' : 'filter-outline'}
            size={22}
            color="#FFFFFF"
          />
          {hasActiveFilters && <View style={styles.headerFilterBadge} />}
        </Pressable>
      ),
    });
  }, [navigation, hasActiveFilters]);

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
      await addPhoto({
        userId: user.id,
        uri: addPhotoUri,
        tripId: addPhotoTripId ?? undefined,
        caption: addPhotoCaption.trim() || undefined,
        species: addPhotoSpecies.trim() || undefined,
        fly_pattern: addPhotoFlyPattern.trim() || undefined,
        fly_size: addPhotoFlySize.trim() || undefined,
        fly_color: addPhotoFlyColor.trim() || undefined,
      });
      setAddPhotoUri(null);
      await loadPhotos();
    } catch (e) {
      Alert.alert('Upload failed', (e as Error).message);
    } finally {
      setUploading(false);
    }
  }, [user?.id, addPhotoUri, addPhotoTripId, addPhotoCaption, addPhotoSpecies, addPhotoFlyPattern, addPhotoFlySize, addPhotoFlyColor, loadPhotos]);

  const handleCancelAddPhoto = useCallback(() => {
    setAddPhotoUri(null);
    setAddPhotoDropdownOpen(false);
  }, []);

  const contentStyle = {
    paddingTop: Spacing.md,
    paddingBottom: insets.bottom + 80,
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={contentStyle} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.placeholder}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : filteredPhotos.length === 0 ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="image-multiple-outline" size={48} color={Colors.textTertiary} />
            <Text style={styles.emptyText}>
              {photos.length === 0 ? 'No photos yet.' : 'No photos match the filters.'}
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {filteredPhotos.map((photo) => (
              <Pressable
                key={photo.id}
                style={styles.thumb}
                onPress={() => setSelectedPhoto(photo)}
              >
                <RNImage
                  source={{ uri: photo.url }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable
        style={[styles.fab, { bottom: insets.bottom + 16 }]}
        onPress={handlePickAddPhoto}
        disabled={uploading}
      >
        {uploading ? (
          <ActivityIndicator size="small" color={Colors.textInverse} />
        ) : (
          <MaterialCommunityIcons name="plus" size={28} color={Colors.textInverse} />
        )}
      </Pressable>

      {/* Add photo details modal */}
      <Modal visible={!!addPhotoUri} transparent animationType="fade">
        <Pressable style={styles.addPhotoModalOverlay} onPress={() => setAddPhotoDropdownOpen(false)}>
          <View style={styles.addPhotoModal}>
            <Text style={styles.addPhotoModalTitle}>Photo details</Text>
            <ScrollView style={styles.addPhotoModalScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.filterLabel}>Caption (optional)</Text>
              <TextInput
                style={styles.addPhotoModalInput}
                placeholder="Add a caption"
                placeholderTextColor={Colors.textTertiary}
                value={addPhotoCaption}
                onChangeText={setAddPhotoCaption}
              />
              <Text style={styles.filterLabel}>Species (optional)</Text>
              <TextInput
                style={styles.addPhotoModalInput}
                placeholder="e.g. Brown Trout"
                placeholderTextColor={Colors.textTertiary}
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
                  color={Colors.textSecondary}
                />
              </Pressable>
              {addPhotoDropdownOpen && (
                <ScrollView style={styles.dropdownOptions} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  <Pressable
                    style={styles.dropdownOptionRow}
                    onPress={() => { setAddPhotoTripId(null); setAddPhotoDropdownOpen(false); }}
                  >
                    <Text style={styles.dropdownOptionText}>None</Text>
                  </Pressable>
                  {addPhotoTripsLoading ? (
                    <ActivityIndicator size="small" color={Colors.primary} style={{ padding: Spacing.md }} />
                  ) : (
                    addPhotoTrips.map((t) => (
                      <Pressable
                        key={t.id}
                        style={styles.dropdownOptionRow}
                        onPress={() => { setAddPhotoTripId(t.id); setAddPhotoDropdownOpen(false); }}
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
                placeholderTextColor={Colors.textTertiary}
                value={addPhotoFlyPattern}
                onChangeText={setAddPhotoFlyPattern}
              />
              <Text style={styles.filterLabel}>Fly size (optional)</Text>
              <TextInput
                style={styles.addPhotoModalInput}
                placeholder="e.g. 14"
                placeholderTextColor={Colors.textTertiary}
                value={addPhotoFlySize}
                onChangeText={setAddPhotoFlySize}
                keyboardType="numeric"
              />
              <Text style={styles.filterLabel}>Fly color (optional)</Text>
              <TextInput
                style={styles.addPhotoModalInput}
                placeholder="e.g. Tan"
                placeholderTextColor={Colors.textTertiary}
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
                  <ActivityIndicator size="small" color={Colors.textInverse} />
                ) : (
                  <Text style={styles.addPhotoModalSaveText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Filter modal */}
      <Modal
        visible={filterModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => { setFilterModalVisible(false); setOpenDropdown(null); }}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => { setFilterModalVisible(false); setOpenDropdown(null); }}
        >
          <Pressable style={styles.filterModalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.filterModalHeader}>
              <Text style={styles.filterModalTitle}>Filters</Text>
              <Pressable
                onPress={() => { setFilterModalVisible(false); setOpenDropdown(null); }}
                hitSlop={12}
              >
                <MaterialCommunityIcons name="close" size={24} color={Colors.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.filterModalBody} keyboardShouldPersistTaps="handled">
              {/* Location multi-select dropdown */}
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
                  color={Colors.textSecondary}
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
                        color={selectedLocationIds.includes(loc.id) ? Colors.primary : Colors.border}
                      />
                      <Text style={styles.dropdownOptionText}>{loc.name}</Text>
                    </Pressable>
                  ))}
                  {locations.length === 0 && (
                    <Text style={styles.dropdownEmpty}>No locations from photos yet</Text>
                  )}
                </ScrollView>
              )}

              {/* Fly multi-select dropdown */}
              <Text style={styles.filterLabel}>Fly</Text>
              <Pressable
                style={styles.dropdownTrigger}
                onPress={() => setOpenDropdown((d) => (d === 'fly' ? null : 'fly'))}
              >
                <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                  {selectedFlyPatterns.length === 0
                    ? 'All flies'
                    : selectedFlyPatterns.join(', ')}
                </Text>
                <MaterialCommunityIcons
                  name={openDropdown === 'fly' ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={Colors.textSecondary}
                />
              </Pressable>
              {openDropdown === 'fly' && (
                <ScrollView style={styles.dropdownOptions} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {flyOptions.map((fly) => (
                    <Pressable
                      key={fly}
                      style={styles.dropdownOptionRow}
                      onPress={() => toggleFly(fly)}
                    >
                      <MaterialCommunityIcons
                        name={selectedFlyPatterns.includes(fly) ? 'checkbox-marked' : 'checkbox-blank-outline'}
                        size={22}
                        color={selectedFlyPatterns.includes(fly) ? Colors.primary : Colors.border}
                      />
                      <Text style={styles.dropdownOptionText}>{fly}</Text>
                    </Pressable>
                  ))}
                  {flyOptions.length === 0 && (
                    <Text style={styles.dropdownEmpty}>No fly tags from photos yet</Text>
                  )}
                </ScrollView>
              )}

              {/* Species multi-select dropdown */}
              <Text style={styles.filterLabel}>Species</Text>
              <Pressable
                style={styles.dropdownTrigger}
                onPress={() => setOpenDropdown((d) => (d === 'species' ? null : 'species'))}
              >
                <Text style={styles.dropdownTriggerText} numberOfLines={1}>
                  {selectedSpecies.length === 0
                    ? 'All species'
                    : selectedSpecies.join(', ')}
                </Text>
                <MaterialCommunityIcons
                  name={openDropdown === 'species' ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={Colors.textSecondary}
                />
              </Pressable>
              {openDropdown === 'species' && (
                <ScrollView style={styles.dropdownOptions} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                  {speciesOptions.map((sp) => (
                    <Pressable
                      key={sp}
                      style={styles.dropdownOptionRow}
                      onPress={() => toggleSpecies(sp)}
                    >
                      <MaterialCommunityIcons
                        name={selectedSpecies.includes(sp) ? 'checkbox-marked' : 'checkbox-blank-outline'}
                        size={22}
                        color={selectedSpecies.includes(sp) ? Colors.primary : Colors.border}
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
                  placeholderTextColor={Colors.textTertiary}
                  value={dateFrom}
                  onChangeText={setDateFrom}
                />
                <Text style={styles.dateSep}>–</Text>
                <TextInput
                  style={styles.dateInput}
                  placeholder="To (YYYY-MM-DD)"
                  placeholderTextColor={Colors.textTertiary}
                  value={dateTo}
                  onChangeText={setDateTo}
                />
              </View>
            </ScrollView>
            <View style={styles.filterModalFooter}>
              <Pressable
                style={styles.applyButton}
                onPress={() => { setFilterModalVisible(false); setOpenDropdown(null); }}
              >
                <Text style={styles.applyButtonText}>Apply</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Full-screen photo view — scrollable so photo and metadata aren't cut off */}
      <Modal
        visible={selectedPhoto != null}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <View style={[styles.fullScreenPhoto, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <Pressable
            style={[styles.fullScreenClose, { top: insets.top + Spacing.sm }]}
            onPress={() => setSelectedPhoto(null)}
          >
            <MaterialCommunityIcons name="close" size={28} color={Colors.textInverse} />
          </Pressable>
          {selectedPhoto && (
            <ScrollView
              style={styles.fullScreenScroll}
              contentContainerStyle={[styles.fullScreenScrollContent, { paddingBottom: insets.bottom + Spacing.xl }]}
              showsVerticalScrollIndicator={false}
            >
              <RNImage
                source={{ uri: selectedPhoto.url }}
                style={[styles.fullScreenImage, { width: winWidth, height: Math.round(winHeight * 0.55) }]}
                resizeMode="contain"
              />
              <View style={styles.photoInfo}>
                {(selectedPhoto as PhotoWithTrip).trip?.location?.name ? (
                  <Text style={styles.photoInfoRow}>
                    <MaterialCommunityIcons name="map-marker" size={16} color={Colors.textInverse} />{' '}
                    {(selectedPhoto as PhotoWithTrip).trip?.location?.name}
                  </Text>
                ) : null}
                {(selectedPhoto.fly_pattern || selectedPhoto.fly_size || selectedPhoto.fly_color) ? (
                  <Text style={styles.photoInfoRow}>
                    <MaterialCommunityIcons name="hook" size={16} color={Colors.textInverse} />{' '}
                    {[selectedPhoto.fly_pattern, selectedPhoto.fly_size ? `#${selectedPhoto.fly_size}` : null, selectedPhoto.fly_color].filter(Boolean).join(' ')}
                  </Text>
                ) : null}
                {(selectedPhoto.captured_at || selectedPhoto.created_at) ? (
                  <Text style={styles.photoInfoRow}>
                    <MaterialCommunityIcons name="calendar" size={16} color={Colors.textInverse} />{' '}
                    {format(new Date(selectedPhoto.captured_at || selectedPhoto.created_at!), 'MMM d, yyyy')}
                  </Text>
                ) : null}
                {selectedPhoto.species ? (
                  <Text style={styles.photoInfoRow}>
                    <MaterialCommunityIcons name="fish" size={16} color={Colors.textInverse} />{' '}
                    {selectedPhoto.species}
                  </Text>
                ) : null}
                {selectedPhoto.caption ? (
                  <Text style={styles.photoInfoCaption}>{selectedPhoto.caption}</Text>
                ) : null}
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerFilterButton: {
    padding: Spacing.sm,
    marginRight: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerFilterBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
    marginLeft: 2,
  },
  scroll: {
    flex: 1,
  },
  placeholder: {
    minHeight: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    minHeight: 200,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emptyText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    paddingHorizontal: Spacing.xl,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: BorderRadius.md,
    overflow: 'hidden',
  },
  fab: {
    position: 'absolute',
    right: Spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
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
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 360,
    maxHeight: '85%',
  },
  addPhotoModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  addPhotoModalScroll: {
    maxHeight: 320,
    marginBottom: Spacing.sm,
  },
  addPhotoModalInput: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
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
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  addPhotoModalCancelText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  addPhotoModalSave: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
    minHeight: 40,
  },
  addPhotoModalSaveDisabled: {
    opacity: 0.7,
  },
  addPhotoModalSaveText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textInverse,
  },
  filterModalCard: {
    backgroundColor: Colors.surface,
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
    borderBottomColor: Colors.border,
  },
  filterModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  filterModalBody: {
    maxHeight: 400,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  filterLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  dropdownTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.xs,
  },
  dropdownTriggerText: {
    fontSize: FontSize.md,
    color: Colors.text,
    flex: 1,
    marginRight: Spacing.sm,
  },
  dropdownOptions: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
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
    color: Colors.text,
    flex: 1,
  },
  dropdownEmpty: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
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
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    fontSize: FontSize.sm,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dateSep: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  filterModalFooter: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  applyButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textInverse,
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
    color: Colors.textInverse,
    marginBottom: Spacing.xs,
  },
  photoInfoCaption: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginTop: Spacing.xs,
  },
});
