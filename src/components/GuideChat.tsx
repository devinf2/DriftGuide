import { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Colors, Spacing, FontSize, BorderRadius } from '@/src/constants/theme';
import { askAI } from '@/src/services/ai';
import type { AIContext } from '@/src/services/ai';

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
}

const DEFAULT_TITLE = 'AI Fishing Guide';
const DEFAULT_SUBTITLE = "Ask me anything about fishing — what fly to use, where to fish, technique tips, or why the fish aren't biting.";
const MODAL_TITLE = 'Ask DriftGuide';
const MODAL_SUBTITLE = "Planning a trip? Ask where to go, what to use, or anything else — I'll use your planned time and location when relevant.";

export default function GuideChat({
  getContext,
  variant = 'full',
  onClose,
  welcomeTitle = variant === 'modal' ? MODAL_TITLE : DEFAULT_TITLE,
  welcomeSubtitle = variant === 'modal' ? MODAL_SUBTITLE : DEFAULT_SUBTITLE,
  contentTopPadding = 0,
}: GuideChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

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
        contentContainerStyle={styles.messagesContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.welcomeCard}>
          <Text style={styles.welcomeTitle}>{welcomeTitle}</Text>
          <Text style={styles.welcomeText}>{welcomeSubtitle}</Text>
        </View>

        {messages.map((msg) => (
          <View
            key={msg.id}
            style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.aiBubble]}
          >
            <Text
              style={[
                styles.bubbleText,
                msg.role === 'user' ? styles.userBubbleText : styles.aiBubbleText,
              ]}
            >
              {msg.text}
            </Text>
          </View>
        ))}

        {loading && (
          <View style={[styles.bubble, styles.aiBubble]}>
            <Text style={styles.aiBubbleText}>Thinking...</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask about fishing..."
          placeholderTextColor={Colors.textTertiary}
          returnKeyType="send"
          onSubmitEditing={sendMessage}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  modalHeaderTitle: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.text,
  },
  modalCloseButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  modalCloseText: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.primary,
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: Spacing.xl,
    paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
  },
  welcomeCard: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  welcomeTitle: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  welcomeText: {
    fontSize: FontSize.md,
    color: Colors.textSecondary,
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
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
  },
  userBubbleText: {
    color: Colors.textInverse,
  },
  aiBubbleText: {
    color: Colors.text,
  },
  inputRow: {
    flexDirection: 'row',
    padding: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.md,
    color: Colors.text,
  },
  sendButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.full,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: Colors.textInverse,
    fontWeight: '600',
    fontSize: FontSize.md,
  },
});
