import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { DayPlan, Habit, RootStackNavigation } from '../../types/types';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Dialog from '../../components/Dialog';
import DurationPicker from '../../components/DurationPicker';
import ErrorPopup from '../../components/ErrorPopup';
import { ListGroup, ListRow, Toggle } from '../../components/ListGroup';
import ProgressBar from '../../components/ProgressBar';
import SectionHeader from '../../components/SectionHeader';
import { ThemedText } from '../../components/ThemedText';
import { FadeIn, animateLayout } from '../../components/Motion';
import { useTheme } from '../../context/ThemeContext';
import { useFocusData } from '../../hooks/useFocusData';
import { useHabits } from '../../hooks/useHabits';
import { useTodos } from '../../hooks/useTodos';
import { DEFAULT_PLAN_PREFS, MAX_TASK_MINUTES, STORAGE_KEYS, emptyDay, getDays, getPlanPrefs, setPlanPrefs } from '../../storage';
import { spacing } from '../../theme';
import { fromDateKey, shortDate, toDateKey } from '../../utils/dates';
import { formatDuration, formatMinutes, minutesNow } from '../../utils/dayPlan';
import { describeHabitDays } from '../../utils/habitText';
import { isScheduled } from '../../utils/habits';
import { ensureReminderPermission } from '../../utils/habitReminders';
import { TimeEntry, timeOn, timeSummary } from '../../utils/plan';
import { setRoutineActual, setRoutineHappened } from '../../utils/planService';
import { ERRORS } from '../../constants/strings';

const NO_DAYS: DayPlan[] = [];
const DAYS_KEY = [STORAGE_KEYS.days];
const PREFS_KEY = [STORAGE_KEYS.planPrefs];

const hours = (minutes: number) => {
    const h = minutes / 60;
    return h >= 10 ? `${Math.round(h)} h` : h >= 1 ? `${h.toFixed(1)} h` : `${Math.round(minutes)} min`;
};

/** Routines: what something else makes you do. Nothing to tick; they only show where the time went. */
const TimeView: React.FC = () => {
    const navigation = useNavigation<RootStackNavigation>();
    const { colors } = useTheme().theme;
    const { habits } = useHabits();
    const { todos } = useTodos();
    const { data: days } = useFocusData(getDays, NO_DAYS, { watch: DAYS_KEY });
    const { data: prefs, setData: setPrefs } = useFocusData(getPlanPrefs, DEFAULT_PLAN_PREFS, { watch: PREFS_KEY });
    const [editing, setEditing] = useState<{ routine: Habit; minutes: number } | null>(null);
    const [failed, setFailed] = useState(false);

    const now = new Date();
    const key = toDateKey(now);
    const dayOf = useMemo(() => {
        const byDate = new Map(days.map(d => [d.date, d]));
        return (k: string) => byDate.get(k) ?? emptyDay(k);
    }, [days]);
    const today = dayOf(key);
    const entries = timeOn(habits, todos, today, now);
    const routines = habits.filter(h => h.kind === 'routine').sort((a, b) => a.time - b.time);
    const notToday = routines.filter(h => isScheduled(h, now) && h.createdAt <= key && today.skipped.includes(h.id));
    const week = timeSummary(habits, todos, dayOf, now, minutesNow(now));
    const weekMax = Math.max(1, ...week.map(r => r.minutes));
    const weekTotal = week.reduce((sum, r) => sum + r.minutes, 0);

    const run = async (write: Promise<boolean>) => {
        animateLayout();
        if (!(await write)) {
            setFailed(true);
        }
    };

    const openEntry = (entry: TimeEntry) => {
        const routine = routines.find(r => r.id === entry.id);
        if (entry.kind === 'routine' && routine) {
            setEditing({ routine, minutes: entry.minutes });
        }
    };

    const toggleAsk = async (value: boolean) => {
        const next = { ...prefs, reminders: value };
        setPrefs(next);
        if (!(await setPlanPrefs(next))) {
            setPrefs(prefs);
            setFailed(true);
        } else if (value) {
            ensureReminderPermission();
        }
    };

    return (
        <ScrollView contentContainerStyle={styles.scroll}>
            <SectionHeader title="Today" />
            {entries.length === 0 && notToday.length === 0 ? (
                <Card>
                    <ThemedText size="small" color="muted">
                        {routines.length === 0
                            ? 'Add your routines (work, driving, meals) to see where your day goes. Nothing to tick off; they count themselves.'
                            : 'Nothing counted yet today.'}
                    </ThemedText>
                </Card>
            ) : (
                <ListGroup>
                    {entries.map(e => (
                        <ListRow
                            key={`${e.kind}:${e.id}`}
                            icon={e.kind === 'routine' ? 'Time' : e.kind === 'habit' ? 'Habits' : 'Target'}
                            title={e.title}
                            description={[
                                e.start !== undefined ? `${formatMinutes(e.start)}–${formatMinutes(e.start + e.minutes)}` : null,
                                formatDuration(e.minutes),
                                e.estimated ? 'usual length' : null,
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                            onPress={e.kind === 'routine' ? () => openEntry(e) : undefined}
                        />
                    ))}
                    {notToday.map(r => (
                        <ListRow
                            key={`off:${r.id}`}
                            icon="Close"
                            title={r.title}
                            description="Didn’t happen today · tap to count it"
                            onPress={() => run(setRoutineHappened(key, r.id, true))}
                        />
                    ))}
                </ListGroup>
            )}

            {week.length > 0 && (
                <FadeIn>
                    <SectionHeader title={`Last 7 days · ${hours(weekTotal)}`} />
                    <Card>
                        {week.map((row, i) => (
                            <View key={`${row.kind}:${row.label}`} style={i > 0 ? styles.barGap : undefined}>
                                <View style={styles.barLabel}>
                                    <ThemedText size="small" weight="medium" numberOfLines={1} style={styles.flex}>
                                        {row.label}
                                    </ThemedText>
                                    <ThemedText size="small" color="muted" tabular>
                                        {hours(row.minutes)}
                                    </ThemedText>
                                </View>
                                <ProgressBar
                                    fraction={row.minutes / weekMax}
                                    color={row.kind === 'routine' ? colors.muted : row.kind === 'habit' ? colors.primaryGreen : colors.accent}
                                    height={6}
                                />
                            </View>
                        ))}
                    </Card>
                </FadeIn>
            )}

            <SectionHeader
                title="Routines"
                right={
                    <Button
                        label="Add"
                        icon="Plus"
                        iconLeading
                        variant="ghost"
                        compact
                        onPress={() => navigation.navigate('TaskEditor', { kind: 'routine' })}
                        style={styles.headerButton}
                    />
                }
            />
            {routines.length > 0 && (
                <ListGroup>
                    {routines.map(r => (
                        <ListRow
                            key={r.id}
                            icon={r.icon}
                            title={r.title}
                            description={`${formatMinutes(r.time)}–${formatMinutes(r.time + r.duration)} · ${
                                r.once ? shortDate(fromDateKey(r.once), now) : describeHabitDays(r.days)
                            }`}
                            onPress={() => navigation.navigate('TaskEditor', { habitId: r.id })}
                        />
                    ))}
                </ListGroup>
            )}

            <SectionHeader title="Settings" />
            <ListGroup>
                <ListRow icon="Bell" title="Ask when routines end" description="So the real length is counted, not the usual">
                    <Toggle value={prefs.reminders} onValueChange={toggleAsk} />
                </ListRow>
            </ListGroup>

            {editing && (
                <Dialog
                    visible
                    onClose={() => setEditing(null)}
                    title={editing.routine.title}
                    message="How long did it really take today?"
                    actions={[
                        {
                            label: 'Didn’t happen',
                            variant: 'secondary',
                            onPress: () => {
                                const id = editing.routine.id;
                                setEditing(null);
                                run(setRoutineHappened(key, id, false));
                            },
                        },
                        {
                            label: 'Save',
                            onPress: () => {
                                const { routine, minutes } = editing;
                                setEditing(null);
                                run(setRoutineActual(key, routine.id, minutes === routine.duration ? null : minutes));
                            },
                        },
                    ]}>
                    <DurationPicker
                        value={editing.minutes}
                        onChange={minutes => setEditing({ ...editing, minutes })}
                        min={5}
                        max={MAX_TASK_MINUTES}
                        presets={[editing.routine.duration]}
                        accessibilityLabel="Real length"
                    />
                </Dialog>
            )}
            <ErrorPopup {...ERRORS.saveFailed} visible={failed} onClose={() => setFailed(false)} />
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    scroll: {
        paddingBottom: spacing.xl,
    },
    flex: {
        flex: 1,
    },
    barLabel: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginBottom: spacing.xs,
    },
    barGap: {
        marginTop: spacing.md,
    },
    headerButton: {
        marginVertical: -8,
        marginRight: -spacing.sm,
    },
});

export default TimeView;
