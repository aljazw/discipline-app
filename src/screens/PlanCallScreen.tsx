import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DayPlan, Habit, RootStackNavigation, RootStackParamList, Todo } from '../types/types';
import Button from '../components/Button';
import IconTile from '../components/IconTile';
import { ThemedText } from '../components/ThemedText';
import { SkipDialog } from '../components/plan/PlanDialogs';
import { useTheme } from '../context/ThemeContext';
import { getDay, getHabits, getTodos } from '../storage';
import { gutter, spacing } from '../theme';
import { formatDuration, formatMinutes, minutesNow } from '../utils/dayPlan';
import { currentStreak, fromDateKey } from '../utils/habits';
import { haptics } from '../utils/haptics';
import { CallTarget, habitState, parseCallId, planToday, sliceTitle, snoozeKey } from '../utils/plan';
import { dismissCall, skipHabitOn, snoozeCall, startHabit } from '../utils/planService';
import { logger } from '../utils/logger';

interface Loaded {
    target: CallTarget;
    habit?: Habit;
    todos: Todo[];
    day: DayPlan;
}

/**
 * Opened by a call: a habit at its time, or tasks out of time in the
 * evening. Back does nothing; you decide. "In 30 min" works once a day per
 * call, and skipping costs the video and a reason.
 */
const PlanCallScreen: React.FC = () => {
    const navigation = useNavigation<RootStackNavigation>();
    const { params } = useRoute<RouteProp<RootStackParamList, 'PlanCall'>>();
    const { colors } = useTheme().theme;
    const insets = useSafeAreaInsets();
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [skipping, setSkipping] = useState(false);

    const leave = useCallback(
        (toToday = false) => {
            dismissCall();
            if (toToday || !navigation.canGoBack()) {
                navigation.navigate('BottomTabs', { screen: 'Habits', params: { view: 'today' } });
            } else {
                navigation.goBack();
            }
        },
        [navigation],
    );

    useEffect(() => {
        const target = parseCallId(params.callId);
        if (!target) {
            leave();
            return;
        }
        Promise.all([getHabits(), getTodos(), getDay(target.date)])
            .then(([habits, todos, day]) => {
                const habit = target.kind === 'habit' ? habits.find(h => h.id === target.habitId) : undefined;
                // Decided already (here, in Today, or by a workout): nothing to ask.
                if (
                    target.kind === 'habit' &&
                    (!habit || habitState(habit, target.date) !== 'open' || day.started[habit.id] !== undefined)
                ) {
                    leave();
                    return;
                }
                if (target.kind === 'tasks' && planToday(habits, todos, fromDateKey(target.date)).must.every(i => i.kind === 'habit')) {
                    leave();
                    return;
                }
                setLoaded({ target, habit, todos, day });
            })
            .catch(error => {
                logger.warn('Could not open the call', error);
                leave();
            });
    }, [leave, params.callId]);

    // No way out with Back: start, put off once, or skip.
    useFocusEffect(
        useCallback(() => {
            const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
            return () => sub.remove();
        }, []),
    );

    if (!loaded) {
        return <View style={[styles.screen, { backgroundColor: colors.background }]} />;
    }

    const { target, habit, todos, day } = loaded;
    const snoozed = day.snoozed.includes(snoozeKey(target));

    const later = async () => {
        haptics.tap();
        await snoozeCall(target.date, snoozeKey(target));
        leave();
    };

    const start = async () => {
        if (!habit) {
            return;
        }
        haptics.success();
        await startHabit(habit.id, target.date, minutesNow(new Date()));
        dismissCall();
        if (habit.link === 'workout') {
            navigation.navigate('BottomTabs', { screen: 'Workout' });
        } else if (habit.link === 'apnea') {
            navigation.navigate('Apnea');
        } else {
            leave(true);
        }
    };

    let body: React.ReactNode;
    if (target.kind === 'habit' && habit) {
        const streak = currentStreak(habit);
        body = (
            <>
                <IconTile icon={habit.icon} size={72} tone="accent" />
                <ThemedText size="small" color="muted" style={styles.kicker} tabular>
                    {formatMinutes(habit.time)} · {formatDuration(habit.duration)}
                </ThemedText>
                <ThemedText size="xlarge" weight="bold" style={styles.center}>
                    {habit.title}
                </ThemedText>
                <ThemedText size="large" style={[styles.center, styles.why]}>
                    {habit.why ? `“${habit.why}”` : 'You planned this for today. Keep your word.'}
                </ThemedText>
                {streak > 0 && (
                    <ThemedText size="small" color="warning" weight="medium" style={styles.streak}>
                        {streak}-day streak. Skipping ends it.
                    </ThemedText>
                )}
            </>
        );
    } else {
        const items = planToday([], todos, fromDateKey(target.date)).must;
        body = (
            <>
                <IconTile icon="Alert" size={72} tone="danger" />
                <ThemedText size="xlarge" weight="bold" style={[styles.center, styles.kicker]}>
                    {items.length === 1 ? 'One thing is out of time' : `${items.length} things are out of time`}
                </ThemedText>
                <ThemedText color="muted" style={[styles.center, styles.why]}>
                    You gave these a few days. Do them now, pick one more day, or drop them with a reason.
                </ThemedText>
                <View style={styles.list}>
                    {items.slice(0, 6).map(i =>
                        i.kind === 'habit' ? null : (
                            <ThemedText key={i.id} weight="medium" numberOfLines={1} style={styles.item}>
                                {i.kind === 'slice' ? sliceTitle(i.todo) : i.todo.title}
                            </ThemedText>
                        ),
                    )}
                </View>
            </>
        );
    }

    return (
        <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <ScrollView contentContainerStyle={styles.content}>{body}</ScrollView>
            <View style={styles.buttons}>
                {target.kind === 'habit' ? (
                    <Button label="Start now" icon="Play" iconLeading onPress={start} />
                ) : (
                    <Button label="Deal with them" onPress={() => leave(true)} />
                )}
                {!snoozed && <Button label="In 30 min" variant="secondary" onPress={later} style={styles.gap} />}
                {target.kind === 'habit' && (
                    <Button label="Skip today" variant="ghost" onPress={() => setSkipping(true)} style={styles.gap} />
                )}
            </View>
            {habit && (
                <SkipDialog
                    visible={skipping}
                    title={habit.title}
                    onClose={() => setSkipping(false)}
                    onSkip={async reason => {
                        setSkipping(false);
                        await skipHabitOn(habit.id, target.date, reason);
                        leave();
                    }}
                />
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    screen: {
        flex: 1,
    },
    content: {
        flexGrow: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: gutter + spacing.md,
        paddingVertical: spacing.xl,
    },
    kicker: {
        marginTop: spacing.lg,
        marginBottom: spacing.xs,
    },
    center: {
        textAlign: 'center',
    },
    why: {
        marginTop: spacing.lg,
    },
    streak: {
        marginTop: spacing.lg,
    },
    list: {
        marginTop: spacing.lg,
        alignSelf: 'stretch',
    },
    item: {
        textAlign: 'center',
        marginTop: spacing.xs,
    },
    buttons: {
        paddingHorizontal: gutter,
        paddingBottom: spacing.lg,
    },
    gap: {
        marginTop: spacing.sm,
    },
});

export default PlanCallScreen;
