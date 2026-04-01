import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import { askAI } from '@/src/services/ai';
import type { AIContext } from '@/src/services/ai';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  Image,
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

const DRIFTGUIDE_LOGO = require('@/assets/images/logo.png');

export interface Message {
  id: string;
  role: 'user' | 'ai';
  text: string;
  timestamp: Date;
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
  /** When true, assistant replies render as a thread row with the DriftGuide logo (e.g. Fish home). */
  useAssistantAvatar?: boolean;
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
    assistantRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.xs,
      alignSelf: 'stretch',
      maxWidth: '100%',
    },
    assistantAvatar: {
      width: 28,
      height: 28,
      borderRadius: BorderRadius.sm,
      marginTop: 2,
      backgroundColor: colors.surface,
    },
    assistantBubble: {
      flex: 1,
      minWidth: 0,
      maxWidth: '100%',
    },
    bubbleTextSm: {
      fontSize: FontSize.sm,
      lineHeight: 19,
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
    inputSm: {
      fontSize: FontSize.sm,
      paddingVertical: Spacing.xs + 2,
    },
    sendButtonTextSm: {
      fontSize: FontSize.sm,
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
  useAssistantAvatar = false,
}: GuideChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

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
        text: response,
        timestamp: new Date(),
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

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: contentTopPadding }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {variant === 'modal' && onClose && (
        <View style={styles.modalHeader}>
          <Text style={styles.modalHeaderTitle}>{welcomeTitle}</Text>
          <Pressable onPress={onClose} style={styles.modalCloseButton} hitSlop={12}>
            <Text style={styles.modalCloseText}>Close</Text>
          </Pressable>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        style={styles.messages}
        contentContainerStyle={[
          styles.messagesContent,
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

        {messages.map((msg) =>
          msg.role === 'user' ? (
            <View key={msg.id} style={[styles.bubble, styles.userBubble]}>
              <Text
                style={[
                  styles.bubbleText,
                  styles.userBubbleText,
                  useAssistantAvatar && styles.bubbleTextSm,
                ]}
              >
                {msg.text}
              </Text>
            </View>
          ) : useAssistantAvatar ? (
            <View key={msg.id} style={styles.assistantRow}>
              <Image source={DRIFTGUIDE_LOGO} style={styles.assistantAvatar} accessibilityLabel="DriftGuide" />
              <View style={[styles.bubble, styles.aiBubble, styles.assistantBubble]}>
                <Text style={[styles.bubbleText, styles.aiBubbleText, styles.bubbleTextSm]}>{msg.text}</Text>
              </View>
            </View>
          ) : (
            <View key={msg.id} style={[styles.bubble, styles.aiBubble]}>
              <Text style={[styles.bubbleText, styles.aiBubbleText]}>{msg.text}</Text>
            </View>
          ),
        )}

        {loading &&
          (useAssistantAvatar ? (
            <View style={styles.assistantRow}>
              <Image source={DRIFTGUIDE_LOGO} style={styles.assistantAvatar} accessibilityLabel="DriftGuide" />
              <View style={[styles.bubble, styles.aiBubble, styles.assistantBubble]}>
                <Text style={[styles.aiBubbleText, styles.bubbleTextSm]}>Thinking...</Text>
              </View>
            </View>
          ) : (
            <View style={[styles.bubble, styles.aiBubble]}>
              <Text style={styles.aiBubbleText}>Thinking...</Text>
            </View>
          ))}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={[styles.input, useAssistantAvatar && styles.inputSm]}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about fishing..."
          placeholderTextColor={colors.textTertiary}
          returnKeyType="send"
          onSubmitEditing={sendMessage}
        />
        <Pressable
          style={[styles.sendButton, (!input.trim() || loading) && styles.sendButtonDisabled]}
          onPress={sendMessage}
          disabled={!input.trim() || loading}
        >
          <Text style={[styles.sendButtonText, useAssistantAvatar && styles.sendButtonTextSm]}>Ask</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
