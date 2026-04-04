import { useAppTheme } from '@/src/theme/ThemeProvider';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

const UUID =
  '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';
/** Full: <<spot:uuid:Middle Provo>> ; short: <<spot:uuid>> (name taken from text before tag when possible) */
const SPOT_TAG = new RegExp(`<<spot:${UUID}(?::([^>]*))?>>`, 'gi');

const SENTENCE_STARTERS = new Set([
  'The',
  'And',
  'But',
  'For',
  'You',
  'Try',
  'If',
  'When',
  'Then',
  'With',
  'This',
  'That',
  'Each',
  'Both',
  'Fish',
  'Focus',
  'Given',
  'Consider',
  'Look',
  'Also',
  'While',
]);

/** Strip wrapping quotes / smart quotes for display (never show quotes on the link). */
function normalizeSpotDisplayName(s: string): string {
  let t = s.trim().replace(/\s+/g, ' ');
  t = t.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, '');
  return t;
}

/**
 * For <<spot:uuid>> with no :label, use a name immediately before the tag
 * (e.g. `Middle Provo <<spot:…>>` or `"Lower Provo" <<spot:…>>`).
 */
function peelSpotNameBeforeTag(before: string): { prefix: string; name: string | null } {
  const t = before.replace(/\s+$/u, '');
  const quoted = t.match(/^(.*)"([^"]{2,60})"\s*$/);
  if (quoted) {
    const name = normalizeSpotDisplayName(quoted[2]);
    if (name.length >= 2) return { prefix: quoted[1], name };
  }
  const multi = t.match(/^(.*)\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*$/);
  if (multi && multi[2].length <= 56) {
    return { prefix: multi[1], name: multi[2] };
  }
  const single = t.match(/^(.*)\b([A-Z][a-z]{2,28})\s*$/);
  if (single && !SENTENCE_STARTERS.has(single[2])) {
    return { prefix: single[1], name: single[2] };
  }
  return { prefix: before, name: null };
}

type Segment = { type: 'text'; value: string } | { type: 'spot'; id: string; label: string };

function parseSegments(text: string): Segment[] {
  SPOT_TAG.lastIndex = 0;
  const parts: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = SPOT_TAG.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    const rawInTag = m[2] != null ? m[2].trim() : '';
    const explicit = normalizeSpotDisplayName(rawInTag);

    let textBeforeLink = before;
    let label = explicit.length >= 2 ? explicit : '';

    if (!label) {
      const peeled = peelSpotNameBeforeTag(before);
      if (peeled.name) {
        textBeforeLink = peeled.prefix;
        label = peeled.name;
      }
    }

    if (!label) {
      label = 'Details';
    }

    if (textBeforeLink.length > 0) {
      parts.push({ type: 'text', value: textBeforeLink });
    }
    parts.push({ type: 'spot', id: m[1].toLowerCase(), label });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push({ type: 'text', value: text.slice(last) });
  }
  return parts.length > 0 ? parts : [{ type: 'text', value: text }];
}

/**
 * Renders assistant text. Catalog spots: <<spot:uuid:name>> or <<spot:uuid>> → tappable name → `/spot/:id`.
 */
export function SpotTaggedText({
  text,
  baseStyle,
  linkStyle,
}: {
  text: string;
  baseStyle?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
}) {
  const router = useRouter();
  const { colors } = useAppTheme();
  const segments = useMemo(() => parseSegments(text), [text]);

  const defaultLink: TextStyle = useMemo(
    () => ({
      color: colors.secondary,
      textDecorationLine: 'underline',
      fontWeight: '600',
    }),
    [colors.secondary],
  );

  return (
    <Text style={baseStyle}>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <Text key={`t-${i}`} style={baseStyle}>
            {seg.value}
          </Text>
        ) : (
          <Text
            key={`s-${seg.id}-${i}`}
            accessibilityRole="link"
            accessibilityLabel={`${seg.label} in DriftGuide`}
            onPress={() => router.push(`/spot/${seg.id}`)}
            style={[baseStyle, defaultLink, linkStyle]}
          >
            {seg.label}
          </Text>
        ),
      )}
    </Text>
  );
}
