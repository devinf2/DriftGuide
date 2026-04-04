import { BorderRadius, FontSize, Spacing, type ThemeColors } from '@/src/constants/theme';
import type { GuideIntelSource } from '@/src/services/guideIntelContract';
import { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: {
      marginTop: Spacing.sm,
    },
    toggle: {
      alignSelf: 'flex-start',
      paddingVertical: 4,
      paddingHorizontal: 0,
    },
    toggleText: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.primary,
    },
    list: {
      marginTop: Spacing.xs,
      gap: Spacing.xs,
    },
    meta: {
      fontSize: FontSize.xs,
      color: colors.textTertiary,
      marginBottom: 2,
    },
    row: {
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      borderRadius: BorderRadius.md,
      backgroundColor: colors.background,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    title: {
      fontSize: FontSize.sm,
      fontWeight: '600',
      color: colors.text,
    },
    url: {
      fontSize: FontSize.xs,
      color: colors.primary,
      marginTop: 2,
    },
  });
}

export function GuideChatWebSources({
  sources,
  fetchedAt,
  colors,
}: {
  sources: GuideIntelSource[];
  fetchedAt?: string;
  colors: ThemeColors;
}) {
  const [open, setOpen] = useState(false);
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (sources.length === 0) return null;

  let meta: string | null = null;
  if (fetchedAt) {
    try {
      meta = `Checked ${new Date(fetchedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`;
    } catch {
      meta = null;
    }
  }

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.toggle} hitSlop={8}>
        <Text style={styles.toggleText}>
          {open ? 'Hide' : 'Web sources'} ({sources.length})
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.list}>
          {meta ? <Text style={styles.meta}>{meta}</Text> : null}
          {sources.map((s, i) => (
            <Pressable
              key={`${s.url}-${i}`}
              onPress={() => void Linking.openURL(s.url)}
              style={styles.row}
            >
              <Text style={styles.title} numberOfLines={2}>
                {s.title}
              </Text>
              <Text style={styles.url} numberOfLines={1}>
                {s.url}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
