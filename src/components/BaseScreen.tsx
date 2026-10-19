import React, { useEffect } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { gutter, spacing } from '../theme';
import { ThemedText } from './ThemedText';
import changeNavigationBarColor from 'react-native-navigation-bar-color';
import { useTheme } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface BaseScreenProps {
    children: React.ReactNode;
    title?: string;
    subtitle?: string;
    headerRight?: React.ReactNode;
    headerLeft?: React.ReactNode;
    isLoading?: boolean;
    style?: object;
    showHeader?: boolean;
}

const BaseScreen: React.FC<BaseScreenProps> = ({
    children,
    title,
    subtitle,
    headerRight,
    headerLeft,
    isLoading = false,
    style = {},
    showHeader = true,
}) => {
    const { theme, isDarkMode } = useTheme();
    // Padding from the shared insets rather than a SafeAreaView per screen: that one
    // measures itself again when a screen comes back into view, so the header jumped
    // for a frame during the back animation.
    const insets = useSafeAreaInsets();

    useEffect(() => {
        changeNavigationBarColor(theme.colors.card, !isDarkMode);
    }, [isDarkMode, theme.colors.card]);

    return (
        <View
            style={[
                styles.container,
                {
                    backgroundColor: theme.colors.background,
                    paddingTop: insets.top,
                    paddingLeft: insets.left,
                    paddingRight: insets.right,
                },
                style,
            ]}>
            <StatusBar
                barStyle={isDarkMode ? 'light-content' : 'dark-content'}
                backgroundColor={theme.colors.background}
            />
            {showHeader && (
                <View style={styles.header}>
                    {headerLeft}
                    <View style={styles.titles}>
                        {title && (
                            <ThemedText size="xlarge" weight="bold" numberOfLines={1}>
                                {title}
                            </ThemedText>
                        )}
                        {subtitle && (
                            <ThemedText size="small" color="muted" style={styles.subtitle} numberOfLines={1}>
                                {subtitle}
                            </ThemedText>
                        )}
                    </View>
                    {headerRight}
                </View>
            )}

            <View style={[styles.content, style]}>
                {isLoading ? <ActivityIndicator size="large" color={theme.colors.accent} /> : children}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: gutter,
        paddingTop: spacing.md,
        paddingBottom: spacing.sm,
        minHeight: 64,
    },
    titles: {
        flex: 1,
    },
    subtitle: {
        marginTop: 2,
    },
    content: {
        flex: 1,
    },
});

export default BaseScreen;
