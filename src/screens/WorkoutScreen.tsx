import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { RootStackNavigation, Workout } from '../types/types';
import BaseScreen from '../components/BaseScreen';
import Button from '../components/Button';
import Card from '../components/Card';
import Dialog, { confirmActions } from '../components/Dialog';
import ErrorPopup from '../components/ErrorPopup';
import Icon from '../components/Icon';
import IconButton from '../components/IconButton';
import IconTile from '../components/IconTile';
import { ListGroup, ListRow, Toggle } from '../components/ListGroup';
import SectionHeader from '../components/SectionHeader';
import StatRow from '../components/StatRow';
import StatTile from '../components/StatTile';
import { ThemedText } from '../components/ThemedText';
import { FadeIn } from '../components/Motion';
import { useTheme } from '../context/ThemeContext';
import { useWorkoutData } from '../hooks/useWorkoutData';
import { gutter, spacing } from '../theme';
import { formatClock } from '../utils/apnea';
import { newId, startOfWeek } from '../utils/dates';
import { currentExercise, describeWorkout, recordsSince, startSession, STARTER_WORKOUTS } from '../utils/workout';
import { saveWorkout, setWorkoutSession } from '../storage';
import { haptics } from '../utils/haptics';
import { ERRORS } from '../constants/strings';

type Dialog = { kind: 'busy' } | { kind: 'error' };

const WorkoutScreen: React.FC = () => {
    const { theme } = useTheme();
    const navigation = useNavigation<RootStackNavigation>();
    const { workouts, records, session, cues, loaded, changeCues } = useWorkoutData();
    const [dialog, setDialog] = useState<Dialog | null>(null);
    const close = () => setDialog(null);

    const week = useMemo(() => recordsSince(records, startOfWeek(new Date()).getTime()), [records]);
    const weekSets = week.reduce((sum, r) => sum + r.setsDone, 0);
    const weekMs = week.reduce((sum, r) => sum + (r.endedAt - r.startedAt), 0);
    const live = session && session.phase !== 'done' ? session : null;

    const start = async (workout: Workout) => {
        if (live) {
            setDialog({ kind: 'busy' });
            return;
        }
        haptics.tap();
        if (await setWorkoutSession(startSession(workout, Date.now()))) {
            navigation.navigate('WorkoutSession');
        } else {
            setDialog({ kind: 'error' });
        }
    };

    const addStarters = async () => {
        for (const starter of STARTER_WORKOUTS) {
            const ok = await saveWorkout({
                id: newId('w'),
                name: starter.name,
                exercises: starter.exercises.map(e => ({ ...e, id: newId('e') })),
            });
            if (!ok) {
                setDialog({ kind: 'error' });
                break;
            }
        }
    };

    const liveExercise = live ? currentExercise(live) : undefined;

    return (
        <BaseScreen
            title="Workout"
            subtitle="Plan it once, then just follow along"
            isLoading={!loaded}
            headerRight={
                <IconButton
                    icon="Plus"
                    variant="filled"
                    accessibilityLabel="New workout"
                    onPress={() => navigation.navigate('WorkoutEditor')}
                />
            }>
            <ScrollView contentContainerStyle={styles.scroll}>
                {live && (
                    <Card onPress={() => navigation.navigate('WorkoutSession')} highlight={theme.colors.accent}>
                        <View style={styles.row}>
                            <IconTile icon="Play" tone="accent" />
                            <View style={styles.flex}>
                                <ThemedText weight="strong">{live.title} in progress</ThemedText>
                                <ThemedText size="small" color="muted">
                                    {liveExercise?.name} · set {live.set + 1} of {liveExercise?.sets}
                                </ThemedText>
                            </View>
                            <Icon name="Next" size={18} tint={theme.colors.muted} />
                        </View>
                    </Card>
                )}

                {records.length > 0 && (
                    <FadeIn>
                        <StatRow>
                            <StatTile
                                label="This week"
                                value={week.length}
                                suffix={week.length === 1 ? ' workout' : ' workouts'}
                            />
                            <StatTile label="Sets" value={weekSets} />
                            <StatTile label="Time" value={formatClock(weekMs)} />
                        </StatRow>
                    </FadeIn>
                )}

                {/* ---- Workouts ---- */}
                <SectionHeader title="Your workouts" />
                {workouts.length === 0 ? (
                    <Card>
                        <ThemedText weight="strong">No workouts yet</ThemedText>
                        <ThemedText size="small" color="muted" style={styles.emptyText}>
                            List your exercises with sets, reps or a time and the rest between sets. During the workout
                            you tap once per finished set, and timed holds such as a plank count down for you.
                        </ThemedText>
                        <View style={styles.buttons}>
                            <Button
                                label="Create workout"
                                onPress={() => navigation.navigate('WorkoutEditor')}
                                style={styles.flex}
                            />
                            <Button
                                label="Add examples"
                                variant="secondary"
                                onPress={addStarters}
                                style={styles.secondaryButton}
                            />
                        </View>
                    </Card>
                ) : (
                    workouts.map(workout => (
                        <Card key={workout.id}>
                            <View style={styles.row}>
                                <View style={styles.flex}>
                                    <ThemedText weight="strong">{workout.name}</ThemedText>
                                    <ThemedText size="small" color="muted" tabular>
                                        {describeWorkout(workout)}
                                    </ThemedText>
                                </View>
                                <IconButton
                                    icon="Edit"
                                    variant="outline"
                                    accessibilityLabel={`Edit ${workout.name}`}
                                    onPress={() => navigation.navigate('WorkoutEditor', { workoutId: workout.id })}
                                />
                            </View>
                            {workout.exercises.length > 0 && (
                                <Button
                                    label="Start"
                                    icon="Play"
                                    iconLeading
                                    compact
                                    onPress={() => start(workout)}
                                    style={styles.startButton}
                                />
                            )}
                        </Card>
                    ))
                )}

                {/* ---- Cues ---- */}
                <SectionHeader title="Cues" />
                <ListGroup>
                    <ListRow icon="Sound" title="Sound" description="Tones when a timed set or rest starts and ends">
                        <Toggle value={cues.sound} onValueChange={sound => changeCues({ sound })} />
                    </ListRow>
                    <ListRow icon="Vibrate" title="Vibration" description="Follow along without looking at the screen">
                        <Toggle value={cues.vibration} onValueChange={vibration => changeCues({ vibration })} />
                    </ListRow>
                </ListGroup>
                <ThemedText size="small" color="muted" style={styles.footnote}>
                    A habit set to complete with a workout is checked off when you reach the end of any workout.
                </ThemedText>
            </ScrollView>

            <Dialog
                visible={dialog?.kind === 'busy'}
                onClose={close}
                icon="Play"
                title="A workout is in progress"
                message="Finish or end it before starting another one."
                actions={confirmActions(close, 'Open it', () => {
                    close();
                    navigation.navigate('WorkoutSession');
                })}
            />
            <ErrorPopup {...ERRORS.saveFailed} visible={dialog?.kind === 'error'} onClose={close} />
        </BaseScreen>
    );
};

const styles = StyleSheet.create({
    scroll: {
        paddingBottom: spacing.xl,
    },
    flex: {
        flex: 1,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm + 2,
    },
    startButton: {
        marginTop: spacing.md,
    },
    emptyText: {
        marginTop: spacing.xs,
    },
    buttons: {
        flexDirection: 'row',
        marginTop: spacing.md,
    },
    secondaryButton: {
        marginLeft: spacing.sm,
    },
    footnote: {
        marginHorizontal: gutter + 2,
        marginTop: spacing.sm,
    },
});

export default WorkoutScreen;
