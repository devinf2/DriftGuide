import { MaterialIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { ShareToFeedModal, type ShareToFeedDraft } from '@/src/components/feed/ShareToFeedModal';
import { BorderRadius, FontSize, Spacing } from '@/src/constants/theme';
import { useAppTheme } from '@/src/theme/ThemeProvider';
import type { PostRow } from '@/src/types';

type ShareToFeedButtonProps = {
  /** Fields prefilled from the originating trip or catch. */
  draft: ShareToFeedDraft;
  label?: string;
  onPosted?: (post: PostRow) => void;
};

/**
 * Drop-in "Share to feed" action. Reuse from a completed trip summary or an individual
 * catch: pass species/size/fly/photo + tripId/catchEventId in `draft`. Opens
 * {@link ShareToFeedModal}, which carries the per-post TripPhotoVisibilityDropdown.
 */
export function ShareToFeedButton({ draft, label = 'Share to feed', onPosted }: ShareToFeedButtonProps) {
  const { colors } = useAppTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.btn, { backgroundColor: colors.primary, borderRadius: BorderRadius.md }]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <MaterialIcons name="rss-feed" size={16} color={colors.textInverse} />
        <Text style={[styles.text, { color: colors.textInverse }]}>{label}</Text>
      </Pressable>
      <ShareToFeedModal
        visible={open}
        draft={draft}
        onClose={() => setOpen(false)}
        onPosted={onPosted}
      />
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  text: { fontSize: FontSize.sm, fontWeight: '700' },
});
