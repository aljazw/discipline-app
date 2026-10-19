import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import Navigation from './src/navigation/Navigation';
import WelcomeScreen from './src/screens/WelcomeScreen';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { PassphraseProvider } from './src/context/PassphraseContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { useAppInitializer } from './src/hooks/useAppInitializer';
import { darkTheme } from './src/theme/dark';
import { setUserHasSeenWelcome } from './src/storage';
import { openAccessibilitySettings } from './src/utils/accessibility';
import { logger } from './src/utils/logger';

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
            </ThemeProvider>
        </>
    );
}

const styles = StyleSheet.create({
    splash: {
        flex: 1,
        backgroundColor: darkTheme.colors.background,
    },
});

export default App;
