/** Small building blocks of the map screen: floating buttons, mark pins, stat cells. */
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { shapes, spacing } from '../../theme';
import { MarkKind } from '../../types/types';
import Icon, { IconName } from '../Icon';
import { ThemedText } from '../ThemedText';
import { haptics } from '../../utils/haptics';

export const MARK_STYLE: Record<MarkKind, { icon: IconName; color: string; label: string }> = {
    spot: { icon: 'Pin', color: '#4C8DF6', label: 'Spot' },
    fish: { icon: 'Fish', color: '#2FA39A', label: 'Fishing' },
    anchor: { icon: 'Anchor', color: '#5A6B85', label: 'Anchor' },
    danger: { icon: 'Alert', color: '#E5484D', label: 'Danger' },
    flag: { icon: 'Flag', color: '#E2A336', label: 'Flag' },
    home: { icon: 'House', color: '#8A6FD1', label: 'Home' },
    camp: { icon: 'Tent', color: '#3DA66E', label: 'Camp' },
};

/** A round button floating over the map. */
export const MapButton: React.FC<{
    icon: IconName;
    label: string;
    onPress: () => void;
    active?: boolean;
    style?: StyleProp<ViewStyle>;
    children?: React.ReactNode;
}> = ({ icon, label, onPress, active, style, children }) => {
    const { colors } = useTheme().theme;
    return (
        <Pressable
            onPress={() => {
                haptics.tap();
                onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={label}
            hitSlop={4}
            style={({ pressed }) => [
                styles.button,
                {
                    backgroundColor: pressed ? colors.elevated : colors.card,
                    borderColor: active ? colors.accent : colors.border,
                },
                style,
            ]}>
            {children ?? <Icon name={icon} size={20} tint={active ? colors.accent : colors.text} />}
        </Pressable>
    );
};

/** A saved place's pin: a colored disc with its icon, and the name under it. */
export const MarkPin: React.FC<{ kind: MarkKind; name?: string; selected?: boolean; onPress?: () => void }> = ({
    kind,
    name,
    selected,
    onPress,
}) => {
    const style = MARK_STYLE[kind];
    return (
        <Pressable onPress={onPress} hitSlop={8} style={styles.pin} accessibilityLabel={name ?? style.label}>
            <View style={[styles.disc, { backgroundColor: style.color }, selected && styles.discSelected]}>
                <Icon name={style.icon} size={14} tint="#FFFFFF" strokeWidth={2.2} />
            </View>
            {!!name && (
                <View style={styles.label}>
                    <ThemedText size="tiny" weight="strong" numberOfLines={1} style={styles.labelText}>
                        {name}
                    </ThemedText>
                </View>
            )}
        </Pressable>
    );
};

/** A numbered survey marker: a small disc with its number, and its note under it. */
export const NumberPin: React.FC<{ number: number; color: string; text?: string | null }> = ({ number, color, text }) => (
    <View style={styles.pin} accessibilityLabel={`Marker ${number}${text ? `, ${text}` : ''}`}>
        <View style={[styles.disc, styles.numberDisc, { backgroundColor: color }]}>
            <ThemedText size="tiny" weight="bold" style={styles.number}>
                {number}
            </ThemedText>
        </View>
        {!!text && (
            <View style={styles.label}>
                <ThemedText size="tiny" weight="strong" numberOfLines={1} style={styles.labelText}>
                    {text}
                </ThemedText>
            </View>
        )}
    </View>
);

/** One number in the map's info panel: label, big value, unit. */
export const Stat: React.FC<{ label: string; value: string; unit?: string; align?: 'left' | 'center' }> = ({
    label,
    value,
    unit,
    align = 'left',
}) => (
    <View style={[styles.stat, align === 'center' && styles.center]}>
        <ThemedText size="tiny" color="muted" caps>
            {label}
        </ThemedText>
        <View style={styles.statValue}>
            <ThemedText size="xlarge" weight="bold" tabular>
                {value}
            </ThemedText>
            {!!unit && (
                <ThemedText size="small" color="muted" style={styles.unit}>
                    {unit}
                </ThemedText>
            )}
        </View>
    </View>
);

/** An icon with a caption under it, for the panel's action row. */
export const PanelAction: React.FC<{
    icon: IconName;
    label: string;
    onPress: () => void;
    tint?: string;
    active?: boolean;
}> = ({ icon, label, onPress, tint, active }) => {
    const { colors } = useTheme().theme;
    const color = tint ?? (active ? colors.accent : colors.text);
    return (
        <Pressable
            onPress={() => {
                haptics.tap();
                onPress();
            }}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.elevated }]}>
            <Icon name={icon} size={20} tint={color} />
            <ThemedText size="tiny" weight="medium" style={[styles.actionLabel, { color }]} numberOfLines={1}>
                {label}
            </ThemedText>
        </Pressable>
    );
};

const styles = StyleSheet.create({
    button: {
        width: 46,
        height: 46,
        borderRadius: 23,
        borderWidth: shapes.borderWidth.thin,
        alignItems: 'center',
        justifyContent: 'center',
        elevation: shapes.elevation.medium,
    },
    pin: {
        alignItems: 'center',
        maxWidth: 120,
    },
    disc: {
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#FFFFFF',
        elevation: shapes.elevation.low,
    },
    numberDisc: {
        width: 22,
        height: 22,
        borderRadius: 11,
    },
    number: {
        color: '#FFFFFF',
    },
    discSelected: {
        transform: [{ scale: 1.25 }],
    },
    label: {
        marginTop: 2,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: shapes.borderRadius.small,
        backgroundColor: 'rgba(255,255,255,0.88)',
    },
    labelText: {
        color: '#1A1C20',
    },
    stat: {
        flex: 1,
    },
    center: {
        alignItems: 'center',
    },
    statValue: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginTop: 2,
    },
    unit: {
        marginLeft: 4,
    },
    action: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: spacing.sm - 2,
        borderRadius: shapes.borderRadius.medium,
    },
    actionLabel: {
        marginTop: 4,
    },
});
