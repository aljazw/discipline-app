import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Habit, PlanPrefs, RootStackNavigation, RoutineView, TabParamList } from '../types/types';
import BaseScreen from '../components/BaseScreen';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import ErrorPopup from '../components/ErrorPopup';
import HabitCard from '../components/HabitCard';
import IconButton from '../components/IconButton';
import { ListGroup, ListRow, Toggle } from '../components/ListGroup';
import Segmented from '../components/Segmented';
import SectionHeader from '../components/SectionHeader';
import StatRow from '../components/StatRow';
import StatTile from '../components/StatTile';
import { FadeIn, animateLayout, stagger } from '../components/Motion';
import { useHabits } from '../hooks/useHabits';
import { useFocusData } from '../hooks/useFocusData';
import { usePreloadTabs } from '../navigation/usePreloadTabs';
import { gutter, spacing } from '../theme';
import DayView from './DayView';
import NextView from './NextView';
import { addDays, toDateKey } from '../utils/dates';
import { playPromiseVideoOncePerDay } from '../utils/promiseVideo';
import { minutesNow } from '../utils/dayPlan';
import { completionRate, routineStreak } from '../utils/habits';
import { ensureReminderPermission } from '../utils/habitReminders';
import { DEFAULT_PLAN_PREFS, STORAGE_KEYS, getPlanPrefs, saveHabits, setPlanPrefs } from '../storage';
import { ERRORS } from '../constants/strings';

const VIEWS: { value: RoutineView; label: string }[] = [
    { value: 'next', label: 'Next' },
    { value: 'today', label: 'Today' },
    { value: 'tomorrow', label: 'Tomorrow' },
    { value: 'routine', label: 'Routine' },
];

const dateLabel = (date: Date) =>
    date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

/** The plan tab, where the app opens: today's plan, tomorrow's, and the routine they're built from. */
const HabitsScreen: React.FC = () => {
    const navigation = useNavigation<RootStackNavigation>();
    const route = useRoute<RouteProp<TabParamList, 'Habits'>>();
    const [view, setView] = useState<RoutineView>(route.params?.view ?? 'next');
    const [now, setNow] = useState(new Date());
    usePreloadTabs();

    // Opened from elsewhere (a pop-up, a notification) with a view in mind.
    useEffect(() => {
        if (route.params?.view) {
            setView(route.params.view);
        }
    }, [route.params]);

    // Planning tomorrow starts with the "keep your word" video, once a day.
    useEffect(() => {
        if (view === 'tomorrow') {
            playPromiseVideoOncePerDay();
        }
    }, [view]);

    // Keep "now" fresh: the current task, its time left and the day rolling over.
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(id);
    }, []);
    useFocusEffect(useCallback(() => setNow(new Date()), []));

    const tomorrow = addDays(now, 1);
    const subtitle =
        view === 'next'
            ? 'One thing at a time'
            : view === 'routine'
            ? 'What you do, and on which days'
            : dateLabel(view === 'today' ? now : tomorrow);
    const title = { next: 'Next', routine: 'Routine', today: 'Today', tomorrow: 'Tomorrow' }[view];

    return (
        <BaseScreen
            title={title}
            subtitle={subtitle}
            headerRight={
                view === 'next' ? undefined : (
                    <IconButton
                        icon="Plus"
                        variant="filled"
                        accessibilityLabel="Add a task"
                        onPress={() =>
                            navigation.navigate(
                                'TaskEditor',
                                view === 'routine' ? undefined : { date: toDateKey(view === 'today' ? now : tomorrow) },
                            )
                        }
                    />
                )
            }>
            <Segmented options={VIEWS} value={view} onChange={setView} style={styles.views} />
            {view === 'next' ? (
                <NextView />
            ) : view === 'today' ? (
                <DayView key="today" dateKey={toDateKey(now)} now={minutesNow(now)} />
            ) : view === 'tomorrow' ? (
                <DayView key="tomorrow" dateKey={toDateKey(tomorrow)} now={null} />
            ) : (
                <RoutineList />
            )}
        </BaseScreen>
    );
};

const PREFS_KEY = [STORAGE_KEYS.planPrefs];

/** Every routine task in the order of the day, with streaks and plan settings. */
const RoutineList: React.FC = () => {
    const navigation = useNavigation<RootStackNavigation>();
    const { habits, setHabits, loaded } = useHabits();
    const { data: prefs, setData: setPrefs } = useFocusData(getPlanPrefs, DEFAULT_PLAN_PREFS, { watch: PREFS_KEY });
    const [reordering, setReordering] = useState(false);
    const [failed, setFailed] = useState(false);

    const today = new Date();
    const streak = routineStreak(habits, today);
    const weekRate = completionRate(habits, 7, today);
    const open = (habit?: Habit) => navigation.navigate('TaskEditor', habit ? { habitId: habit.id } : undefined);

    const move = async (from: number, to: number) => {
        const next = [...habits];
        next.splice(to, 0, ...next.splice(from, 1));
        animateLayout();
        setHabits(next);
        if (!(await saveHabits(next))) {
            setHabits(habits);
            setFailed(true);
        }
    };

    const changePrefs = async (change: Partial<PlanPrefs>) => {
        const next = { ...prefs, ...change };
        setPrefs(next);
        if (!(await setPlanPrefs(next))) {
            setPrefs(prefs);
            setFailed(true);
        } else if (change.reminders) {
            ensureReminderPermission();
        }
    };

    if (loaded && habits.length === 0) {
        return (
            <EmptyState
                icon="Habits"
                title="No routine yet"
                text="Add the things you do on a normal day, how long they take, and on which days. Each one keeps a streak.">
                <Button label="Add a task" icon="Plus" iconLeading onPress={() => open()} />
            </EmptyState>
        );
    }

    return (
        <ScrollView contentContainerStyle={styles.scroll}>
            <FadeIn>
                <StatRow>
                    <StatTile label="Routine streak" value={streak} suffix=" d" />
                    <StatTile label="Last 7 days" value={Math.round((weekRate ?? 0) * 100)} suffix="%" />
                    <StatTile label="Tasks" value={habits.length} />
                </StatRow>
            </FadeIn>

            <SectionHeader
                title="In order of the day"
                right={
                    <Button
                        label={reordering ? 'Done' : 'Reorder'}
                        variant="ghost"
                        compact
                        onPress={() => {
                            animateLayout();
                            setReordering(!reordering);
                        }}
                        style={styles.headerButton}
                    />
                }
            />
            {habits.map((habit, i) => (
                <FadeIn key={habit.id} delay={60 + stagger(i)}>
                    <HabitCard
                        habit={habit}
                        reordering={reordering}
                        onOpen={() => open(habit)}
                        onMoveUp={i > 0 ? () => move(i, i - 1) : undefined}
                        onMoveDown={i < habits.length - 1 ? () => move(i, i + 1) : undefined}
                    />
                </FadeIn>
            ))}

            <SectionHeader title="Staying on track" />
            <ListGroup>
                <ListRow icon="Bell" title="Reminders" description="A notification when each task should start">
                    <Toggle value={prefs.reminders} onValueChange={v => changePrefs({ reminders: v })} />
                </ListRow>
                <ListRow icon="Target" title="Check-ins" description="Asks when a task runs much longer than planned">
                    <Toggle value={prefs.nudges} onValueChange={v => changePrefs({ nudges: v })} />
                </ListRow>
                <ListRow
                    icon="Sunrise"
                    title="Wake-up and bedtime"
                    description="Your day runs between these"
                    onPress={() => navigation.navigate('DayHours')}
                />
            </ListGroup>
            <ErrorPopup {...ERRORS.saveFailed} visible={failed} onClose={() => setFailed(false)} />
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    views: {
        marginHorizontal: gutter,
        marginBottom: spacing.xs,
    },
    scroll: {
        paddingBottom: spacing.xl,
    },
    headerButton: {
        marginVertical: -8,
        marginRight: -spacing.sm,
    },
});

export default HabitsScreen;
