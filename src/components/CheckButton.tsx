import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Icon from './Icon';

interface CheckButtonProps {
    checked: boolean;
    onPress: () => void;
    size?: number;
    /** A circle instead of a rounded square, for light list rows. */
    round?: boolean;
    accessibilityLabel?: string;
}

/** Check-off control with a short, restrained confirm animation. */
const CheckButton: React.FC<CheckButtonProps> = ({ checked, onPress, size = 36, round, accessibilityLabel }) => {
    const { theme } = useTheme();
    const scale = useRef(new Animated.Value(1)).current;
    const wasChecked = useRef(checked);

    useEffect(() => {
        // Animate only on a real false -> true change, not on first render.
        if (checked && !wasChecked.current) {
            scale.setValue(0.85);
            Animated.timing(scale, {
                toValue: 1,
                duration: 180,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
            }).start();
        }
        wasChecked.current = checked;
    }, [checked, scale]);

    return (
        <Pressable
            onPress={onPress}
            hitSlop={10}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            accessibilityLabel={accessibilityLabel}>
            <Animated.View
                style={[
                    styles.box,
                    { width: size, height: size, borderRadius: round ? size / 2 : size * 0.3, borderColor: theme.colors.border },
                    checked && { backgroundColor: theme.colors.primaryGreen, borderColor: theme.colors.primaryGreen },
                    { transform: [{ scale }] },
                ]}>
                {checked && <Icon name="Check" size={size * 0.55} strokeWidth={2.6} tint="#FFFFFF" />}
            </Animated.View>
        </Pressable>
    );
};

const styles = StyleSheet.create({
    box: {
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export default CheckButton;
