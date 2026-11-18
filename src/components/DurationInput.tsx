import { useRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { shapes } from '../theme';
import { ThemedText } from './ThemedText';

interface DurationInputProps {
    minutes: string;
    seconds: string;
    onChange: (minutes: string, seconds: string) => void;
}

const digits = (text: string) => text.replace(/[^0-9]/g, '').slice(0, 2);

/** mm:ss entry for a duration such as a breath-hold time. */
const DurationInput: React.FC<DurationInputProps> = ({ minutes, seconds, onChange }) => {
    const { colors } = useTheme().theme;
    const secondsRef = useRef<TextInput | null>(null);
    const inputStyle = [styles.input, { color: colors.text }];

    return (
        <View style={[styles.box, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
            <TextInput
                value={minutes}
                onChangeText={text => {
                    const m = digits(text);
                    onChange(m, seconds);
                    if (m.length === 2) {
                        secondsRef.current?.focus();
                    }
                }}
                placeholder="0"
                placeholderTextColor={colors.muted}
                autoComplete="off"
                importantForAutofill="no"
                selectionColor={colors.accent}
                keyboardType="number-pad"
                maxLength={2}
                style={inputStyle}
                accessibilityLabel="Minutes"
            />
            <ThemedText size="xlarge" weight="strong" color="muted">
                :
            </ThemedText>
            <TextInput
                ref={secondsRef}
                value={seconds}
                onChangeText={text => {
                    const s = digits(text);
                    if (s === '' || Number(s) <= 59) {
                        onChange(minutes, s);
                    }
                }}
                placeholder="00"
                placeholderTextColor={colors.muted}
                autoComplete="off"
                importantForAutofill="no"
                selectionColor={colors.accent}
                keyboardType="number-pad"
                maxLength={2}
                style={inputStyle}
                accessibilityLabel="Seconds"
            />
        </View>
    );
};

const styles = StyleSheet.create({
    box: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderRadius: shapes.borderRadius.medium,
        height: 64,
    },
    input: {
        width: 64,
        height: 60,
        fontSize: 30,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
        textAlign: 'center',
    },
});

export default DurationInput;
