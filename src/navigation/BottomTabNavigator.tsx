import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import HabitsScreen from '../screens/HabitsScreen';
import ToolsScreen from '../screens/ToolsScreen';
import BlockListScreen from '../screens/BlockListScreen';
import WorkoutScreen from '../screens/WorkoutScreen';
import { useTheme } from '../context/ThemeContext';
import { TabParamList } from '../types/types';

const Tab = createBottomTabNavigator<TabParamList>();

const TAB_LABELS: Record<keyof TabParamList, string> = {
    Habits: 'Plan',
    Workout: 'Workout',
    Tools: 'Tools',
    Block: 'Blocks',
};

const TAB_ICONS: Partial<Record<keyof TabParamList, 'Plan' | 'Shield'>> = { Habits: 'Plan', Block: 'Shield' };

/** Keeps the first and last tab clear of rounded screen corners. */
const SIDE_INSET = 14;

/** Defined outside the navigator so React keeps a stable component identity. */
const tabIcon =
    (name: keyof TabParamList) =>
    ({ color, focused }: { color: string; focused: boolean }) =>
        <Icon name={TAB_ICONS[name] ?? name} size={21} tint={color} strokeWidth={focused ? 2.1 : 1.8} />;

const BottomTabNavigator: React.FC = () => {
    const { theme } = useTheme();
    const insets = useSafeAreaInsets();

    return (
        <Tab.Navigator
            screenOptions={({ route }) => ({
                headerShown: false,
                // Hidden tabs stop re-rendering (timers, focus reloads) until they're shown again.
                freezeOnBlur: true,
                tabBarHideOnKeyboard: true,
                tabBarLabel: TAB_LABELS[route.name],
                tabBarActiveTintColor: theme.colors.accent,
                tabBarInactiveTintColor: theme.colors.muted,
                tabBarLabelStyle: styles.label,
                tabBarStyle: {
                    backgroundColor: theme.colors.card,
                    borderTopColor: theme.colors.border,
                    borderTopWidth: StyleSheet.hairlineWidth,
                    elevation: 0,
                    // Gesture-bar phones report a bottom inset; sit above it
                    // instead of under it.
                    height: 62 + insets.bottom,
                    paddingTop: 6,
                    paddingBottom: Math.max(insets.bottom, 6),
                    paddingLeft: Math.max(insets.left, SIDE_INSET),
                    paddingRight: Math.max(insets.right, SIDE_INSET),
                },
                tabBarIcon: tabIcon(route.name),
            })}>
            <Tab.Screen name="Habits" component={HabitsScreen} />
            <Tab.Screen name="Workout" component={WorkoutScreen} />
            <Tab.Screen name="Tools" component={ToolsScreen} />
            <Tab.Screen name="Block" component={BlockListScreen} />
        </Tab.Navigator>
    );
};

const styles = StyleSheet.create({
    label: {
        fontSize: 11,
        fontWeight: '500',
        marginTop: 2,
    },
});

export default BottomTabNavigator;
