import React, { useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import Icon from './Icon';
import { shapes, spacing } from '../theme';
import { ThemedView } from './ThemedView';
import { useTheme } from '../context/ThemeContext';

interface SearchBarProps {
    placeholder?: string;
    onSearch: (query: string) => void;
    value?: string;
    keyboardType?: 'url' | 'default';
}

const SearchBar: React.FC<SearchBarProps> = ({ placeholder = 'Search...', onSearch, value, keyboardType = 'url' }) => {
    const [internal, setInternal] = useState('');
    const [focused, setFocused] = useState(false);
    const query = value ?? internal;

    const update = (text: string) => {
        setInternal(text);
        onSearch(text);
    };

    const { theme } = useTheme();

    return (
        <ThemedView withBorder style={[styles.container, focused && { borderColor: theme.colors.accent }]}>
            <Icon name="Search" size={18} tint={theme.colors.muted} style={styles.iconSearch} />
            <TextInput
                style={[styles.input, { color: theme.colors.text }]}
                placeholder={placeholder}
                placeholderTextColor={theme.colors.muted}
                autoComplete="off"
                importantForAutofill="no"
                onChangeText={update}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="never"
                value={query}
                keyboardType={keyboardType}
                selectionColor={theme.colors.accent}
            />
            {query.length > 0 && (
                <Pressable onPress={() => update('')} hitSlop={10}>
                    <Icon name="Close" size={14} tint={theme.colors.muted} style={styles.iconClose} />
                </Pressable>
            )}
        </ThemedView>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 46,
        paddingHorizontal: spacing.sm,
        borderRadius: shapes.borderRadius.medium,
    },
    input: {
        flex: 1,
        textAlignVertical: 'center',
        fontSize: 16,
    },
    iconSearch: {
        marginHorizontal: spacing.xs,
    },
    iconClose: {
        marginHorizontal: spacing.sm,
    },
});

export default SearchBar;
