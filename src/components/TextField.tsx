import { StyleProp, StyleSheet, TextInput, TextInputProps, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { gutter, shapes, spacing } from '../theme';

interface TextFieldProps extends Omit<TextInputProps, 'style' | 'onChangeText' | 'value'> {
    value: string;
    onChangeText: (text: string) => void;
    /** Page-width field with the side gutter (default), or flush inside a dialog or card. */
    inset?: boolean;
    /** Background: the card surface (default) or the page background, for fields inside dialogs. */
    surface?: 'card' | 'background';
    style?: StyleProp<ViewStyle>;
}

/** The app's single-line text input. */
const TextField: React.FC<TextFieldProps> = ({
    value,
    onChangeText,
    maxLength,
    inset = true,
    surface = 'card',
    style,
    ...rest
}) => {
    const { colors } = useTheme().theme;
    return (
        <TextInput
            // No password-manager suggestions unless a field asks for them.
            autoComplete="off"
            importantForAutofill="no"
            {...rest}
            value={value}
            onChangeText={text => onChangeText(maxLength ? text.slice(0, maxLength) : text)}
            maxLength={maxLength}
            placeholderTextColor={colors.muted}
            selectionColor={colors.accent}
            returnKeyType={rest.returnKeyType ?? 'done'}
            style={[
                styles.input,
                inset && styles.inset,
                { color: colors.text, borderColor: colors.border, backgroundColor: colors[surface] },
                style,
            ]}
        />
    );
};

const styles = StyleSheet.create({
    input: {
        height: 48,
        borderWidth: shapes.borderWidth.thin,
        borderRadius: shapes.borderRadius.medium,
        paddingHorizontal: spacing.md,
        fontSize: 15,
    },
    inset: {
        marginHorizontal: gutter,
    },
});

export default TextField;
