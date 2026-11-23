import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import ModalPanel from './ModalPanel';
import { ThemedText } from './ThemedText';
import Button from './Button';
import { shapes, spacing } from '../theme';
import { UNBLOCK_MESSAGES } from '../constants/strings';
import { useTheme } from '../context/ThemeContext';

interface PassphrasePopupProps {
    visible: boolean;
    onClose: () => void;
    onConfirm: () => void;
    /** Phrases to pick from; defaults to the unblock phrases. */
    phrases?: readonly string[];
    /** Replaces the default explanation under the title. */
    message?: string;
}

const pick = (phrases: readonly string[]) => phrases[Math.floor(Math.random() * phrases.length)];

/** Collapse runs of spaces and trim, so a stray double space never blocks a correct entry. */
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

export const passphraseMatches = (expected: string, typed: string) => normalize(expected) === normalize(typed);

const PassphrasePopup: React.FC<PassphrasePopupProps> = ({
    visible,
    onClose,
    onConfirm,
    phrases = UNBLOCK_MESSAGES,
    message = 'Passphrase protection is on. Type the text below exactly to continue.',
}) => {
    const { theme } = useTheme();
    const [phrase, setPhrase] = useState(() => pick(phrases));
    const [input, setInput] = useState('');
    const [showError, setShowError] = useState(false);
    const [focused, setFocused] = useState(false);

    // Fresh phrase and empty input every time the popup opens.
    useEffect(() => {
        if (visible) {
            setPhrase(pick(phrases));
            setInput('');
            setShowError(false);
        }
    }, [visible, phrases]);

    const isMatch = passphraseMatches(phrase, input);

    const handleConfirm = () => {
        if (!isMatch) {
            setShowError(true);
            return;
        }
        setInput('');
        onConfirm();
    };

    return (
        <ModalPanel visible={visible} onClose={onClose}>
            <ThemedText weight="bold" size="large">
                Type to confirm
            </ThemedText>
            <ThemedText size="small" color="muted" style={styles.subtitle}>
                {message}
            </ThemedText>

            <View style={[styles.phraseBox, { backgroundColor: theme.colors.elevated }]}>
                <HighlightMismatchText originalText={phrase} userInput={input} />
            </View>

            <TextInput
                style={[
                    styles.input,
                    {
                        color: theme.colors.text,
                        backgroundColor: theme.colors.background,
                        borderColor: showError
                            ? theme.colors.primaryRed
                            : focused
                            ? theme.colors.accent
                            : theme.colors.border,
                    },
                ]}
                placeholder="Type the text here"
                placeholderTextColor={theme.colors.muted}
                selectionColor={theme.colors.accent}
                value={input}
                onChangeText={text => {
                    setInput(text);
                    setShowError(false);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                spellCheck={false}
                multiline
                textAlignVertical="top"
            />

            {showError && (
                <ThemedText size="small" color="primaryRed" style={styles.error}>
                    The text doesn’t match yet. Red letters show where it differs.
                </ThemedText>
            )}

            <View style={styles.buttons}>
                <Button label="Cancel" variant="secondary" compact onPress={onClose} style={styles.flex} />
                <Button
                    label="Confirm"
                    compact
                    disabled={input.length === 0}
                    onPress={handleConfirm}
                    style={[styles.flex, styles.gap]}
                />
            </View>
        </ModalPanel>
    );
};

type Props = {
    originalText: string;
    userInput: string;
};

type LetterState = 'correct' | 'wrong' | 'untyped';

/** The phrase, colored per letter: typed correctly, typed wrong (red), or not typed yet (muted). */
const HighlightMismatchText: React.FC<Props> = ({ originalText, userInput }) => {
    const { theme } = useTheme();
    const segments: { text: string; state: LetterState }[] = [];

    for (let i = 0; i < originalText.length; i++) {
        const state: LetterState =
            i >= userInput.length ? 'untyped' : originalText[i] === userInput[i] ? 'correct' : 'wrong';
        const last = segments[segments.length - 1];
        if (last && last.state === state) {
            last.text += originalText[i];
        } else {
            segments.push({ text: originalText[i], state });
        }
    }

    const colors: Record<LetterState, string> = {
        correct: theme.colors.text,
        wrong: theme.colors.primaryRed,
        untyped: theme.colors.muted,
    };

    return (
        <Text style={styles.phrase}>
            {segments.map((segment, index) => (
                <Text key={index} style={{ color: colors[segment.state] }}>
                    {segment.text}
                </Text>
            ))}
        </Text>
    );
};

const styles = StyleSheet.create({
    subtitle: {
        marginTop: spacing.xs,
    },
    phraseBox: {
        alignSelf: 'stretch',
        borderRadius: shapes.borderRadius.medium,
        padding: spacing.md,
        marginTop: spacing.md,
    },
    phrase: {
        fontSize: 15,
        lineHeight: 22,
    },
    input: {
        alignSelf: 'stretch',
        minHeight: 96,
        maxHeight: 180,
        borderWidth: 1,
        borderRadius: shapes.borderRadius.medium,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        marginTop: spacing.md,
        fontSize: 15,
    },
    error: {
        alignSelf: 'stretch',
        marginTop: spacing.sm,
    },
    buttons: {
        flexDirection: 'row',
        marginTop: spacing.lg,
    },
    flex: {
        flex: 1,
    },
    gap: {
        marginLeft: spacing.sm,
    },
});

export default PassphrasePopup;
