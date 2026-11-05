import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { RootStackNavigation } from '../../types/types';
import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import HabitCard from '../../components/HabitCard';
import { ListGroup, ListRow } from '../../components/ListGroup';
import SectionHeader from '../../components/SectionHeader';
import StatRow from '../../components/StatRow';
import StatTile from '../../components/StatTile';
import { ThemedText } from '../../components/ThemedText';
import { FadeIn, stagger } from '../../components/Motion';
import { useHabits } from '../../hooks/useHabits';
import { useTodos } from '../../hooks/useTodos';
import { gutter, spacing } from '../../theme';
import { fromDateKey, shortDate } from '../../utils/dates';
import { completionRate, routineStreak } from '../../utils/habits';
import { recentSkips } from '../../utils/plan';

/** Habits: what you must do on set days. Each calls you at its time; the week's skip reasons are below. */
const HabitsView: React.FC = () => {
    const navigation = useNavigation<RootStackNavigation>();
    const { habits: all, loaded } = useHabits();
    const { todos } = useTodos();
    const habits = all.filter(h => h.kind === 'habit').sort((a, b) => a.time - b.time);
    const today = new Date();
    const skips = recentSkips(habits, todos, today);
    const add = () => navigation.navigate('TaskEditor', { kind: 'habit' });

    if (loaded && habits.length === 0) {
        return (
            <EmptyState
                icon="Habits"
                title="No habits yet"
                text="A habit is something you must do on set days, like a workout or learning. At its time the app calls you, and skipping costs a video and a reason.">
                <Button label="Add a habit" icon="Plus" iconLeading onPress={add} />
            </EmptyState>
        );
    }

    const weekRate = completionRate(habits, 7, today);
    return (
        <ScrollView contentContainerStyle={styles.scroll}>
            <FadeIn>
                <StatRow>
                    <StatTile label="All-habit streak" value={routineStreak(habits, today)} suffix=" d" />
                    <StatTile label="Last 7 days" value={Math.round((weekRate ?? 0) * 100)} suffix="%" />
                </StatRow>
            </FadeIn>

            <SectionHeader title="By time of day" />
            {habits.map((habit, i) => (
                <FadeIn key={habit.id} delay={60 + stagger(i)}>
                    <HabitCard habit={habit} onOpen={() => navigation.navigate('TaskEditor', { habitId: habit.id })} />
                </FadeIn>
            ))}

            {skips.length > 0 && (
                <>
                    <SectionHeader title="Why you skipped · last 7 days" />
                    <ListGroup>
                        {skips.map(s => (
                            <View key={`${s.date}:${s.title}`} style={styles.skip}>
                                <ThemedText size="small" color="muted">
                                    {shortDate(fromDateKey(s.date), today)} · {s.title}
                                </ThemedText>
                                <ThemedText style={styles.reason}>“{s.reason}”</ThemedText>
                            </View>
                        ))}
                    </ListGroup>
                </>
            )}

            <SectionHeader title="Settings" />
            <ListGroup>
                <ListRow
                    icon="Sunrise"
                    title="Wake-up and bedtime"
                    description="Calls stop at bedtime; tasks out of time call in the evening"
                    onPress={() => navigation.navigate('DayHours')}
                />
            </ListGroup>
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    scroll: {
        paddingBottom: spacing.xl,
    },
    skip: {
        paddingHorizontal: gutter,
        paddingVertical: spacing.sm + 2,
    },
    reason: {
        marginTop: 2,
    },
});

export default HabitsView;
