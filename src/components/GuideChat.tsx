import { GuideChatLinkedSpots } from '@/src/components/GuideChatLinkedSpots';
import { GuideChatWebSources } from '@/src/components/GuideChatWebSources';
import { SpotTaggedText } from '@/src/components/SpotTaggedText';
import type { GuideIntelSource, GuideLocationRecommendation } from '@/src/services/guideIntelContract';
import { GuideLocationRecommendationCards } from '@/src/components/GuideLocationRecommendationCards';
import { OfflineFallbackGuide } from '@/src/components/OfflineFallbackGuide';
import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { askAI } from '@/src/services/ai';
import type { AIContext } from '@/src/services/ai';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useSimulateOfflineStore } from '@/src/stores/simulateOfflineStore';
import { effectiveIsAppOnline } from '@/src/utils/netReachability';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type RefreshControlProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface Message {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: Date;
  linkedSpots?: { id: string; name: string }[];
  ambiguousSpots?: { extractedPhrase: string; candidates: { id: string; name: string }[] }[];
  webSources?: GuideIntelSource[];
  sourcesFetchedAt?: string;
  locationRecommendation?: GuideLocationRecommendation | null;
}

export interface GuideChatProps {
  /** Called before each AI reply. `question` is the message just sent (used to match catalog waters + catch logs). */
  getContext: (opts: { question: string }) => Promise<AIContext>;
  /** For modal: show header with close button. */
  variant?: 'full' | 'modal';
  /** Modal only: close callback. */
  onClose?: () => void;
  /** Override welcome title. */
  welcomeTitle?: string;
  /** Override welcome subtitle. */
  welcomeSubtitle?: string;
  /** Optional top padding (e.g. safe area). */
  contentTopPadding?: number;
  /** Rendered above chat bubbles (e.g. home briefing). When set, the default welcome card is hidden. */
  listHeaderComponent?: ReactNode;
  /** Pull-to-refresh on the message scroll area (e.g. home). */
  refreshControl?: ReactElement<RefreshControlProps>;
  /** Full layout only: e.g. notifications bell, top-right above the message list. */
  topBarAccessory?: ReactNode;
}

const DEFAULT_TITLE = 'AI Fishing Guide';
const DEFAULT_SUBTITLE = "Ask me anything about fishing — what fly to use, where to fish, technique tips, or why the fish aren't biting.";
const MODAL_TITLE = 'Ask DriftGuide';
const MODAL_SUBTITLE = "Planning a trip? Ask where to go, what to use, or anything else — I'll use your planned time and location when relevant.";

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    modalHeaderTitle: {
      fontSize: FontSize.lg,
      fontWeight: '700',
      color: colors.text,
    },
    modalCloseButton: {
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.sm,
    },
    modalCloseText: {
      fontSize: FontSize.md,
      fontWeight: '600',
      color: colors.primary,
    },
    messages: {
      flex: 1,
    },
    messagesContent: {
      paddingTop: Spacing.lg,
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.xxl,
      gap: Spacing.sm,
    },
    messagesContentFabClearance: {
      paddingBottom: Spacing.xxl + 88,
    },
    welcomeCard: {
      backgroundColor: colors.surface,
      borderRadius: BorderRadius.md,
      padding: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    welcomeTitle: {
      fontSize: FontSize.xl,
      fontWeight: '700',
      color: colors.text,
    },
    welcomeText: {
      fontSize: FontSize.md,
      color: colors.textSecondary,
      marginTop: Spacing.sm,
      lineHeight: 22,
    },
    offlineChatHint: {
      fontSize: FontSize.sm,
      color: colors.textSecondary,
      marginBottom: Spacing.md,
      lineHeight: 20,
      paddingHorizontal: Spacing.lg,
    },
    bubble: {
      maxWidth: '92%',
      borderRadius: BorderRadius.lg,
      padding: Spacing.md,
    },
    userBubble: {
      alignSelf: 'flex-end',
      backgroundColor: colors.primary,
    },
    aiBubble: {
      alignSelf: 'flex-start',
      backgroundColor: colors.surface,
    },
    bubbleText: {
      fontSize: FontSize.md,
      lineHeight: 22,
    },
    userBubbleText: {
      color: colors.textInverse,
    },
    aiBubbleText: {
      color: colors.text,
    },
    inputRow: {
      flexDirection: 'row',
      padding: Spacing.md,
      gap: Spacing.sm,
      backgroundColor: colors.surface,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    input: {
      flex: 1,
      backgroundColor: colors.background,
      borderRadius: BorderRadius.full,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      fontSize: FontSize.md,
      color: colors.text,
    },
    sendButton: {
      backgroundColor: colors.primary,
      borderRadius: BorderRadius.full,
      paddingHorizontal: Spacing.lg,
      justifyContent: 'center',
    },
    sendButtonDisabled: {
      opacity: 0.5,
    },
    sendButtonText: {
      color: colors.textInverse,
      fontWeight: '600',
      fontSize: FontSize.md,
    },
  });
}

export default function GuideChat({
  getContext,
  variant = 'full',
  onClose,
  welcomeTitle = variant === 'modal' ? MODAL_TITLE : DEFAULT_TITLE,
  welcomeSubtitle = variant === 'modal' ? MODAL_SUBTITLE : DEFAULT_SUBTITLE,
  contentTopPadding = 0,
  listHeaderComponent,
  refreshControl,
  topBarAccessory,
}: GuideChatProps) {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [rawNetOn, setRawNetOn] = useState(true);
  const simulateOffline = useSimulateOfflineStore((s) => s.simulateOffline);
  const scrollRef = useRef<ScrollView>(null);
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const netOn = useMemo(
    () => effectiveIsAppOnline(rawNetOn),
    [rawNetOn, simulateOffline],
  );

  useEffect(() => {
    const sub = NetInfo.addEventListener((s) => {
      setRawNetOn(Boolean(s.isConnected && s.isInternetReachable !== false));
    });
    void NetInfo.fetch().then((s) => {
      setRawNetOn(Boolean(s.isConnected && s.isInternetReachable !== false));
    });
    return () => sub();
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 100);
    }
  }, [messages.length, loading]);

  const sendMessage = async () => {
    const question = input.trim();
    if (!question || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: question,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const context = await getContext({ question });
      const response = await askAI(context, question);

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        text: response.text,
        timestamp: new Date(),
        linkedSpots: context.guideLinkedSpots,
        ambiguousSpots: context.guideLocationAmbiguous,
        webSources: response.sources,
        sourcesFetchedAt: response.fetchedAt,
        locationRecommendation: response.locationRecommendation,
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        text: "Sorry, I couldn't get a response right now. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } finally {
      setLoading(false);
    }
  };

  // iOS: offset must match top inset on this view only. Extra “tab bar” fudge here
  // increases KeyboardAvoidingView bottom padding (RN: keyboardY = screenY - offset),
  // which shows up as a gap between the composer and the keyboard on tab screens.
  const keyboardVerticalOffsetIos =
    variant === 'full' ? contentTopPadding : Math.max(insets.top, 64);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: contentTopPadding }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? keyboardVerticalOffsetIos : 0}
    >
      {variant === 'modal' && onClose && (
        <View style={styles.modalHeader}>
          <Text style={styles.modalHeaderTitle}>{welcomeTitle}</Text>
          <Pressable onPress={onClose} style={styles.modalCloseButton} hitSlop={12}>
            <Text style={styles.modalCloseText}>Close</Text>
          </Pressable>
        </View>
      )}

      {variant === 'full' && Boolean(topBarAccessory) ? (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingLeft: Spacing.md + insets.left,
            paddingRight: Spacing.md + insets.right,
            paddingBottom: 0,
          }}
        >
          {topBarAccessory}
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={[
          styles.messagesContent,
          variant === 'full' && Boolean(topBarAccessory) ? { paddingTop: Spacing.sm } : null,
          variant === 'full' && styles.messagesContentFabClearance,
        ]}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
      >
        {listHeaderComponent}
        {!listHeaderComponent && (
          <View style={styles.welcomeCard}>
            <Text style={styles.welcomeTitle}>{welcomeTitle}</Text>
            <Text style={styles.welcomeText}>{welcomeSubtitle}</Text>
          </View>
        )}

        {!netOn && messages.length === 0 ? <OfflineFallbackGuide /> : null}
        {!netOn ? (
          <Text style={styles.offlineChatHint}>
            Offline: replies use your trip, cached conditions, and saved catalog only. Reconnect for live AI and fresh data.
          </Text>
        ) : null}

        {messages.map((msg) =>
          msg.role === 'user' ? (
            <View key={msg.id} style={[styles.bubble, styles.userBubble]}>
              <Text style={[styles.bubbleText, styles.userBubbleText]}>{msg.text}</Text>
            </View>
          ) : (
            <View key={msg.id} style={[styles.bubble, styles.aiBubble]}>
              <SpotTaggedText text={msg.text} baseStyle={[styles.bubbleText, styles.aiBubbleText]} />
              {msg.locationRecommendation ? (
                <GuideLocationRecommendationCards recommendation={msg.locationRecommendation} colors={colors} />
              ) : null}
              <GuideChatLinkedSpots
                linkedSpots={msg.linkedSpots}
                ambiguous={msg.ambiguousSpots}
                colors={colors}
              />
              {msg.webSources && msg.webSources.length > 0 ? (
                <GuideChatWebSources
                  sources={msg.webSources}
                  fetchedAt={msg.sourcesFetchedAt}
                  colors={colors}
                />
              ) : null}
            </View>
          ),
        )}

        {loading ? (
          <View style={[styles.bubble, styles.aiBubble]}>
            <Text style={styles.aiBubbleText}>Thinking...</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={
            netOn ? 'Ask the AI Guide about fishing, tips, etc.' : 'Offline guide — ask using saved data…'
          }
          placeholderTextColor={colors.textTertiary}
          returnKeyType="send"
          onSubmitEditing={sendMessage}
          editable={!loading}
        />
        <Pressable
          style={[styles.sendButton, (!input.trim() || loading) && styles.sendButtonDisabled]}
          onPress={sendMessage}
          disabled={!input.trim() || loading}
        >
          <Text style={styles.sendButtonText}>Ask</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
