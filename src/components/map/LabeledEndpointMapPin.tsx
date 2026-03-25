import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { BorderRadius, Colors, FontSize } from '@/src/constants/theme';

type Props = {
  label: string;
  backgroundColor: string;
  icon: 'place' | 'flag';
};

/** Mapbox PointAnnotation child: theme-colored bubble + text label (Start / End). */
export function LabeledEndpointMapPin({ label, backgroundColor, icon }: Props) {
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[styles.bubble, { backgroundColor }]}>
        <MaterialIcons name={icon} size={22} color={Colors.textInverse} />
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  bubble: {
    width: 34,
    height: 34,
    borderRadius: BorderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  label: {
    marginTop: 2,
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.text,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.92)',
    overflow: 'hidden',
  },
});
