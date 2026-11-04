import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import Navigation from './src/navigation/Navigation';
import WelcomeScreen from './src/screens/WelcomeScreen';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { PassphraseProvider } from './src/context/PassphraseContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { useAppInitializer } from './src/hooks/useAppInitializer';
import { darkTheme } from './src/theme/dark';
import { setUserHasSeenWelcome } from './src/storage';
import { openAccessibilitySettings } from './src/utils/accessibility';
import { logger } from './src/utils/logger';

/**
 * Paints the theme background behind everything. Without it Android's default
 * window color (a lighter gray) shows for a moment while a screen comes back
 * into view on back navigation.
 */
const ThemedRoot: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { theme } = useTheme();
    return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>{children}</View>;
};

function App(): React.JSX.Element {
    const { status, setStatus } = useAppInitializer();

    const handleWelcomeComplete = async () => {
        try {
            await setUserHasSeenWelcome(true);
        } catch (error) {
            // Worst case the welcome screen shows again next launch; never block the user here.
            logger.warn('Could not save welcome flag', error);
        }
        openAccessibilitySettings();
        setStatus('main');
    };

    if (status === 'loading') {
        // Same color as the default dark theme, so startup doesn't flash white.
        return <View style={styles.splash} />;
    }

    return (
        <>
            <ThemeProvider>
                <ThemedRoot>
                    <PassphraseProvider>
                        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
                            <ErrorBoundary>
                                {status === 'welcome' ? (
                                    <WelcomeScreen onContinue={handleWelcomeComplete} />
                                ) : (
                                    <Navigation />
                                )}
                            </ErrorBoundary>
                        </SafeAreaProvider>
                    </PassphraseProvider>
                </ThemedRoot>
            </ThemeProvider>
        </>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    splash: {
        flex: 1,
        backgroundColor: darkTheme.colors.background,
    },
});

export default App;
