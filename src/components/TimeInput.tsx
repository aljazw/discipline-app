import React, { useRef } from 'react';
import { View, TextInput, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { shapes, spacing } from '../theme';
import { useTheme } from '../context/ThemeContext';

interface TimeInputProps {
    label: string;
    hourValue: string;
    minutesValue: string;
    setHour: React.Dispatch<React.SetStateAction<string>>;
    setMinutes: React.Dispatch<React.SetStateAction<string>>;
}

const TimeInput: React.FC<TimeInputProps> = ({ label, hourValue, minutesValue, setHour, setMinutes }) => {
    const minutesRef = useRef<TextInput | null>(null);

    const handleHourChange = (text: string) => {
        const numericText = text.replace(/[^0-9]/g, '');
        if (numericText.length === 1) {
            const firstDigit = parseInt(numericText, 10);

            if (firstDigit > 2) {
                const fixedText = '0' + firstDigit;
                setHour(fixedText);
                minutesRef.current?.focus();
            } else {
                setHour(numericText);
            }
        } else if (numericText.length === 2) {
            const hour = parseInt(numericText, 10);

            if (hour > 23) {
                setHour(prev => prev);
            } else {
                setHour(numericText);
                minutesRef.current?.focus();
            }
        } else {
            setHour(numericText);
        }
    };

    const handleMinutesChange = (text: string) => {
        const numericText = text.replace(/[^0-9]/g, '');

        if (numericText.length === 1) {
            const firstDigit = parseInt(numericText, 10);

            if (firstDigit > 5) {
                setMinutes(prev => prev);
            } else {
                setMinutes(numericText);
            }
        } else if (numericText.length === 2) {
            const hour = parseInt(numericText, 10);

            if (hour > 59) {
                setMinutes(prev => prev);
            } else {
                setMinutes(numericText);
            }
        } else {
            setMinutes(numericText);
        }
    };

    const { theme } = useTheme();

    const inputStyle = [styles.input, { color: theme.colors.text }];

    return (
        <View style={styles.container}>
            <ThemedText size="small" color="muted" weight="medium">
                {label}
            </ThemedText>
            <View
                style={[
                    styles.inputContainer,
                    { backgroundColor: theme.colors.elevated, borderColor: theme.colors.border },
                ]}>
                <TextInput
                    style={inputStyle}
                    value={hourValue}
                    onChangeText={text => handleHourChange(text)}
                    onBlur={() => {
                        if (hourValue.length === 1) {
                            setHour(`0${hourValue}`);
                        }
                    }}
                    placeholder="00"
                    placeholderTextColor={theme.colors.muted}
                    autoComplete="off"
                    importantForAutofill="no"
                    selectionColor={theme.colors.accent}
                    keyboardType="numeric"
                    maxLength={2}
                />
                <ThemedText size="xlarge" weight="strong" color="muted">
                    :
                </ThemedText>
                <TextInput
                    ref={minutesRef}
                    style={inputStyle}
                    value={minutesValue}
                    onChangeText={text => handleMinutesChange(text)}
                    onBlur={() => {
                        if (minutesValue.length === 1) {
                            setMinutes(`0${minutesValue}`);
                        }
                    }}
                    placeholder="00"
                    placeholderTextColor={theme.colors.muted}
                    autoComplete="off"
                    importantForAutofill="no"
                    selectionColor={theme.colors.accent}
                    keyboardType="numeric"
                    maxLength={2}
                />
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: shapes.borderWidth.thin,
        borderRadius: shapes.borderRadius.medium,
        height: 52,
        marginTop: spacing.xs + 2,
    },
    input: {
        marginHorizontal: spacing.xs,
        fontSize: 22,
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
        textAlign: 'center',
        width: 44,
        height: 50,
    },
});

export default TimeInput;
