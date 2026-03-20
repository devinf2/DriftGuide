import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput, Alert,
  KeyboardAvoidingView, Keyboard, Platform, ActivityIndicator, Image, Dimensions,
  Modal,
} from 'react-native';
/** MapLibre requires native code; not available in Expo Go. Load optionally so trip screen still works. */
let MapView: any = null;
let Camera: any = null;
let UserLocation: any = null;
try {
  const MapLibre = require('@maplibre/maplibre-react-native');
  MapView = MapLibre.MapView;
  Camera = MapLibre.Camera;
  UserLocation = MapLibre.UserLocation;
} catch {
  // Expo Go or environment without MapLibre native module
}

import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, FontSize, BorderRadius } from '@/src/constants/theme';
import { useTripStore } from '@/src/stores/tripStore';
import { formatTripDuration, formatEventTime, formatTripDate, formatFishCount, formatFlowRate, formatTemperature } from '@/src/utils/formatters';
import { useNetworkStatus } from '@/src/hooks/useNetworkStatus';
import { FlyChangeData, TripEvent, NoteData, CatchData, AIQueryData, Fly, WaterClarity, PresentationMethod, Structure } from '@/src/types';
import * as ExpoLocation from 'expo-location';
import { getMoonPhase, MOON_PHASE_LABELS } from '@/src/utils/moonPhase';
import { MoonPhaseShape } from '@/src/components/MoonPhaseShape';
import { getHourlyForecast } from '@/src/services/weather';
import { FLY_NAMES, FLY_SIZES, FLY_COLORS, COMMON_FLIES_BY_NAME, COMMON_SPECIES as SPECIES_OPTIONS } from '@/src/constants/fishingTypes';
import { CLARITY_LABELS, CLARITY_DESCRIPTIONS, getFlowStatus, FLOW_STATUS_LABELS, FLOW_STATUS_DESCRIPTIONS, FLOW_STATUS_COLORS, buildConditionsSummary, inferClarityFromWeather } from '@/src/services/waterFlow';
import { askAI, getSeason, getTimeOfDay, getSpotFishingSummary, getSpotHowToFish } from '@/src/services/ai';
import { fetchFlies, getFliesFromCache } from '@/src/services/flyService';
import { MaterialIcons, MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { getWeatherIconName, formatSkyLabel, buildConditionsFromWeatherAndFlow } from '@/src/services/conditions';
import * as ImagePicker from 'expo-image-picker';
import { fetchPhotos, addPhoto, PhotoQueuedOfflineError } from '@/src/services/photoService';
import { savePendingPhoto, buildPendingFromAddPhotoOptions } from '@/src/services/pendingPhotoStorage';
import { Photo } from '@/src/types';
import { ConditionsTab } from '@/src/components/trip-tabs/ConditionsTab';

type TabKey = 'fish' | 'photos' | 'conditions' | 'ai' | 'map';

export default function TripDashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isConnected } = useNetworkStatus();
  const {
    activeTrip, events, fishCount, currentFly, currentFly2, nextFlyRecommendation,
    weatherData, waterFlowData, conditionsLoading, recommendationLoading,
    addCatch, removeCatch, changeFly, addNote, addBite, addFishOn, addAIQuery, endTrip,
    fetchConditions, refreshSmartRecommendation,
  } = useTripStore();

  const [activeTab, setActiveTab] = useState<TabKey>('fish');
  const [elapsed, setElapsed] = useState('0m');
  const [showFlyPicker, setShowFlyPicker] = useState(false);
  const [pickerName, setPickerName] = useState<string | null>(null);
  const [pickerSize, setPickerSize] = useState<number | null>(null);
  const [pickerColor, setPickerColor] = useState<string | null>(null);
  const [pickerName2, setPickerName2] = useState<string | null>(null);
  const [pickerSize2, setPickerSize2] = useState<number | null>(null);
  const [pickerColor2, setPickerColor2] = useState<string | null>(null);
  const [catchCaughtOnFly, setCatchCaughtOnFly] = useState<'primary' | 'dropper'>('primary');
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [noteText, setNoteText] = useState('');

  const [showCatchModal, setShowCatchModal] = useState(false);
  const [catchSpecies, setCatchSpecies] = useState('');
  const [catchSize, setCatchSize] = useState('');
  const [catchNote, setCatchNote] = useState('');
  const [catchPhotoUri, setCatchPhotoUri] = useState<string | null>(null);
  const [catchPhotoUploading, setCatchPhotoUploading] = useState(false);
  const [catchDepth, setCatchDepth] = useState('');
  const [catchFlyName, setCatchFlyName] = useState<string>('');
  const [catchFlySize, setCatchFlySize] = useState<number | null>(null);
  const [catchFlyColor, setCatchFlyColor] = useState<string | null>(null);
  const [catchFlyName2, setCatchFlyName2] = useState<string | null>(null);
  const [catchFlySize2, setCatchFlySize2] = useState<number | null>(null);
  const [catchFlyColor2, setCatchFlyColor2] = useState<string | null>(null);
  const [catchPresentation, setCatchPresentation] = useState<PresentationMethod | null>(null);
  const [catchReleased, setCatchReleased] = useState<boolean | null>(true);
  const [catchStructure, setCatchStructure] = useState<Structure | null>(null);
  const lastKnownCatchLat = useRef<number | null>(null);
  const lastKnownCatchLon = useRef<number | null>(null);

  const [tripPhotos, setTripPhotos] = useState<Photo[]>([]);
  const [tripPhotosLoading, setTripPhotosLoading] = useState(false);
  const [tripPhotoUploading, setTripPhotoUploading] = useState(false);
  const [tripPhotoUri, setTripPhotoUri] = useState<string | null>(null);
  const [tripPhotoCaption, setTripPhotoCaption] = useState('');
  const [tripPhotoSpecies, setTripPhotoSpecies] = useState('');
  /** Full-screen photo view (timeline or Photos tab) — same UX as photo library */
  const [fullScreenPhoto, setFullScreenPhoto] = useState<{
    url: string;
    location?: string;
    fly?: string;
    date?: string;
    species?: string;
    caption?: string;
  } | null>(null);

  const [aiMessages, setAiMessages] = useState<{ id: string; role: 'user' | 'ai'; text: string }[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiScrollRef = useRef<ScrollView>(null);

  const [userFlies, setUserFlies] = useState<Fly[]>([]);
  const conditionsFetched = useRef(false);
  const [mapLocation, setMapLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [mapLocationLoading, setMapLocationLoading] = useState(false);
  const [mapLocationError, setMapLocationError] = useState<string | null>(null);
  const [strategyTopFlies, setStrategyTopFlies] = useState<string[]>([]);
  const [strategyBestTime, setStrategyBestTime] = useState<string | null>(null);
  const [strategyHowToFish, setStrategyHowToFish] = useState<string | null>(null);
  const [strategyLoading, setStrategyLoading] = useState(false);

  /** Fly names for picker: from Fly Box when available, else default list */
  const flyPickerNames = userFlies.length > 0
    ? [...new Set(userFlies.map(f => f.name))].sort()
    : FLY_NAMES;

  useEffect(() => {
    if (!activeTrip) return;
    const interval = setInterval(() => {
      setElapsed(formatTripDuration(activeTrip.start_time, null));
    }, 1000);
    setElapsed(formatTripDuration(activeTrip.start_time, null));
    return () => clearInterval(interval);
  }, [activeTrip]);

  useEffect(() => {
    if (activeTrip && !conditionsFetched.current) {
      conditionsFetched.current = true;
      fetchConditions().then(() => {
        refreshSmartRecommendation();
      });
    }
  }, [activeTrip]);

  useEffect(() => {
    if (!activeTrip?.user_id) return;
    if (isConnected) {
      fetchFlies(activeTrip.user_id).then(setUserFlies).catch(() => setUserFlies([]));
    } else {
      getFliesFromCache(activeTrip.user_id).then(setUserFlies);
    }
  }, [activeTrip?.user_id, isConnected]);

  const loadTripPhotos = useCallback(async () => {
    if (!activeTrip?.id || !activeTrip?.user_id) return;
    setTripPhotosLoading(true);
    try {
      const photos = await fetchPhotos(activeTrip.user_id, { tripId: activeTrip.id });
      setTripPhotos(photos);
    } catch {
      setTripPhotos([]);
    } finally {
      setTripPhotosLoading(false);
    }
  }, [activeTrip?.id, activeTrip?.user_id]);

  useEffect(() => {
    if (activeTrip && activeTab === 'photos') loadTripPhotos();
  }, [activeTrip, activeTab, loadTripPhotos]);

  useEffect(() => {
    if (activeTab !== 'ai' || !activeTrip?.location) return;
    const loc = activeTrip.location;
    const conditions = buildConditionsFromWeatherAndFlow(weatherData, waterFlowData, loc.id)
      ?? {
        locationId: loc.id,
        sky: { condition: 'Clear', label: 'Clear', rating: 'good' as const },
        wind: { speed_mph: 0, rating: 'good' as const },
        temperature: { temp_f: 60, rating: 'good' as const },
        water: { clarity: 'unknown' as const, flow_cfs: null, rating: 'fair' as const },
        fetchedAt: new Date().toISOString(),
      };
    let cancelled = false;
    setStrategyLoading(true);
    setStrategyTopFlies([]);
    setStrategyBestTime(null);
    setStrategyHowToFish(null);
    Promise.all([
      getSpotFishingSummary(loc.name, conditions),
      getSpotHowToFish(loc.name, conditions),
    ]).then(([summary, howToFish]) => {
      if (!cancelled) {
        setStrategyTopFlies(summary.topFlies);
        setStrategyBestTime(summary.bestTime);
        setStrategyHowToFish(howToFish);
        setStrategyLoading(false);
      }
    }).catch(() => { if (!cancelled) setStrategyLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, activeTrip?.id, activeTrip?.location?.id, activeTrip?.location?.name, weatherData, waterFlowData]);

  const handlePickTripPhoto = useCallback(async () => {
    if (!activeTrip?.id) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow photo library access to add trip photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setTripPhotoCaption('');
    setTripPhotoSpecies('');
    setTripPhotoUri(result.assets[0].uri);
  }, [activeTrip?.id]);

  const handleSaveTripPhoto = useCallback(async () => {
    if (!activeTrip?.id || !tripPhotoUri) return;
    setTripPhotoUploading(true);
    try {
      await addPhoto(
        {
          userId: activeTrip.user_id,
          tripId: activeTrip.id,
          uri: tripPhotoUri,
          caption: tripPhotoCaption.trim() || undefined,
          species: tripPhotoSpecies.trim() || undefined,
          fly_pattern: currentFly?.pattern ?? undefined,
          fly_size: currentFly?.size ?? undefined,
          fly_color: currentFly?.color ?? undefined,
          fly_id: currentFly?.fly_id ?? undefined,
          captured_at: new Date().toISOString(),
        },
        { isOnline: isConnected },
      );
      setTripPhotoUri(null);
      await loadTripPhotos();
    } catch (e) {
      if (e instanceof PhotoQueuedOfflineError) {
        Alert.alert('Saved on device', 'Photo will upload when you\'re back online.');
        setTripPhotoUri(null);
      } else {
        Alert.alert('Upload failed', (e as Error).message);
      }
    } finally {
      setTripPhotoUploading(false);
    }
  }, [activeTrip?.id, activeTrip?.user_id, tripPhotoUri, tripPhotoCaption, tripPhotoSpecies, currentFly, loadTripPhotos, isConnected]);

  const handleCancelTripPhoto = useCallback(() => {
    setTripPhotoUri(null);
    setTripPhotoCaption('');
    setTripPhotoSpecies('');
  }, []);

  const handleCatchPhotoPress = useCallback((event: TripEvent) => {
    const data = event.data as CatchData;
    if (!data?.photo_url) return;
    setFullScreenPhoto({
      url: data.photo_url,
      location: activeTrip?.location?.name ?? undefined,
      date: formatTripDate(event.timestamp),
      species: data.species ?? undefined,
      caption: data.note ?? undefined,
    });
  }, [activeTrip?.location?.name]);

  const handleTripPhotoPress = useCallback((photo: Photo) => {
    setFullScreenPhoto({
      url: photo.url,
      location: activeTrip?.location?.name ?? undefined,
      fly: [photo.fly_pattern, photo.fly_size ? `#${photo.fly_size}` : null, photo.fly_color].filter(Boolean).join(' ') || undefined,
      date: (photo.captured_at || photo.created_at) ? formatTripDate(photo.captured_at || photo.created_at!) : undefined,
      species: photo.species ?? undefined,
      caption: photo.caption ?? undefined,
    });
  }, [activeTrip?.location?.name]);

  /** Presentation for current fly: from user fly box or COMMON_FLIES. */
  const getPresentationForCurrentFly = useCallback((): PresentationMethod | null => {
    if (!currentFly?.pattern) return null;
    const match = userFlies.find(
      (f) =>
        f.name === currentFly!.pattern &&
        (f.size ?? null) === (currentFly!.size ?? null) &&
        (f.color ?? null) === (currentFly!.color ?? null)
    );
    const pres = match?.presentation ?? COMMON_FLIES_BY_NAME[currentFly.pattern]?.presentation ?? null;
    if (!pres) return null;
    return pres === 'emerger' ? 'other' : (pres as PresentationMethod);
  }, [currentFly, userFlies]);

  /** Presentation for a fly by name/size/color (e.g. catch modal primary fly). */
  const getPresentationForFly = useCallback(
    (name: string, size: number | null, color: string | null): PresentationMethod | null => {
      if (!name?.trim()) return null;
      const match = userFlies.find(
        (f) =>
          f.name === name.trim() &&
          (f.size ?? null) === (size ?? null) &&
          (f.color ?? null) === (color ?? null)
      );
      const pres = match?.presentation ?? COMMON_FLIES_BY_NAME[name.trim()]?.presentation ?? null;
      if (!pres) return null;
      return pres === 'emerger' ? 'other' : (pres as PresentationMethod);
    },
    [userFlies]
  );

  useEffect(() => {
    if (showCatchModal && catchFlyName?.trim()) {
      setCatchPresentation(getPresentationForFly(catchFlyName, catchFlySize, catchFlyColor));
    }
  }, [showCatchModal, catchFlyName, catchFlySize, catchFlyColor, getPresentationForFly]);

  const handleFishPlus = useCallback(() => {
    setCatchCaughtOnFly('primary');
    setCatchPresentation(getPresentationForCurrentFly());
    setCatchFlyName(currentFly?.pattern ?? flyPickerNames[0] ?? '');
    setCatchFlySize(currentFly?.size ?? null);
    setCatchFlyColor(currentFly?.color ?? null);
    setCatchFlyName2(currentFly2?.pattern ?? null);
    setCatchFlySize2(currentFly2?.size ?? null);
    setCatchFlyColor2(currentFly2?.color ?? null);
    setShowCatchModal(true);
  }, [getPresentationForCurrentFly, currentFly, currentFly2, flyPickerNames]);

  const handlePickCatchPhoto = useCallback(async (source: 'camera' | 'library') => {
    if (source === 'camera') {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow camera access to take a photo.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
      });
      if (!result.canceled && result.assets?.[0]?.uri) setCatchPhotoUri(result.assets[0].uri);
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo library access to choose a photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });
      if (!result.canceled && result.assets?.[0]?.uri) setCatchPhotoUri(result.assets[0].uri);
    }
  }, []);

  const handleConfirmCatchDetails = useCallback(async () => {
    if (!catchFlyName?.trim()) return;
    const species = catchSpecies.trim() || null;
    const sizeNum = catchSize.trim() ? parseFloat(catchSize.trim()) : null;
    const depthNum = catchDepth.trim() ? parseFloat(catchDepth.trim()) : null;
    const matchPrimary = userFlies.find(
      (f) =>
        f.name === catchFlyName.trim() &&
        (f.size ?? null) === (catchFlySize ?? null) &&
        (f.color ?? null) === (catchFlyColor ?? null)
    );
    const primary = {
      pattern: catchFlyName.trim(),
      size: catchFlySize ?? null,
      color: catchFlyColor ?? null,
      fly_id: matchPrimary?.fly_id ?? undefined,
      fly_color_id: matchPrimary?.fly_color_id ?? undefined,
      fly_size_id: matchPrimary?.fly_size_id ?? undefined,
    };
    const dropper =
      catchFlyName2 != null && catchFlyName2.trim()
        ? (() => {
            const match2 = userFlies.find(
              (f) =>
                f.name === catchFlyName2.trim() &&
                (f.size ?? null) === (catchFlySize2 ?? null) &&
                (f.color ?? null) === (catchFlyColor2 ?? null)
            );
            return {
              pattern: catchFlyName2.trim(),
              size: catchFlySize2 ?? null,
              color: catchFlyColor2 ?? null,
              fly_id: match2?.fly_id ?? undefined,
              fly_color_id: match2?.fly_color_id ?? undefined,
              fly_size_id: match2?.fly_size_id ?? undefined,
            };
          })()
        : null;
    const flyChanged =
      currentFly?.pattern !== primary.pattern ||
      (currentFly?.size ?? null) !== primary.size ||
      (currentFly?.color ?? null) !== primary.color ||
      (currentFly2?.pattern ?? null) !== (dropper?.pattern ?? null) ||
      (currentFly2?.size ?? null) !== (dropper?.size ?? null) ||
      (currentFly2?.color ?? null) !== (dropper?.color ?? null);
    if (flyChanged) {
      changeFly(primary, dropper);
    }
    let lat: number | null = null;
    let lon: number | null = null;
    try {
      const { status } = await ExpoLocation.getForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
        lat = loc.coords.latitude;
        lon = loc.coords.longitude;
        lastKnownCatchLat.current = lat;
        lastKnownCatchLon.current = lon;
      }
    } catch {
      lat = lastKnownCatchLat.current;
      lon = lastKnownCatchLon.current;
    }
    let photoUrl: string | null = null;
    const photoOptions = activeTrip?.id && activeTrip?.user_id && catchPhotoUri
      ? {
          userId: activeTrip.user_id,
          tripId: activeTrip.id,
          uri: catchPhotoUri,
          caption: catchNote.trim() || undefined,
          species: species ?? undefined,
          fly_pattern: primary.pattern,
          fly_size: primary.size ?? undefined,
          fly_color: primary.color ?? undefined,
          fly_id: primary.fly_id ?? undefined,
          captured_at: new Date().toISOString(),
        }
      : null;

    if (photoOptions && isConnected) {
      setCatchPhotoUploading(true);
      try {
        const photo = await addPhoto(photoOptions, { isOnline: true });
        photoUrl = photo.url;
      } catch (e) {
        Alert.alert('Upload failed', (e as Error).message);
        setCatchPhotoUploading(false);
        return;
      }
      setCatchPhotoUploading(false);
    }

    const eventId = addCatch(
      {
        species: species ?? undefined,
        size_inches: sizeNum ?? undefined,
        note: catchNote.trim() || undefined,
        photo_url: photoUrl ?? undefined,
        caught_on_fly: catchCaughtOnFly,
        quantity: 1,
        depth_ft: depthNum ?? undefined,
        presentation_method: catchPresentation ?? undefined,
        released: catchReleased ?? undefined,
        structure: catchStructure ?? undefined,
      },
      lat,
      lon,
    );

    if (photoOptions && !photoUrl && eventId) {
      try {
        await savePendingPhoto({
          ...buildPendingFromAddPhotoOptions(photoOptions, 'catch', eventId),
        });
      } catch {
        // non-blocking
      }
    }
    setCatchSpecies('');
    setCatchSize('');
    setCatchNote('');
    setCatchPhotoUri(null);
    setCatchDepth('');
    setCatchFlyName('');
    setCatchFlySize(null);
    setCatchFlyColor(null);
    setCatchFlyName2(null);
    setCatchFlySize2(null);
    setCatchFlyColor2(null);
    setCatchPresentation(null);
    setCatchReleased(true);
    setCatchStructure(null);
    setShowCatchModal(false);
  }, [addCatch, changeFly, activeTrip?.id, activeTrip?.user_id, userFlies, currentFly, currentFly2, catchSpecies, catchSize, catchNote, catchPhotoUri, catchCaughtOnFly, catchDepth, catchFlyName, catchFlySize, catchFlyColor, catchFlyName2, catchFlySize2, catchFlyColor2, catchPresentation, catchReleased, catchStructure, isConnected]);

  const handleEndTrip = () => {
    Alert.alert('End Trip', `End this trip with ${formatFishCount(fishCount)}?`, [
      { text: 'Keep Fishing', style: 'cancel' },
      {
        text: 'End Trip',
        style: 'destructive',
        onPress: async () => {
          const { synced } = await endTrip();
          if (!synced) {
            Alert.alert(
              'Saved on device',
              "Trip will sync when you're back online or when you open the app with connection.",
              [{ text: 'OK' }],
            );
          }
          router.replace(`/trip/${id}/survey`);
        },
      },
    ]);
  };

  const handleAddNote = () => {
    if (noteText.trim()) {
      addNote(noteText.trim());
      setNoteText('');
      setShowNoteInput(false);
    }
  };

  const openFlyPicker = () => {
    setPickerName(currentFly?.pattern ?? null);
    setPickerSize(currentFly?.size ?? null);
    setPickerColor(currentFly?.color ?? null);
    setPickerName2(currentFly2?.pattern ?? null);
    setPickerSize2(currentFly2?.size ?? null);
    setPickerColor2(currentFly2?.color ?? null);
    setShowFlyPicker(true);
  };

  const handleConfirmFly = () => {
    if (!pickerName) return;
    const matchPrimary = userFlies.find(
      (f) => f.name === pickerName?.trim() && (f.size ?? null) === (pickerSize ?? null) && (f.color ?? null) === (pickerColor ?? null)
    );
    const primary = {
      pattern: pickerName,
      size: pickerSize ?? null,
      color: pickerColor ?? null,
      fly_id: matchPrimary?.fly_id ?? undefined,
      fly_color_id: matchPrimary?.fly_color_id ?? undefined,
      fly_size_id: matchPrimary?.fly_size_id ?? undefined,
    };
    const dropper =
      pickerName2 && pickerName2.trim()
        ? (() => {
            const match2 = userFlies.find(
              (f) =>
                f.name === pickerName2?.trim() &&
                (f.size ?? null) === (pickerSize2 ?? null) &&
                (f.color ?? null) === (pickerColor2 ?? null)
            );
            return {
              pattern: pickerName2.trim(),
              size: pickerSize2 ?? null,
              color: pickerColor2 ?? null,
              fly_id: match2?.fly_id ?? undefined,
              fly_color_id: match2?.fly_color_id ?? undefined,
              fly_size_id: match2?.fly_size_id ?? undefined,
            };
          })()
        : null;
    changeFly(primary, dropper);
    setShowFlyPicker(false);
  };

  const handleAskAI = useCallback(async () => {
    const question = aiInput.trim();
    if (!question || aiLoading) return;

    const userMsg = { id: Date.now().toString(), role: 'user' as const, text: question };
    setAiMessages(prev => [...prev, userMsg]);
    setAiInput('');
    setAiLoading(true);

    const now = new Date();
    const primaryStr = currentFly ? `${currentFly.pattern}${currentFly.size ? ` #${currentFly.size}` : ''}${currentFly.color ? ` (${currentFly.color})` : ''}` : null;
    const dropperStr = currentFly2 ? `${currentFly2.pattern}${currentFly2.size ? ` #${currentFly2.size}` : ''}${currentFly2.color ? ` (${currentFly2.color})` : ''}` : null;
    const response = await askAI(
      {
        location: activeTrip?.location || null,
        fishingType: activeTrip?.fishing_type || 'fly',
        weather: weatherData,
        waterFlow: waterFlowData,
        currentFly: primaryStr,
        currentFly2: dropperStr,
        fishCount,
        recentEvents: events,
        timeOfDay: getTimeOfDay(now),
        season: getSeason(now),
        userFlies: userFlies.length > 0 ? userFlies : undefined,
      },
      question,
    );

    const aiMsg = { id: (Date.now() + 1).toString(), role: 'ai' as const, text: response };
    setAiMessages(prev => [...prev, aiMsg]);
    setAiLoading(false);

    addAIQuery(question, response);

    setTimeout(() => aiScrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [aiInput, aiLoading, activeTrip, weatherData, waterFlowData, currentFly, currentFly2, fishCount, events, userFlies]);

  if (!activeTrip) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No active trip</Text>
          <Pressable style={styles.backButton} onPress={() => router.replace('/')}>
            <Text style={styles.backButtonText}>Go Home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <StatusBar style="light" />
      {/* Trip photo details modal: caption, species (trip + fly from context) */}
      <Modal visible={!!tripPhotoUri} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={Keyboard.dismiss}>
          <View style={styles.tripPhotoModal}>
            <Text style={styles.tripPhotoModalTitle}>Photo details</Text>
            <Text style={styles.tripPhotoModalHint}>Trip and current fly will be saved.</Text>
            <Text style={styles.flyFieldLabel}>Caption (optional)</Text>
            <TextInput
              style={styles.tripPhotoModalInput}
              placeholder="Add a caption"
              placeholderTextColor={Colors.textTertiary}
              value={tripPhotoCaption}
              onChangeText={setTripPhotoCaption}
            />
            <Text style={styles.flyFieldLabel}>Species (optional)</Text>
            <TextInput
              style={styles.tripPhotoModalInput}
              placeholder="e.g. Brown Trout"
              placeholderTextColor={Colors.textTertiary}
              value={tripPhotoSpecies}
              onChangeText={setTripPhotoSpecies}
            />
            <View style={styles.tripPhotoModalButtons}>
              <Pressable style={styles.tripPhotoModalCancel} onPress={handleCancelTripPhoto}>
                <Text style={styles.tripPhotoModalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.tripPhotoModalSave, tripPhotoUploading && styles.tripPhotoModalSaveDisabled]}
                onPress={handleSaveTripPhoto}
                disabled={tripPhotoUploading}
              >
                {tripPhotoUploading ? (
                  <ActivityIndicator size="small" color={Colors.textInverse} />
                ) : (
                  <Text style={styles.tripPhotoModalSaveText}>Save</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Full-screen photo view — same as photo library: tap thumbnail to open */}
      <Modal
        visible={fullScreenPhoto != null}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => setFullScreenPhoto(null)}
      >
        <View style={[styles.fullScreenPhotoWrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
          <Pressable
            style={[styles.fullScreenPhotoClose, { top: insets.top + Spacing.sm }]}
            onPress={() => setFullScreenPhoto(null)}
          >
            <MaterialCommunityIcons name="close" size={28} color={Colors.textInverse} />
          </Pressable>
          {fullScreenPhoto && (
            <ScrollView
              style={styles.fullScreenPhotoScroll}
              contentContainerStyle={[styles.fullScreenPhotoScrollContent, { paddingBottom: insets.bottom + Spacing.xl }]}
              showsVerticalScrollIndicator={false}
            >
              <Image
                source={{ uri: fullScreenPhoto.url }}
                style={[styles.fullScreenPhotoImage, { width: Dimensions.get('window').width, height: Math.round(Dimensions.get('window').height * 0.55) }]}
                resizeMode="contain"
              />
              <View style={styles.fullScreenPhotoInfo}>
                {fullScreenPhoto.location ? (
                  <Text style={styles.fullScreenPhotoInfoRow}>
                    <MaterialCommunityIcons name="map-marker" size={16} color={Colors.textInverse} /> {fullScreenPhoto.location}
                  </Text>
                ) : null}
                {fullScreenPhoto.fly ? (
                  <Text style={styles.fullScreenPhotoInfoRow}>
                    <MaterialCommunityIcons name="hook" size={16} color={Colors.textInverse} /> {fullScreenPhoto.fly}
                  </Text>
                ) : null}
                {fullScreenPhoto.date ? (
                  <Text style={styles.fullScreenPhotoInfoRow}>
                    <MaterialIcons name="calendar-today" size={16} color={Colors.textInverse} /> {fullScreenPhoto.date}
                  </Text>
                ) : null}
                {fullScreenPhoto.species ? (
                  <Text style={styles.fullScreenPhotoInfoRow}>
                    <MaterialCommunityIcons name="fish" size={16} color={Colors.textInverse} /> {fullScreenPhoto.species}
                  </Text>
                ) : null}
                {fullScreenPhoto.caption ? (
                  <Text style={styles.fullScreenPhotoCaption}>{fullScreenPhoto.caption}</Text>
                ) : null}
              </View>
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Header — extends into top safe area so status bar area is blue */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.md }]}>
        <View>
          <Text style={styles.locationName}>
            {activeTrip.location?.name || 'Fishing Trip'}
          </Text>
          <Text style={styles.timerText}>{elapsed}</Text>
        </View>
        <View style={styles.headerRight}>
          {!isConnected && (
            <View style={styles.offlineBadge}>
              <Text style={styles.offlineBadgeText}>Offline</Text>
            </View>
          )}
          <Pressable style={styles.endButton} onPress={handleEndTrip}>
            <Text style={styles.endButtonText}>End</Text>
          </Pressable>
        </View>
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {([
          { key: 'fish' as TabKey, label: 'Fishing' },
          { key: 'photos' as TabKey, label: 'Photos' },
          { key: 'conditions' as TabKey, label: 'Conditions' },
          { key: 'ai' as TabKey, label: 'AI Guide' },
          { key: 'map' as TabKey, label: 'Map' },
        ]).map((tab) => {
          const color = activeTab === tab.key ? Colors.primary : Colors.textTertiary;
          return (
            <Pressable
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Tab Content */}
      {activeTab === 'fish' && (
        <FishingTab
          nextFlyRecommendation={nextFlyRecommendation}
          recommendationLoading={recommendationLoading}
          changeFly={changeFly}
          currentFly={currentFly}
          currentFly2={currentFly2}
          openFlyPicker={openFlyPicker}
          fishCount={fishCount}
          removeCatch={removeCatch}
          onFishPlus={handleFishPlus}
          showCatchModal={showCatchModal}
          setShowCatchModal={setShowCatchModal}
          catchSpecies={catchSpecies}
          setCatchSpecies={setCatchSpecies}
          catchSize={catchSize}
          setCatchSize={setCatchSize}
          catchNote={catchNote}
          setCatchNote={setCatchNote}
          catchPhotoUri={catchPhotoUri}
          setCatchPhotoUri={setCatchPhotoUri}
          onPickCatchPhoto={handlePickCatchPhoto}
          catchPhotoUploading={catchPhotoUploading}
          handleConfirmCatchDetails={handleConfirmCatchDetails}
          catchCaughtOnFly={catchCaughtOnFly}
          setCatchCaughtOnFly={setCatchCaughtOnFly}
          catchDepth={catchDepth}
          setCatchDepth={setCatchDepth}
          catchFlyName={catchFlyName}
          setCatchFlyName={setCatchFlyName}
          catchFlySize={catchFlySize}
          setCatchFlySize={setCatchFlySize}
          catchFlyColor={catchFlyColor}
          setCatchFlyColor={setCatchFlyColor}
          catchFlyName2={catchFlyName2}
          setCatchFlyName2={setCatchFlyName2}
          catchFlySize2={catchFlySize2}
          setCatchFlySize2={setCatchFlySize2}
          catchFlyColor2={catchFlyColor2}
          setCatchFlyColor2={setCatchFlyColor2}
          catchPresentation={catchPresentation}
          setCatchPresentation={setCatchPresentation}
          catchReleased={catchReleased}
          setCatchReleased={setCatchReleased}
          catchStructure={catchStructure}
          setCatchStructure={setCatchStructure}
          showNoteInput={showNoteInput}
          setShowNoteInput={setShowNoteInput}
          noteText={noteText}
          setNoteText={setNoteText}
          handleAddNote={handleAddNote}
          addBite={addBite}
          addFishOn={addFishOn}
          showFlyPicker={showFlyPicker}
          setShowFlyPicker={setShowFlyPicker}
          pickerName={pickerName}
          setPickerName={setPickerName}
          pickerSize={pickerSize}
          setPickerSize={setPickerSize}
          pickerColor={pickerColor}
          setPickerColor={setPickerColor}
          pickerName2={pickerName2}
          setPickerName2={setPickerName2}
          pickerSize2={pickerSize2}
          setPickerSize2={setPickerSize2}
          pickerColor2={pickerColor2}
          setPickerColor2={setPickerColor2}
          handleConfirmFly={handleConfirmFly}
          events={events}
          flyPickerNames={flyPickerNames}
          userFlies={userFlies}
          tripPhotos={tripPhotos}
          onCatchPhotoPress={handleCatchPhotoPress}
        />
      )}

      {activeTab === 'photos' && (
        <PhotosTab
          tripPhotos={tripPhotos}
          loading={tripPhotosLoading}
          uploading={tripPhotoUploading}
          onAddPhoto={handlePickTripPhoto}
          onPhotoPress={handleTripPhotoPress}
        />
      )}

      {activeTab === 'conditions' && (
        <>
          {!isConnected && (
            <View style={styles.cachedDataBanner}>
              <Text style={styles.cachedDataBannerText}>Offline – using cached data</Text>
            </View>
          )}
          <ConditionsTab
            weatherData={weatherData}
            waterFlowData={waterFlowData}
            conditionsLoading={conditionsLoading}
            onRefresh={fetchConditions}
            location={activeTrip.location}
          />
        </>
      )}

      {activeTab === 'ai' && (
        <>
          {!isConnected && (
            <View style={styles.cachedDataBanner}>
              <Text style={styles.cachedDataBannerText}>Offline – using cached data</Text>
            </View>
          )}
          <AIGuideTab
            strategySlot={
              <>
                <Text style={[styles.strategySectionLabel, styles.strategySectionLabelFirst]}>Best time to fish</Text>
                <View style={styles.strategyCard}>
                  {strategyLoading ? (
                    <ActivityIndicator size="small" color={Colors.primary} style={styles.strategyLoader} />
                  ) : strategyBestTime ? (
                    <Text style={styles.strategyBestTime}>{strategyBestTime}</Text>
                  ) : (
                    <Text style={styles.strategyPlaceholder}>—</Text>
                  )}
                </View>
                <Text style={styles.strategySectionLabel}>Top flies</Text>
                <View style={styles.strategyCard}>
                  {strategyLoading ? (
                    <ActivityIndicator size="small" color={Colors.primary} style={styles.strategyLoader} />
                  ) : strategyTopFlies.length > 0 ? (
                    <View style={styles.strategyFliesWrap}>
                      {strategyTopFlies.map((fly, i) => (
                        <View key={i} style={styles.strategyFlyRow}>
                          <View style={styles.strategyFlyBullet} />
                          <Text style={styles.strategyFlyName} numberOfLines={2}>{fly}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.strategyPlaceholder}>No fly suggestions.</Text>
                  )}
                </View>
                <Text style={styles.strategySectionLabel}>How to fish it</Text>
                <View style={styles.strategyCard}>
                  {strategyLoading ? (
                    <ActivityIndicator size="small" color={Colors.primary} style={styles.strategyLoader} />
                  ) : strategyHowToFish ? (
                    <Text style={styles.strategyHowToFishText}>{strategyHowToFish}</Text>
                  ) : (
                    <Text style={styles.strategyPlaceholder}>—</Text>
                  )}
                </View>
              </>
            }
            messages={aiMessages}
            input={aiInput}
            setInput={setAiInput}
            loading={aiLoading}
            onSend={handleAskAI}
            scrollRef={aiScrollRef}
          />
        </>
      )}

      {activeTab === 'map' && (
        <TripMapTab
          mapLocation={mapLocation}
          mapLocationLoading={mapLocationLoading}
          mapLocationError={mapLocationError}
          onRequestLocation={async () => {
            setMapLocationLoading(true);
            setMapLocationError(null);
            try {
              const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
              if (status !== 'granted') {
                setMapLocationError('Location permission is needed to show your position on the map.');
                setMapLocationLoading(false);
                return;
              }
              const loc = await ExpoLocation.getCurrentPositionAsync({
                accuracy: ExpoLocation.Accuracy.Balanced,
              });
              setMapLocation({
                lat: loc.coords.latitude,
                lon: loc.coords.longitude,
              });
            } catch (e) {
              setMapLocationError('Could not get your location.');
            } finally {
              setMapLocationLoading(false);
            }
          }}
        />
      )}
    </SafeAreaView>
  );
}

/* ─── Fishing Tab ─── */

function FishingTab({
  nextFlyRecommendation, recommendationLoading, changeFly, currentFly, currentFly2,
  openFlyPicker, fishCount, removeCatch, onFishPlus,
  showCatchModal, setShowCatchModal, catchSpecies, setCatchSpecies,
  catchSize, setCatchSize, catchNote, setCatchNote,
  catchPhotoUri, setCatchPhotoUri, onPickCatchPhoto, catchPhotoUploading,
  handleConfirmCatchDetails, catchCaughtOnFly, setCatchCaughtOnFly,
  catchDepth, setCatchDepth,
  catchFlyName, setCatchFlyName, catchFlySize, setCatchFlySize, catchFlyColor, setCatchFlyColor,
  catchFlyName2, setCatchFlyName2, catchFlySize2, setCatchFlySize2, catchFlyColor2, setCatchFlyColor2,
  catchPresentation, setCatchPresentation, catchReleased, setCatchReleased,
  catchStructure, setCatchStructure,
  showNoteInput, setShowNoteInput, noteText, setNoteText, handleAddNote,
  addBite, addFishOn,
  showFlyPicker, setShowFlyPicker, pickerName, setPickerName,
  pickerSize, setPickerSize, pickerColor, setPickerColor,
  pickerName2, setPickerName2, pickerSize2, setPickerSize2, pickerColor2, setPickerColor2,
  handleConfirmFly, events,
  flyPickerNames = FLY_NAMES,
  userFlies = [],
  tripPhotos = [],
  onCatchPhotoPress,
}: any) {
  const [catchFlyDropdownOpen, setCatchFlyDropdownOpen] = useState<null | 'name' | 'size' | 'color' | 'name2' | 'size2' | 'color2'>(null);
  const [catchSpeciesDropdownOpen, setCatchSpeciesDropdownOpen] = useState(false);
  const [flyNameSearch, setFlyNameSearch] = useState('');
  const [showTripPhotoPicker, setShowTripPhotoPicker] = useState(false);

  const flyNamesWithOther = useMemo(() => {
    const hasOther = flyPickerNames.some((n: string) => n === 'Other');
    return hasOther ? flyPickerNames : [...flyPickerNames, 'Other'];
  }, [flyPickerNames]);

  const filteredFlyNames = useMemo(() => {
    const q = flyNameSearch.trim().toLowerCase();
    if (!q) return flyNamesWithOther;
    const filtered = flyNamesWithOther.filter((n: string) => n.toLowerCase().includes(q));
    return filtered.includes('Other') ? filtered : [...filtered, 'Other'];
  }, [flyNamesWithOther, flyNameSearch]);

  const catchFlyDropdownOptions: { label: string; value: string | number }[] =
    catchFlyDropdownOpen === null
      ? []
      : catchFlyDropdownOpen === 'name' || catchFlyDropdownOpen === 'name2'
        ? flyNamesWithOther.map((n: string) => ({ label: n, value: n }))
        : catchFlyDropdownOpen === 'size' || catchFlyDropdownOpen === 'size2'
          ? FLY_SIZES.map((s: number) => ({ label: `#${s}`, value: s }))
          : FLY_COLORS.map((c: string) => ({ label: c, value: c }));

  const handleCatchFlyDropdownSelect = (value: string | number) => {
    if (catchFlyDropdownOpen === 'name') setCatchFlyName(String(value));
    else if (catchFlyDropdownOpen === 'size') setCatchFlySize(value as number);
    else if (catchFlyDropdownOpen === 'color') setCatchFlyColor(String(value));
    else if (catchFlyDropdownOpen === 'name2') setCatchFlyName2(String(value));
    else if (catchFlyDropdownOpen === 'size2') setCatchFlySize2(value as number);
    else if (catchFlyDropdownOpen === 'color2') setCatchFlyColor2(String(value));
    setCatchFlyDropdownOpen(null);
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Next Fly Recommendation */}
      {nextFlyRecommendation && (
        <Pressable
          style={styles.nextFlyBanner}
          onPress={() => {
            const primary = {
              pattern: nextFlyRecommendation.pattern,
              size: nextFlyRecommendation.size,
              color: nextFlyRecommendation.color,
              fly_id: nextFlyRecommendation.fly_id ?? undefined,
              fly_color_id: nextFlyRecommendation.fly_color_id ?? undefined,
              fly_size_id: nextFlyRecommendation.fly_size_id ?? undefined,
            };
            const dropper =
              nextFlyRecommendation.pattern2 != null && nextFlyRecommendation.pattern2.trim()
                ? {
                    pattern: nextFlyRecommendation.pattern2,
                    size: nextFlyRecommendation.size2 ?? null,
                    color: nextFlyRecommendation.color2 ?? null,
                    fly_id: nextFlyRecommendation.fly_id2 ?? undefined,
                    fly_color_id: nextFlyRecommendation.fly_color_id2 ?? undefined,
                    fly_size_id: nextFlyRecommendation.fly_size_id2 ?? undefined,
                  }
                : null;
            changeFly(primary, dropper);
          }}
        >
          <View style={styles.nextFlyLeft}>
            <Text style={styles.nextFlyLabel}>
              {recommendationLoading ? 'AI Thinking...' : 'Try Next'}
            </Text>
            <Text style={styles.nextFlyName}>
              {nextFlyRecommendation.pattern2
                ? `${nextFlyRecommendation.pattern} #${nextFlyRecommendation.size} / ${nextFlyRecommendation.pattern2} #${nextFlyRecommendation.size2 ?? ''}`
                : `${nextFlyRecommendation.pattern} #${nextFlyRecommendation.size}`}
            </Text>
            {nextFlyRecommendation.reason ? (
              <Text style={styles.nextFlyReason} numberOfLines={2}>
                {nextFlyRecommendation.reason}
              </Text>
            ) : null}
          </View>
          <Text style={styles.nextFlyTap}>Tap to switch</Text>
        </Pressable>
      )}

      {/* Current Fly (primary + optional dropper) */}
      <Pressable style={styles.currentFlyBar} onPress={openFlyPicker}>
        <Text style={styles.currentFlyLabel}>{currentFly2 ? 'Current rig' : 'Current Fly'}</Text>
        <Text style={styles.currentFlyName}>
          {currentFly
            ? currentFly2
              ? `${currentFly.pattern}${currentFly.size ? ` #${currentFly.size}` : ''} / ${currentFly2.pattern}${currentFly2.size ? ` #${currentFly2.size}` : ''}`
              : `${currentFly.pattern}${currentFly.size ? ` #${currentFly.size}` : ''}`
            : 'Tap to select'}
        </Text>
      </Pressable>

      {/* Fish Counter */}
      <View style={styles.fishCounterSection}>
        <Pressable style={styles.fishMinusButton} onPress={removeCatch}>
          <Text style={styles.fishButtonText}>−</Text>
        </Pressable>
        <View style={styles.fishCountDisplay}>
          <Text style={styles.fishCountNumber}>{fishCount}</Text>
          <Text style={styles.fishCountLabel}>fish</Text>
        </View>
        <Pressable style={styles.fishPlusButton} onPress={onFishPlus}>
          <Text style={styles.fishPlusButtonText}>+</Text>
        </Pressable>
      </View>

      {/* Add fish details modal — use Modal so overlay doesn't steal scroll touches */}
      <Modal visible={showCatchModal} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.catchModalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => {
              Keyboard.dismiss();
              setShowCatchModal(false);
            }}
          />
          <View style={styles.catchModalOverlay}>
          <View style={styles.catchModal} onStartShouldSetResponder={() => true}>
            <View style={styles.catchModalHeader}>
              <Text style={styles.catchModalTitle}>Add fish details</Text>
            </View>
            <ScrollView
              style={styles.catchModalScroll}
              contentContainerStyle={styles.catchModalScrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={true}
              scrollEventThrottle={16}
              bounces={true}
              overScrollMode="always"
            >
            {/* Fly (editable name, size, color) — one row */}
            <Text style={styles.flyFieldLabel}>{catchFlyName2 != null ? 'Primary fly' : 'Fly'}</Text>
            <View style={styles.catchFlyDropdownRowWrap}>
              <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('name')}>
                <Text style={[styles.catchFlyDropdownValue, !catchFlyName && styles.catchFlyDropdownPlaceholder]} numberOfLines={1}>
                  {catchFlyName || 'Name'}
                </Text>
                <MaterialIcons name="keyboard-arrow-down" size={16} color={Colors.textSecondary} />
              </Pressable>
              <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('size')}>
                <Text style={[styles.catchFlyDropdownValue, catchFlySize == null && styles.catchFlyDropdownPlaceholder]} numberOfLines={1}>
                  {catchFlySize != null ? `#${catchFlySize}` : 'Size'}
                </Text>
                <MaterialIcons name="keyboard-arrow-down" size={16} color={Colors.textSecondary} />
              </Pressable>
              <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('color')}>
                <Text style={[styles.catchFlyDropdownValue, !catchFlyColor && styles.catchFlyDropdownPlaceholder]} numberOfLines={1}>
                  {catchFlyColor || 'Color'}
                </Text>
                <MaterialIcons name="keyboard-arrow-down" size={16} color={Colors.textSecondary} />
              </Pressable>
            </View>

            {/* Second fly (dropper) */}
            {catchFlyName2 != null ? (
              <>
                <Text style={[styles.flyFieldLabel, { marginTop: Spacing.md }]}>Dropper</Text>
                <Pressable
                  style={[styles.addDropperButton, { marginBottom: Spacing.sm }]}
                  onPress={() => { setCatchFlyName2(null); setCatchFlySize2(null); setCatchFlyColor2(null); }}
                >
                  <Text style={styles.addDropperButtonText}>Remove dropper</Text>
                </Pressable>
                <View style={styles.catchFlyDropdownRowWrap}>
                  <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('name2')}>
                    <Text style={[styles.catchFlyDropdownValue, !catchFlyName2 && styles.catchFlyDropdownPlaceholder]} numberOfLines={1}>
                      {catchFlyName2 || 'Name'}
                    </Text>
                    <MaterialIcons name="keyboard-arrow-down" size={16} color={Colors.textSecondary} />
                  </Pressable>
                  <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('size2')}>
                    <Text style={[styles.catchFlyDropdownValue, catchFlySize2 == null && styles.catchFlyDropdownPlaceholder]} numberOfLines={1}>
                      {catchFlySize2 != null ? `#${catchFlySize2}` : 'Size'}
                    </Text>
                    <MaterialIcons name="keyboard-arrow-down" size={16} color={Colors.textSecondary} />
                  </Pressable>
                  <Pressable style={styles.catchFlyDropdownCell} onPress={() => setCatchFlyDropdownOpen('color2')}>
                    <Text style={[styles.catchFlyDropdownValue, !catchFlyColor2 && styles.catchFlyDropdownPlaceholder]} numberOfLines={1}>
                      {catchFlyColor2 || 'Color'}
                    </Text>
                    <MaterialIcons name="keyboard-arrow-down" size={16} color={Colors.textSecondary} />
                  </Pressable>
                </View>
                <Text style={styles.flyFieldLabel}>Which fly caught?</Text>
                <View style={styles.catchFlyRadioRow}>
                  <Pressable
                    style={styles.catchFlyRadioOption}
                    onPress={() => setCatchCaughtOnFly('primary')}
                  >
                    <MaterialIcons
                      name={catchCaughtOnFly === 'primary' ? 'radio-button-checked' : 'radio-button-unchecked'}
                      size={22}
                      color={catchCaughtOnFly === 'primary' ? Colors.primary : Colors.textSecondary}
                    />
                    <Text style={[styles.catchFlyRadioLabel, catchCaughtOnFly === 'primary' && styles.catchFlyRadioLabelActive]}>
                      {catchFlyName}{catchFlySize ? ` #${catchFlySize}` : ''}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={styles.catchFlyRadioOption}
                    onPress={() => setCatchCaughtOnFly('dropper')}
                  >
                    <MaterialIcons
                      name={catchCaughtOnFly === 'dropper' ? 'radio-button-checked' : 'radio-button-unchecked'}
                      size={22}
                      color={catchCaughtOnFly === 'dropper' ? Colors.primary : Colors.textSecondary}
                    />
                    <Text style={[styles.catchFlyRadioLabel, catchCaughtOnFly === 'dropper' && styles.catchFlyRadioLabelActive]}>
                      {catchFlyName2}{catchFlySize2 ? ` #${catchFlySize2}` : ''}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Pressable style={styles.addDropperButton} onPress={() => { setCatchFlyName2(flyPickerNames[0] ?? ''); setCatchFlySize2(null); setCatchFlyColor2(null); }}>
                <Text style={styles.addDropperButtonText}>Add dropper</Text>
              </Pressable>
            )}

            <Text style={styles.flyFieldLabel}>Photo</Text>
            <View style={styles.catchPhotoRow}>
              {catchPhotoUri ? (
                <View style={styles.catchPhotoPreviewWrap}>
                  <Image source={{ uri: catchPhotoUri }} style={styles.catchPhotoPreview} />
                  <Pressable
                    style={styles.catchPhotoRemove}
                    onPress={() => setCatchPhotoUri(null)}
                  >
                    <MaterialIcons name="close" size={18} color={Colors.textInverse} />
                  </Pressable>
                </View>
              ) : (
                <>
                  <Pressable
                    style={styles.catchPhotoButton}
                    onPress={() => onPickCatchPhoto('camera')}
                  >
                    <MaterialIcons name="photo-camera" size={22} color={Colors.primary} />
                    <Text style={styles.catchPhotoButtonLabel}>Camera</Text>
                  </Pressable>
                  <Pressable
                    style={styles.catchPhotoButton}
                    onPress={() => onPickCatchPhoto('library')}
                  >
                    <MaterialIcons name="photo-library" size={22} color={Colors.primary} />
                    <Text style={styles.catchPhotoButtonLabel}>Upload</Text>
                  </Pressable>
                  <Pressable
                    style={styles.catchPhotoButton}
                    onPress={() => setShowTripPhotoPicker(true)}
                  >
                    <MaterialIcons name="collections" size={22} color={Colors.primary} />
                    <Text style={styles.catchPhotoButtonLabel}>From trip</Text>
                  </Pressable>
                </>
              )}
            </View>

            {/* Trip photo picker modal — select from trip photos like photo library */}
            <Modal
              visible={showTripPhotoPicker}
              animationType="slide"
              transparent
              onRequestClose={() => setShowTripPhotoPicker(false)}
            >
              <Pressable style={styles.tripPhotoPickerOverlay} onPress={() => setShowTripPhotoPicker(false)}>
                <Pressable style={styles.tripPhotoPickerCard} onPress={() => {}}>
                  <View style={styles.tripPhotoPickerHeader}>
                    <Text style={styles.tripPhotoPickerTitle}>Select from trip</Text>
                    <Pressable hitSlop={12} onPress={() => setShowTripPhotoPicker(false)}>
                      <MaterialIcons name="close" size={24} color={Colors.textSecondary} />
                    </Pressable>
                  </View>
                  {tripPhotos.length === 0 ? (
                    <View style={styles.tripPhotoPickerEmpty}>
                      <MaterialIcons name="photo-library" size={48} color={Colors.textTertiary} />
                      <Text style={styles.tripPhotoPickerEmptyText}>No photos in this trip yet</Text>
                      <Text style={styles.tripPhotoPickerEmptyHint}>Add photos in the Photos tab or take one with Camera / Upload</Text>
                    </View>
                  ) : (
                    <ScrollView style={styles.tripPhotoPickerScroll} contentContainerStyle={styles.tripPhotoPickerGrid}>
                      {tripPhotos.map((photo) => (
                        <Pressable
                          key={photo.id}
                          style={styles.tripPhotoPickerThumbWrap}
                          onPress={() => {
                            setCatchPhotoUri(photo.url);
                            setShowTripPhotoPicker(false);
                          }}
                        >
                          <Image source={{ uri: photo.url }} style={styles.tripPhotoPickerThumb} />
                        </Pressable>
                      ))}
                    </ScrollView>
                  )}
                </Pressable>
              </Pressable>
            </Modal>

            <Text style={styles.flyFieldLabel}>Notes</Text>
            <TextInput
              style={[styles.catchModalInput, styles.catchModalNoteInput]}
              placeholder="Optional note"
              placeholderTextColor={Colors.textTertiary}
              value={catchNote}
              onChangeText={setCatchNote}
              multiline
            />
            <Text style={styles.flyFieldLabel}>Size (inches)</Text>
            <TextInput
              style={styles.catchModalInput}
              placeholder="e.g. 14"
              placeholderTextColor={Colors.textTertiary}
              value={catchSize}
              onChangeText={setCatchSize}
              keyboardType="decimal-pad"
            />
            <Text style={styles.flyFieldLabel}>Species</Text>
            <Pressable style={styles.catchFlyDropdownRow} onPress={() => setCatchSpeciesDropdownOpen(true)}>
              <Text style={[styles.catchFlyDropdownValue, !catchSpecies && styles.catchFlyDropdownPlaceholder]} numberOfLines={1}>
                {catchSpecies || 'Select species'}
              </Text>
              <MaterialIcons name="keyboard-arrow-down" size={16} color={Colors.textSecondary} />
            </Pressable>
            {(!catchSpecies || !SPECIES_OPTIONS.includes(catchSpecies)) && (
              <TextInput
                style={styles.catchModalInput}
                placeholder="Species name (when Other is selected)"
                placeholderTextColor={Colors.textTertiary}
                value={catchSpecies}
                onChangeText={setCatchSpecies}
              />
            )}

            <Text style={styles.flyFieldLabel}>Catch Depth</Text>
            <TextInput
              style={styles.catchModalInput}
              placeholder="e.g. 3"
              placeholderTextColor={Colors.textTertiary}
              value={catchDepth}
              onChangeText={setCatchDepth}
              keyboardType="decimal-pad"
            />

            <Text style={styles.flyFieldLabel}>Presentation</Text>
            <View style={styles.chipRow}>
              {(['dry', 'nymph', 'streamer', 'wet', 'other'] as const).map((m) => (
                <Pressable
                  key={m}
                  style={[styles.chip, catchPresentation === m && styles.chipActive]}
                  onPress={() => setCatchPresentation(m)}
                >
                  <Text style={[styles.chipText, catchPresentation === m && styles.chipTextActive]}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.flyFieldLabel}>Released?</Text>
            <View style={styles.chipRow}>
              <Pressable
                style={[styles.chip, catchReleased === true && styles.chipActive]}
                onPress={() => setCatchReleased(true)}
              >
                <Text style={[styles.chipText, catchReleased === true && styles.chipTextActive]}>Released</Text>
              </Pressable>
              <Pressable
                style={[styles.chip, catchReleased === false && styles.chipActive]}
                onPress={() => setCatchReleased(false)}
              >
                <Text style={[styles.chipText, catchReleased === false && styles.chipTextActive]}>Kept</Text>
              </Pressable>
            </View>

            <Text style={styles.flyFieldLabel}>Water Structure</Text>
            <View style={styles.chipRow}>
              {(['pool', 'riffle', 'run', 'undercut_bank', 'eddy', 'other'] as const).map((s) => (
                <Pressable
                  key={s}
                  style={[styles.chip, catchStructure === s && styles.chipActive]}
                  onPress={() => setCatchStructure(s)}
                >
                  <Text style={[styles.chipText, catchStructure === s && styles.chipTextActive]}>
                    {s === 'undercut_bank' ? 'Undercut' : s.charAt(0).toUpperCase() + s.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
            {/* Fly dropdown picker modal (outside ScrollView to avoid nested scroll) */}
            <Modal visible={catchFlyDropdownOpen !== null} transparent animationType="fade">
              <View style={styles.catchFlyPickerOverlay}>
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setCatchFlyDropdownOpen(null)} />
                <View style={styles.catchFlyPickerSheet}>
                  <ScrollView style={styles.catchFlyPickerList} keyboardShouldPersistTaps="handled">
                    {catchFlyDropdownOptions.map((opt) => {
                      const isSelected =
                        (catchFlyDropdownOpen === 'name' && opt.value === catchFlyName) ||
                        (catchFlyDropdownOpen === 'size' && opt.value === catchFlySize) ||
                        (catchFlyDropdownOpen === 'color' && opt.value === catchFlyColor) ||
                        (catchFlyDropdownOpen === 'name2' && opt.value === catchFlyName2) ||
                        (catchFlyDropdownOpen === 'size2' && opt.value === catchFlySize2) ||
                        (catchFlyDropdownOpen === 'color2' && opt.value === catchFlyColor2);
                      return (
                        <Pressable
                          key={String(opt.value)}
                          style={[styles.catchFlyPickerOption, isSelected && styles.catchFlyPickerOptionActive]}
                          onPress={() => handleCatchFlyDropdownSelect(opt.value)}
                        >
                          <Text style={[styles.catchFlyPickerOptionText, isSelected && styles.catchFlyPickerOptionTextActive]}>{opt.label}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              </View>
            </Modal>
            {/* Species dropdown picker modal */}
            <Modal visible={catchSpeciesDropdownOpen} transparent animationType="fade">
              <View style={styles.catchFlyPickerOverlay}>
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setCatchSpeciesDropdownOpen(false)} />
                <View style={styles.catchFlyPickerSheet}>
                  <ScrollView style={styles.catchFlyPickerList} keyboardShouldPersistTaps="handled">
                    {SPECIES_OPTIONS.map((species) => {
                      const isOther = species === 'Other';
                      const isSelected = isOther
                        ? !catchSpecies || !SPECIES_OPTIONS.slice(0, -1).includes(catchSpecies)
                        : catchSpecies === species;
                      return (
                        <Pressable
                          key={species}
                          style={[styles.catchFlyPickerOption, isSelected && styles.catchFlyPickerOptionActive]}
                          onPress={() => {
                            setCatchSpecies(isOther ? '' : species);
                            setCatchSpeciesDropdownOpen(false);
                          }}
                        >
                          <Text style={[styles.catchFlyPickerOptionText, isSelected && styles.catchFlyPickerOptionTextActive]}>{species}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              </View>
            </Modal>
            <View style={styles.catchModalActions}>
              <Pressable
                style={styles.catchModalCancel}
                onPress={() => {
                  setCatchPhotoUri(null);
                  setShowCatchModal(false);
                }}
              >
                <Text style={styles.catchModalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.confirmFlyButton}
                onPress={handleConfirmCatchDetails}
                disabled={catchPhotoUploading}
              >
                {catchPhotoUploading ? (
                  <ActivityIndicator size="small" color={Colors.textInverse} />
                ) : (
                  <Text style={styles.confirmFlyButtonText}>Add fish</Text>
                )}
              </Pressable>
            </View>
          </View>
          </View>
        </View>
      </Modal>

      {/* Quick log: Bite / Fish On */}
      <View style={[styles.actionRow, styles.actionRowTight]}>
        <Pressable style={styles.actionButton} onPress={() => addBite?.()}>
          <MaterialCommunityIcons name="fish" size={20} color={Colors.accent} />
          <Text style={styles.actionLabel}>Bite</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={() => addFishOn?.()}>
          <MaterialIcons name="highlight-off" size={20} color={Colors.textSecondary} />
          <Text style={styles.actionLabel}>Fish On</Text>
        </Pressable>
      </View>
      {/* Change Fly / Add Note */}
      <View style={styles.actionRow}>
        <Pressable style={styles.actionButton} onPress={openFlyPicker}>
          <MaterialCommunityIcons name="hook" size={20} color={Colors.accent} />
          <Text style={styles.actionLabel}>Change Fly</Text>
        </Pressable>
        <Pressable style={styles.actionButton} onPress={() => setShowNoteInput(!showNoteInput)}>
          <MaterialIcons name="edit-note" size={20} color={Colors.textSecondary} />
          <Text style={styles.actionLabel}>Add Note</Text>
        </Pressable>
      </View>

      {/* Note Input */}
      {showNoteInput && (
        <View style={styles.noteInputRow}>
          <TextInput
            style={styles.noteInput}
            placeholder="Write a note..."
            placeholderTextColor={Colors.textTertiary}
            value={noteText}
            onChangeText={setNoteText}
            onSubmitEditing={handleAddNote}
            returnKeyType="done"
            autoFocus
          />
          <Pressable style={styles.noteSubmit} onPress={handleAddNote}>
            <Text style={styles.noteSubmitText}>Add</Text>
          </Pressable>
        </View>
      )}

      {/* Fly Picker — sheet-style modal (max 82% height) */}
      <Modal
        visible={showFlyPicker}
        animationType="slide"
        presentationStyle="fullScreen"
      >
        <SafeAreaView style={styles.flyPickerModalContainer} edges={['top', 'left', 'right', 'bottom']}>
          <Pressable style={styles.flyPickerBackdrop} onPress={() => setShowFlyPicker(false)} />
          <View style={[styles.flyPickerSheet, styles.flyPickerSheetSized]}>
            <View style={styles.flyPickerHeader}>
              <Text style={styles.flyPickerTitle}>Select Fly</Text>
              <Pressable onPress={() => setShowFlyPicker(false)} hitSlop={12}>
                <Text style={styles.flyPickerClose}>Cancel</Text>
              </Pressable>
            </View>
            <ScrollView
              style={styles.flyPickerScroll}
              contentContainerStyle={styles.flyPickerContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={true}
            >
              {/* Fly thumbnail(s) — from fly catalog/box only */}
              {(pickerName || pickerName2) && (() => {
                const matchPrimary = userFlies.find(
                  (f: Fly) => f.name === (pickerName ?? '')?.trim() && (f.size ?? null) === (pickerSize ?? null) && (f.color ?? null) === (pickerColor ?? null)
                );
                const matchDropper = pickerName2 != null && (pickerName2 as string).trim()
                  ? userFlies.find(
                      (f: Fly) => f.name === (pickerName2 as string).trim() && (f.size ?? null) === (pickerSize2 ?? null) && (f.color ?? null) === (pickerColor2 ?? null)
                    )
                  : null;
                const primaryUrl = matchPrimary?.photo_url ?? null;
                const dropperUrl = matchDropper?.photo_url ?? null;
                if (!primaryUrl && !dropperUrl) return null;
                return (
                  <>
                    <Text style={styles.flyFieldLabel}>Thumbnail</Text>
                    <View style={styles.flyThumbnailRow}>
                      {primaryUrl ? (
                        <Image source={{ uri: primaryUrl }} style={styles.flyThumbnailImage} />
                      ) : null}
                      {dropperUrl ? (
                        <Image source={{ uri: dropperUrl }} style={styles.flyThumbnailImage} />
                      ) : null}
                    </View>
                  </>
                );
              })()}

            <Text style={styles.flyFieldLabel}>Name{flyPickerNames !== FLY_NAMES ? ' (from Fly Box)' : ''}</Text>
            <TextInput
              style={styles.flyNameSearchInput}
              placeholder="Search fly name..."
              placeholderTextColor={Colors.textTertiary}
              value={flyNameSearch}
              onChangeText={setFlyNameSearch}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              <View style={styles.chipRow}>
                {filteredFlyNames.map((name: string) => (
                  <Pressable
                    key={name}
                    style={[styles.chip, pickerName === name && styles.chipActive]}
                    onPress={() => setPickerName(name)}
                  >
                    <Text style={[styles.chipText, pickerName === name && styles.chipTextActive]}>{name}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <Text style={styles.flyFieldLabel}>Size</Text>
            <View style={styles.chipRow}>
              {FLY_SIZES.map((size: number) => (
                <Pressable
                  key={size}
                  style={[styles.chip, pickerSize === size && styles.chipActive]}
                  onPress={() => setPickerSize(size)}
                >
                  <Text style={[styles.chipText, pickerSize === size && styles.chipTextActive]}>#{size}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.flyFieldLabel}>Color</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
              <View style={styles.chipRow}>
                {FLY_COLORS.map((color: string) => (
                  <Pressable
                    key={color}
                    style={[styles.chip, pickerColor === color && styles.chipActive]}
                    onPress={() => setPickerColor(color)}
                  >
                    <Text style={[styles.chipText, pickerColor === color && styles.chipTextActive]}>{color}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            {/* Second fly (dropper) */}
            <Text style={[styles.flyFieldLabel, { marginTop: Spacing.md }]}>Second fly (dropper)</Text>
            {pickerName2 === null ? (
              <Pressable style={styles.addDropperButton} onPress={() => setPickerName2('')}>
                <Text style={styles.addDropperButtonText}>Add dropper (e.g. hopper-dropper)</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  style={styles.addDropperButton}
                  onPress={() => { setPickerName2(null); setPickerSize2(null); setPickerColor2(null); }}
                >
                  <Text style={styles.addDropperButtonText}>Remove dropper</Text>
                </Pressable>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  <View style={styles.chipRow}>
                    {filteredFlyNames.map((name: string) => (
                      <Pressable
                        key={name}
                        style={[styles.chip, pickerName2 === name && styles.chipActive]}
                        onPress={() => setPickerName2(name)}
                      >
                        <Text style={[styles.chipText, pickerName2 === name && styles.chipTextActive]}>{name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                <View style={styles.chipRow}>
                  {FLY_SIZES.map((size: number) => (
                    <Pressable
                      key={size}
                      style={[styles.chip, pickerSize2 === size && styles.chipActive]}
                      onPress={() => setPickerSize2(size)}
                    >
                      <Text style={[styles.chipText, pickerSize2 === size && styles.chipTextActive]}>#{size}</Text>
                    </Pressable>
                  ))}
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll}>
                  <View style={styles.chipRow}>
                    {FLY_COLORS.map((color: string) => (
                      <Pressable
                        key={color}
                        style={[styles.chip, pickerColor2 === color && styles.chipActive]}
                        onPress={() => setPickerColor2(color)}
                      >
                        <Text style={[styles.chipText, pickerColor2 === color && styles.chipTextActive]}>{color}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </>
            )}
          </ScrollView>

            <View style={styles.flyPickerFooter}>
              <Pressable
                style={[styles.confirmFlyButton, !pickerName && styles.confirmFlyButtonDisabled]}
                onPress={handleConfirmFly}
                disabled={!pickerName}
              >
                <Text style={styles.confirmFlyButtonText}>
                    {pickerName
                      ? pickerName2
                        ? `Select ${pickerName}${pickerSize ? ` #${pickerSize}` : ''} / ${pickerName2}${pickerSize2 ? ` #${pickerSize2}` : ''}`
                        : `Select ${pickerName}${pickerSize ? ` #${pickerSize}` : ''}${pickerColor ? ` · ${pickerColor}` : ''}`
                      : 'Choose a fly name'}
                </Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Event Timeline */}
      <ScrollView style={[styles.timeline, { zIndex: 0 }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.timelineTitle}>Timeline</Text>
        {[...events].reverse().map((event: TripEvent) => (
          <View key={event.id} style={styles.timelineItem}>
            <Text style={styles.timelineTime}>{formatEventTime(event.timestamp)}</Text>
            <View style={styles.timelineContent}>
              <View style={styles.timelineDot}>
                {event.event_type === 'catch' ? (
                  <MaterialCommunityIcons name="fish" size={14} color={Colors.primary} />
                ) : event.event_type === 'fly_change' ? (
                  <MaterialCommunityIcons name="hook" size={14} color={Colors.accent} />
                ) : event.event_type === 'ai_query' ? (
                  <MaterialIcons name="smart-toy" size={14} color={Colors.info} />
                ) : event.event_type === 'bite' ? (
                  <MaterialCommunityIcons name="fish" size={14} color={Colors.accent} />
                ) : event.event_type === 'fish_on' ? (
                  <MaterialIcons name="touch-app" size={14} color={Colors.primary} />
                ) : event.event_type === 'got_off' ? (
                  <MaterialIcons name="highlight-off" size={14} color={Colors.textSecondary} />
                ) : (
                  <MaterialIcons name="edit-note" size={14} color={Colors.textSecondary} />
                )}
              </View>
              <View style={styles.timelineTextBlock}>
                <Text style={styles.timelineText}>
                  {getEventDescription(event)}
                </Text>
                {event.event_type === 'catch' ? (
                  <CatchDetailsBlock data={event.data as CatchData} />
                ) : null}
                {event.event_type === 'catch' && (event.data as CatchData).photo_url ? (
                  <Pressable onPress={() => onCatchPhotoPress?.(event)}>
                    <Image
                      source={{ uri: (event.data as CatchData).photo_url! }}
                      style={styles.timelineCatchThumb}
                    />
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/* ─── Photos Tab ─── */

const PHOTO_SIZE = (Dimensions.get('window').width - Spacing.lg * 2 - Spacing.sm * 2) / 3;

function PhotosTab({
  tripPhotos,
  loading,
  uploading,
  onAddPhoto,
  onPhotoPress,
}: {
  tripPhotos: Photo[];
  loading: boolean;
  uploading: boolean;
  onAddPhoto: () => void;
  onPhotoPress?: (photo: Photo) => void;
}) {
  return (
    <ScrollView style={styles.photosTabScroll} contentContainerStyle={styles.photosTabContent}>
      <View style={styles.photosTabHeader}>
        <Text style={styles.photosTabTitle}>Trip photos</Text>
        <Pressable style={styles.addTripPhotoButton} onPress={onAddPhoto} disabled={uploading}>
          {uploading ? (
            <ActivityIndicator size="small" color={Colors.primary} />
          ) : (
            <>
              <MaterialIcons name="add-a-photo" size={18} color={Colors.primary} />
              <Text style={styles.addTripPhotoButtonText}>Add</Text>
            </>
          )}
        </Pressable>
      </View>
      {loading ? (
        <View style={styles.photosTabPlaceholder}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : tripPhotos.length === 0 ? (
        <Pressable style={styles.photosTabEmpty} onPress={onAddPhoto}>
          <MaterialIcons name="photo-library" size={48} color={Colors.textTertiary} />
          <Text style={styles.photosTabEmptyText}>No photos yet</Text>
          <Text style={styles.photosTabEmptyHint}>Add photos from this trip</Text>
        </Pressable>
      ) : (
        <View style={styles.photosTabGrid}>
          {tripPhotos.map((photo) => (
            <Pressable key={photo.id} onPress={() => onPhotoPress?.(photo)}>
              <Image source={{ uri: photo.url }} style={styles.tripPhotoThumb} />
            </Pressable>
          ))}
          <Pressable style={styles.tripPhotoAddSlot} onPress={onAddPhoto} disabled={uploading}>
            <MaterialIcons name="add" size={32} color={Colors.primary} />
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

/* ─── Map Tab (MapLibre + OSM-style: water, streams, dams) ─── */

// OSM-style map (good water/dam/stream detail). No API key required.
const MAP_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

function TripMapTab({
  mapLocation,
  mapLocationLoading,
  mapLocationError,
  onRequestLocation,
}: {
  mapLocation: { lat: number; lon: number } | null;
  mapLocationLoading: boolean;
  mapLocationError: string | null;
  onRequestLocation: () => Promise<void>;
}) {
  useEffect(() => {
    if (mapLocation == null && !mapLocationLoading) {
      onRequestLocation();
    }
  }, [mapLocation, mapLocationLoading]);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.mapTabPlaceholder}>
        <MaterialIcons name="map" size={48} color={Colors.textTertiary} />
        <Text style={styles.mapTabPlaceholderText}>Map is available in the iOS and Android app.</Text>
      </View>
    );
  }

  if (mapLocationError) {
    return (
      <View style={styles.mapTabPlaceholder}>
        <MaterialIcons name="location-off" size={48} color={Colors.textTertiary} />
        <Text style={styles.mapTabPlaceholderText}>{mapLocationError}</Text>
        <Pressable style={styles.mapTabRetryButton} onPress={onRequestLocation}>
          <Text style={styles.mapTabRetryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  if (mapLocationLoading || !mapLocation) {
    return (
      <View style={styles.mapTabPlaceholder}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.mapTabPlaceholderText}>Getting your location…</Text>
      </View>
    );
  }

  if (!MapView || !Camera || !UserLocation) {
    return (
      <View style={styles.mapTabPlaceholder}>
        <MaterialIcons name="map" size={48} color={Colors.textTertiary} />
        <Text style={styles.mapTabPlaceholderText}>
          Map requires a development build. Use Expo Go for other trip features.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.mapTabContainer}>
      <MapView
        style={styles.mapTabMap}
        mapStyle={MAP_STYLE_URL}
        compassEnabled
      >
        <Camera
          defaultSettings={{
            centerCoordinate: [mapLocation.lon, mapLocation.lat],
            zoomLevel: 15,
          }}
        />
        <UserLocation visible />
      </MapView>
    </View>
  );
}

/* ─── AI Guide Tab ─── */

function AIGuideTab({
  messages, input, setInput, loading, onSend, scrollRef,
  strategySlot,
}: any) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={180}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.aiScrollView}
        contentContainerStyle={styles.aiScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Strategy (Best time, Top flies, How to fish it) */}
        {strategySlot}

        <Text style={styles.aiContextNote}>
          AI uses your trip history, current conditions, and fishing data to give personalized advice.
        </Text>

        {/* Chat Messages */}
        {messages.map((msg: any) => (
          <View
            key={msg.id}
            style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble]}
          >
            <Text style={[styles.bubbleText, msg.role === 'user' ? styles.userBubbleText : styles.aiBubbleText]}>
              {msg.text}
            </Text>
          </View>
        ))}

        {loading && (
          <View style={[styles.bubble, styles.aiBubble]}>
            <ActivityIndicator size="small" color={Colors.primary} style={{ marginRight: 8 }} />
            <Text style={styles.aiBubbleText}>Thinking...</Text>
          </View>
        )}
      </ScrollView>

      {/* Input */}
      <View style={styles.aiInputRow}>
        <TextInput
          style={styles.aiInput}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about this trip..."
          placeholderTextColor={Colors.textTertiary}
          returnKeyType="send"
          onSubmitEditing={onSend}
        />
        <Pressable
          style={[styles.aiSendButton, (!input.trim() || loading) && styles.aiSendButtonDisabled]}
          onPress={onSend}
          disabled={!input.trim() || loading}
        >
          <Text style={styles.aiSendButtonText}>Ask</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ─── Helpers ─── */

function formatLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function CatchDetailsBlock({ data }: { data: CatchData }) {
  const lines: string[] = [];
  if (data.note?.trim()) lines.push(data.note.trim());
  if (data.depth_ft != null) lines.push(`Depth: ${data.depth_ft} ft`);
  if (data.structure) lines.push(`Structure: ${formatLabel(data.structure)}`);
  if (data.presentation_method) lines.push(`Presentation: ${formatLabel(data.presentation_method)}`);
  if (data.released != null) lines.push(`Released: ${data.released ? 'Yes' : 'No'}`);
  if (lines.length === 0) return null;
  return (
    <View style={styles.timelineCatchDetails}>
      {lines.map((line, i) => (
        <Text key={i} style={styles.timelineCatchDetailLine}>{line}</Text>
      ))}
    </View>
  );
}

function getEventDescription(event: TripEvent): string {
  switch (event.event_type) {
    case 'catch': {
      const data = event.data as CatchData;
      const parts: string[] = [];
      if (data.species) parts.push(data.species);
      if (data.size_inches != null) parts.push(`${data.size_inches}"`);
      const qty = data.quantity != null && data.quantity > 1 ? data.quantity : 1;
      const main = parts.length ? `Caught ${parts.join(' · ')}${qty > 1 ? ` (×${qty})` : ''}` : (qty > 1 ? `${qty} fish caught!` : 'Fish caught!');
      return main;
    }
    case 'fly_change': {
      const data = event.data as FlyChangeData;
      const primary = `${data.pattern}${data.size ? ` #${data.size}` : ''}`;
      return data.pattern2
        ? `Changed to ${primary} / ${data.pattern2}${data.size2 ? ` #${data.size2}` : ''}`
        : `Changed to ${primary}`;
    }
    case 'note': {
      const data = event.data as NoteData;
      return data.text;
    }
    case 'ai_query': {
      const data = event.data as AIQueryData;
      return `Asked AI: ${data.question}`;
    }
    case 'bite':
      return 'Bite';
    case 'fish_on':
      return 'Fish On';
    case 'got_off':
      return 'Got off';
    default:
      return 'Event';
  }
}

/* ─── Styles ─── */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: FontSize.lg,
    color: Colors.textSecondary,
  },
  backButton: {
    marginTop: Spacing.md,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  backButtonText: {
    color: Colors.textInverse,
    fontWeight: '600',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.primary,
  },
  locationName: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.textInverse,
  },
  timerText: {
    fontSize: FontSize.md,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  offlineBadge: {
    backgroundColor: Colors.warning,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  offlineBadgeText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.text,
  },
  cachedDataBanner: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.warning + '18',
  },
  cachedDataBannerText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  endButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  endButtonText: {
    color: Colors.textInverse,
    fontWeight: '600',
    fontSize: FontSize.md,
  },

  // Tab Bar
  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.sm + 2,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: Colors.primary,
  },
  // tabIcon intentionally removed — using Material Icons
  tabLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textTertiary,
  },
  tabLabelActive: {
    color: Colors.primary,
  },
  tabScroll: {
    flex: 1,
  },
  strategyTabContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  strategySectionLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.xs,
    marginTop: Spacing.sm,
  },
  strategySectionLabelFirst: {
    marginTop: 0,
  },
  strategyCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  strategyLoader: {
    marginVertical: Spacing.xs,
  },
  strategyBestTime: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  strategyPlaceholder: {
    fontSize: FontSize.md,
    color: Colors.textTertiary,
    fontStyle: 'italic',
  },
  strategyFliesWrap: {
    gap: 2,
  },
  strategyFlyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 2,
  },
  strategyFlyBullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.secondary,
  },
  strategyFlyName: {
    fontSize: FontSize.md,
    color: Colors.text,
    flex: 1,
  },
  strategyHowToFishText: {
    fontSize: FontSize.md,
    color: Colors.text,
    lineHeight: 24,
  },

  // Photos Tab
  photosTabScroll: {
    flex: 1,
  },
  photosTabContent: {
    padding: Spacing.lg,
  },
  photosTabHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  photosTabTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  addTripPhotoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  addTripPhotoButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primary,
  },
  photosTabPlaceholder: {
    minHeight: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
  photosTabEmpty: {
    minHeight: 200,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photosTabEmptyText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
  },
  photosTabEmptyHint: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginTop: 4,
  },
  photosTabGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  tripPhotoThumb: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.borderLight,
  },
  tripPhotoAddSlot: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: BorderRadius.md,
    borderWidth: 2,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Fishing Tab
  nextFlyBanner: {
    backgroundColor: Colors.accent,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  nextFlyLeft: {
    flex: 1,
  },
  nextFlyLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textInverse,
    textTransform: 'uppercase',
  },
  nextFlyName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textInverse,
  },
  nextFlyReason: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  nextFlyTap: {
    fontSize: FontSize.xs,
    color: 'rgba(255,255,255,0.7)',
  },
  currentFlyBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    zIndex: 1,
    elevation: 1,
  },
  currentFlyLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  currentFlyName: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  fishCounterSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl,
    gap: Spacing.xl,
  },
  fishMinusButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
  },
  fishPlusButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  fishButtonText: {
    fontSize: 32,
    fontWeight: '300',
    color: Colors.text,
  },
  fishPlusButtonText: {
    fontSize: 32,
    fontWeight: '300',
    color: Colors.textInverse,
  },
  fishCountDisplay: {
    alignItems: 'center',
    minWidth: 80,
  },
  fishCountNumber: {
    fontSize: FontSize.hero,
    fontWeight: '700',
    color: Colors.primary,
  },
  fishCountLabel: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
  },
  actionRowTight: {
    marginBottom: Spacing.xs,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  // actionEmoji intentionally removed — using Material Icons
  actionLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
  },
  noteInputRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  noteInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noteSubmit: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  noteSubmitText: {
    color: Colors.textInverse,
    fontWeight: '600',
  },
  flyPickerModalContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'transparent',
  },
  flyPickerBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  flyPickerSheet: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    overflow: 'hidden',
  },
  flyPickerSheetSized: {
    maxHeight: Dimensions.get('window').height * 0.82,
    height: Dimensions.get('window').height * 0.82,
  },
  flyPickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  flyPickerTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  flyPickerClose: {
    fontSize: FontSize.md,
    color: Colors.primary,
    fontWeight: '600',
  },
  flyPickerScroll: {
    flex: 1,
  },
  flyPickerContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  flyPickerFooter: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingBottom: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  flyThumbnailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  flyThumbnailImage: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.border,
  },
  flyThumbnailRemove: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  flyThumbnailRemoveText: {
    fontSize: FontSize.sm,
    color: Colors.primary,
    fontWeight: '600',
  },
  flyThumbnailAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border,
  },
  flyThumbnailAddText: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
  },
  flyFieldLabel: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
    marginTop: Spacing.sm,
  },
  flyNameSearchInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
    marginBottom: Spacing.sm,
  },
  chipScroll: {
    marginBottom: Spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  chip: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 2,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  chipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '15',
  },
  chipText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  chipTextActive: {
    color: Colors.primary,
    fontWeight: '600',
  },
  confirmFlyButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  confirmFlyButtonDisabled: {
    backgroundColor: Colors.border,
  },
  confirmFlyButtonText: {
    color: Colors.textInverse,
    fontSize: FontSize.md,
    fontWeight: '600',
  },
  catchModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  catchModalOverlay: {
    width: '100%',
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
    maxWidth: 400,
  },
  catchModal: {
    alignSelf: 'stretch',
    width: '100%',
    height: '88%',
    maxHeight: '88%',
    maxWidth: 400,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
  },
  catchModalHeader: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  catchModalScroll: {
    flex: 1,
  },
  catchModalScrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  catchModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  catchFlyDropdownRowWrap: {
    flexDirection: 'row',
    gap: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  catchFlyDropdownCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catchFlyDropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catchFlyDropdownValue: {
    fontSize: FontSize.sm,
    color: Colors.text,
    flex: 1,
  },
  catchFlyDropdownPlaceholder: {
    color: Colors.textTertiary,
  },
  catchFlyPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  catchFlyPickerSheet: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    maxHeight: '60%',
  },
  catchFlyPickerList: {
    maxHeight: 320,
  },
  catchFlyPickerOption: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  catchFlyPickerOptionActive: {
    backgroundColor: Colors.background,
  },
  catchFlyPickerOptionText: {
    fontSize: FontSize.md,
    color: Colors.text,
  },
  catchFlyPickerOptionTextActive: {
    color: Colors.primary,
    fontWeight: '600',
  },
  catchFlyRadioRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  catchFlyRadioOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  catchFlyRadioLabel: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  catchFlyRadioLabelActive: {
    color: Colors.text,
    fontWeight: '600',
  },
  addDropperButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
    alignSelf: 'flex-start',
  },
  addDropperButtonText: {
    fontSize: FontSize.sm,
    color: Colors.primary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  tripPhotoModal: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    width: '100%',
    maxWidth: 360,
  },
  tripPhotoModalTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  tripPhotoModalHint: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginBottom: Spacing.md,
  },
  tripPhotoModalInput: {
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
  tripPhotoModalButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  tripPhotoModalCancel: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tripPhotoModalCancelText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
  },
  tripPhotoModalSave: {
    flex: 1,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.primary,
    minHeight: 40,
  },
  tripPhotoModalSaveDisabled: {
    opacity: 0.7,
  },
  tripPhotoModalSaveText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.textInverse,
  },
  fullScreenPhotoWrap: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  fullScreenPhotoClose: {
    position: 'absolute',
    right: Spacing.lg,
    zIndex: 10,
    padding: Spacing.sm,
  },
  fullScreenPhotoScroll: {
    flex: 1,
  },
  fullScreenPhotoScrollContent: {
    flexGrow: 1,
  },
  fullScreenPhotoImage: {
    marginTop: Spacing.sm,
  },
  fullScreenPhotoInfo: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.xs,
  },
  fullScreenPhotoInfoRow: {
    fontSize: FontSize.md,
    color: Colors.textInverse,
    marginBottom: Spacing.xs,
  },
  fullScreenPhotoCaption: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    marginTop: Spacing.xs,
  },
  catchModalInput: {
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
  catchModalNoteInput: {
    minHeight: 64,
  },
  catchPhotoRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  catchPhotoButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  catchPhotoButtonLabel: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primary,
  },
  catchPhotoPreviewWrap: {
    position: 'relative',
    width: 120,
    height: 120,
  },
  catchPhotoPreview: {
    width: 120,
    height: 120,
    borderRadius: BorderRadius.md,
  },
  catchPhotoRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tripPhotoPickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  tripPhotoPickerCard: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    maxHeight: '80%',
    paddingBottom: Spacing.xl,
  },
  tripPhotoPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tripPhotoPickerTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
  },
  tripPhotoPickerEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xl * 2,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
  },
  tripPhotoPickerEmptyText: {
    fontSize: FontSize.md,
    color: Colors.text,
    fontWeight: '500',
  },
  tripPhotoPickerEmptyHint: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  tripPhotoPickerScroll: {
    maxHeight: 400,
  },
  tripPhotoPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    padding: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  tripPhotoPickerThumbWrap: {
    width: (Dimensions.get('window').width - Spacing.lg * 2 - Spacing.sm * 2) / 3,
    aspectRatio: 1,
  },
  tripPhotoPickerThumb: {
    width: '100%',
    height: '100%',
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  quantityBtn: {
    width: 36,
    height: 36,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quantityBtnText: {
    fontSize: FontSize.lg,
    color: Colors.text,
    fontWeight: '600',
  },
  quantityValue: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    minWidth: 24,
    textAlign: 'center',
  },
  catchModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  catchModalCancel: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  catchModalCancelText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  timeline: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  timelineTitle: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.md,
    marginTop: Spacing.md,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  timelineTime: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    width: 65,
    paddingTop: 2,
  },
  timelineContent: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
  },
  timelineDot: {
    width: 20,
    alignItems: 'center' as const,
    paddingTop: 2,
  },
  timelineTextBlock: {
    flex: 1,
    gap: Spacing.sm,
  },
  timelineText: {
    fontSize: FontSize.sm,
    color: Colors.text,
  },
  timelineCatchDetails: {
    marginTop: Spacing.xs,
    gap: 2,
  },
  timelineCatchDetailLine: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
  },
  timelineCatchThumb: {
    width: 72,
    height: 72,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface,
  },

  mapTabContainer: {
    flex: 1,
    minHeight: 280,
  },
  mapTabMap: {
    flex: 1,
    width: '100%',
    minHeight: 280,
  },
  mapTabPlaceholder: {
    flex: 1,
    minHeight: 280,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  mapTabPlaceholderText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  mapTabRetryButton: {
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
  },
  mapTabRetryButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: '#fff',
  },

  // AI Guide Tab
  aiScrollView: {
    flex: 1,
  },
  aiScrollContent: {
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  aiGetRecButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  aiGetRecButtonText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.primary,
  },
  smartRecCard: {
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
    position: 'relative',
    overflow: 'hidden',
  },
  smartRecHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  smartRecTitle: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  smartRecRefresh: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  smartRecRefreshText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.primary,
  },
  smartRecFly: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  smartRecColor: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  smartRecReason: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  smartRecFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
  },
  confidenceBadge: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs,
  },
  confidenceText: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  switchFlyButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  switchFlyButtonText: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.textInverse,
  },
  smartRecLoadingOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: BorderRadius.lg,
  },
  aiContextNote: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: Spacing.lg,
    marginVertical: Spacing.xs,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surface,
  },
  bubbleText: {
    fontSize: FontSize.md,
    lineHeight: 22,
    flex: 1,
  },
  userBubbleText: {
    color: Colors.textInverse,
  },
  aiBubbleText: {
    color: Colors.text,
  },
  aiInputRow: {
    flexDirection: 'row',
    padding: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  aiInput: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
  },
  aiSendButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  aiSendButtonDisabled: {
    opacity: 0.5,
  },
  aiSendButtonText: {
    color: Colors.textInverse,
    fontWeight: '600',
    fontSize: FontSize.md,
  },
});
