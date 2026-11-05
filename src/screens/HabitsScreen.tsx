import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { RootStackNavigation, RoutineView, TabParamList } from '../types/types';
import BaseScreen from '../components/BaseScreen';
import IconButton from '../components/IconButton';
import Segmented from '../components/Segmented';
import { usePreloadTabs } from '../navigation/usePreloadTabs';
import { gutter, spacing } from '../theme';
import TodayView from './plan/TodayView';
import TasksView from './plan/TasksView';
import HabitsView from './plan/HabitsView';
import TimeView from './plan/TimeView';

const VIEWS: { value: RoutineView; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: 'tasks', label: 'Tasks' },
    { value: 'habits', label: 'Habits' },
    { value: 'time', label: 'Time' },
];

const SUBTITLES: Record<RoutineView, string> = {
    today: '',
    tasks: 'One-time things, before they pile up',
    habits: 'What you must do, on set days',
    time: 'Where your day goes',
};

/**
 * The plan tab, where the app opens. Today: what must be done. Tasks:
 * one-time things. Habits: on set days, they call you. Time: routines,
 * only counted.
 */
const HabitsScreen: React.FC = () => {
    const navigation = useNavigation<RootStackNavigation>();
    const route = useRoute<RouteProp<TabParamList, 'Habits'>>();
    const [view, setView] = useState<RoutineView>(route.params?.view ?? 'today');
    const [now, setNow] = useState(new Date());
    usePreloadTabs();

    // Opened from elsewhere (a call, a notification) with a view in mind.
    useEffect(() => {
        if (route.params?.view) {
            setView(route.params.view);
        }
    }, [route.params]);

    // Keep "today" fresh across midnight.
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 60_000);
        return () => clearInterval(id);
    }, []);
    useFocusEffect(useCallback(() => setNow(new Date()), []));

    const title = VIEWS.find(v => v.value === view)?.label ?? 'Today';
    const subtitle =
        view === 'today'
            ? now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
            : SUBTITLES[view];

    return (
        <BaseScreen
            title={title}
            subtitle={subtitle}
            headerRight={
                view === 'habits' ? (
                    <IconButton
                        icon="Plus"
                        variant="filled"
                        accessibilityLabel="Add a habit"
                        onPress={() => navigation.navigate('TaskEditor', { kind: 'habit' })}
                    />
                ) : view === 'time' ? (
                    <IconButton
                        icon="Plus"
                        variant="filled"
                        accessibilityLabel="Add a routine"
                        onPress={() => navigation.navigate('TaskEditor', { kind: 'routine' })}
                    />
                ) : undefined
            }>
            <Segmented options={VIEWS} value={view} onChange={setView} style={styles.views} />
            {view === 'today' ? (
                <TodayView key={now.toDateString()} />
            ) : view === 'tasks' ? (
                <TasksView />
            ) : view === 'habits' ? (
                <HabitsView />
            ) : (
                <TimeView key={now.toDateString()} />
            )}
        </BaseScreen>
    );
};

const styles = StyleSheet.create({
    views: {
        marginHorizontal: gutter,
        marginBottom: spacing.xs,
    },
});

export default HabitsScreen;
