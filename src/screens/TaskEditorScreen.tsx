import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { Habit, HabitKind, HabitLink, RootStackNavigation, RootStackParamList } from '../types/types';
import BackButton from '../components/BackButton';
import TextField from '../components/TextField';
import BaseScreen from '../components/BaseScreen';
import Button from '../components/Button';
import Card from '../components/Card';
import Chip from '../components/Chip';
import ChipGroup from '../components/ChipGroup';
import DayPicker from '../components/DayPicker';
import DurationPicker from '../components/DurationPicker';
import Dialog, { confirmActions } from '../components/Dialog';
import ErrorPopup from '../components/ErrorPopup';
import { IconName } from '../components/Icon';
import IconButton from '../components/IconButton';
import IconPicker from '../components/IconPicker';
import SectionHeader from '../components/SectionHeader';
import Segmented from '../components/Segmented';
import StatRow from '../components/StatRow';
import StatTile from '../components/StatTile';
import TimeInput from '../components/TimeInput';
import { ThemedText } from '../components/ThemedText';
import { FadeIn, animateLayout } from '../components/Motion';
import { persistHabit, removeHabit } from '../hooks/useHabits';
import { gutter, spacing } from '../theme';
import { bestStreak, currentStreak, fromDateKey, newHabitId, toDateKey } from '../utils/habits';
import { addDays, shortDate } from '../utils/dates';
import { describeHabitDays } from '../utils/habitText';
import { DEFAULT_TASK_LENGTH, parseMinutes } from '../utils/dayPlan';
import { ensureReminderPermission } from '../utils/habitReminders';
import { getHabits, MAX_TASK_MINUTES, MAX_WHY } from '../storage';
import { haptics } from '../utils/haptics';
import { ERRORS } from '../constants/strings';
import { DEFAULT_HABIT_ICON, HABIT_ICONS } from '../constants/habitIcons';
import { DAY_PRESETS, EVERY_DAY, sameDays } from '../constants/days';

type Suggestion = { title: string; icon: IconName; duration: number; time: number; link?: HabitLink };

const SUGGESTIONS: Record<HabitKind, Suggestion[]> = {
    habit: [
        { title: 'Workout', icon: 'Dumbbell', duration: 60, time: 18 * 60, link: 'workout' },
        { title: 'Apnea training', icon: 'Waves', duration: 30, time: 19 * 60, link: 'apnea' },
        { title: 'Study', icon: 'Study', duration: 50, time: 17 * 60 },
        { title: 'Read', icon: 'Book', duration: 30, time: 21 * 60 },
        { title: 'Meditate', icon: 'Brain', duration: 10, time: 7 * 60 },
        { title: 'Walk', icon: 'Footprints', duration: 30, time: 12 * 60 + 30 },
        { title: 'Stretch', icon: 'Leaf', duration: 15, time: 21 * 60 + 30 },
    ],
    routine: [
        { title: 'Work', icon: 'Work', duration: 8 * 60, time: 8 * 60 },
        { title: 'Commute', icon: 'Commute', duration: 30, time: 7 * 60 + 30 },
        { title: 'Breakfast', icon: 'Meal', duration: 20, time: 7 * 60 },
        { title: 'Lunch', icon: 'Meal', duration: 45, time: 12 * 60 },
        { title: 'Dinner', icon: 'Meal', duration: 45, time: 19 * 60 },
        { title: 'Chores', icon: 'House', duration: 30, time: 20 * 60 },
        { title: 'Errands', icon: 'Errand', duration: 60, time: 17 * 60 },
        { title: 'Appointment', icon: 'Meeting', duration: 60, time: 10 * 60 },
    ],
};

const KINDS: { value: HabitKind; label: string }[] = [
    { value: 'habit', label: 'Habit' },
    { value: 'routine', label: 'Routine' },
];

const KIND_TEXT: Record<HabitKind, string> = {
    habit: 'Something you must do. At its time the app calls you, and skipping costs a video and a reason.',
    routine: 'Something you have to do anyway, like work or driving. Nothing to tick off; it only counts your time.',
};

const LENGTHS = [10, 15, 30, 45, 60, 90, 120, 240, 480];

const LINKS: { value: HabitLink | 'none'; label: string }[] = [
    { value: 'none', label: 'Myself' },
    { value: 'workout', label: 'Workout' },
    { value: 'apnea', label: 'Apnea' },
];

const LINK_DESCRIPTION: Record<HabitLink | 'none', string> = {
    none: 'You check it off yourself.',
    workout: 'Checked off when you finish any workout that day.',
    apnea: 'Checked off when you finish any apnea session that day.',
};

const MAX_TITLE = 60;

const pad = (n: number) => String(n).padStart(2, '0');

/** On weekdays, or (a routine) once on a date, like an appointment. */
type Repeat = { kind: 'once'; date: string } | { kind: 'days'; days: boolean[] };

type Popup = { kind: 'delete' } | { kind: 'error' };

/** Adds or edits a habit or a routine. */
const TaskEditorScreen: React.FC = () => {
    const navigation = useNavigation<RootStackNavigation>();
    const { params } = useRoute<RouteProp<RootStackParamList, 'TaskEditor'>>();
    const habitId = params?.habitId;

    const [habit, setHabit] = useState<Habit | null>(null);
    const [kind, setKind] = useState<HabitKind>(params?.kind ?? 'habit');
    const [title, setTitle] = useState('');
    const [icon, setIcon] = useState<IconName>(DEFAULT_HABIT_ICON);
    const [duration, setDuration] = useState(DEFAULT_TASK_LENGTH);
    const [hour, setHour] = useState('18');
    const [minute, setMinute] = useState('00');
    const [repeat, setRepeat] = useState<Repeat>({ kind: 'days', days: EVERY_DAY });
    const [custom, setCustom] = useState(false);
    const [why, setWhy] = useState('');
    const [link, setLink] = useState<HabitLink | 'none'>('none');
    const [popup, setPopup] = useState<Popup | null>(null);

    const setTime = (minutes: number) => {
        setHour(pad(Math.floor(minutes / 60)));
        setMinute(pad(minutes % 60));
    };

    // Editing: load it once. If it no longer exists, leave.
    useEffect(() => {
        if (!habitId) {
            return;
        }
        getHabits()
            .then(habits => {
                const found = habits.find(h => h.id === habitId);
                if (!found) {
                    navigation.goBack();
                    return;
                }
                setHabit(found);
                setKind(found.kind);
                setTitle(found.title);
                setIcon(found.icon);
                setDuration(found.duration);
                setTime(found.time);
                setWhy(found.why ?? '');
                setRepeat(found.once ? { kind: 'once', date: found.once } : { kind: 'days', days: found.days });
                setCustom(!found.once && !DAY_PRESETS.some(p => sameDays(p.days, found.days)));
                setLink(found.link ?? 'none');
            })
            .catch(() => setPopup({ kind: 'error' }));
    }, [habitId, navigation]);

    const trimmed = title.trim();
    const time = parseMinutes(`${hour}:${pad(Number(minute) || 0)}`);
    const isHabit = kind === 'habit';
    const today = new Date();
    const dates = Array.from({ length: 21 }, (_, i) => toDateKey(addDays(today, i)));
    const problem = !trimmed
        ? 'Give it a name.'
        : time === null
        ? 'Set a valid time.'
        : repeat.kind === 'days' && !repeat.days.some(Boolean)
        ? 'Pick at least one day.'
        : null;

    const pickSuggestion = (s: Suggestion) => {
        setTitle(s.title);
        setIcon(s.icon);
        setDuration(s.duration);
        setTime(s.time);
        setLink(s.link ?? 'none');
    };

    const pickDays = (days: boolean[] | null) => {
        animateLayout();
        setCustom(days === null);
        setRepeat({ kind: 'days', days: days ?? (repeat.kind === 'days' ? repeat.days : EVERY_DAY) });
    };

    const changeKind = (next: HabitKind) => {
        animateLayout();
        setKind(next);
        if (next === 'habit' && repeat.kind === 'once') {
            setRepeat({ kind: 'days', days: EVERY_DAY });
        }
    };

    const save = async () => {
        if (problem || time === null) {
            return;
        }
        const todayKey = toDateKey(today);
        const ok = await persistHabit({
            id: habit?.id ?? newHabitId(),
            createdAt: habit?.createdAt ?? todayKey,
            completions: habit?.completions ?? [],
            ...(habit?.skips ? { skips: habit.skips } : {}),
            kind,
            time,
            title: trimmed,
            icon,
            days: repeat.kind === 'days' ? repeat.days : EVERY_DAY,
            ...(repeat.kind === 'once' ? { once: repeat.date } : {}),
            duration,
            ...(isHabit && why.trim() ? { why: why.trim() } : {}),
            ...(isHabit && link !== 'none' ? { link } : {}),
        });
        if (!ok) {
            setPopup({ kind: 'error' });
            return;
        }
        haptics.success();
        navigation.goBack();
        // Asked after saving: the request can wait on a system dialog, which must never hold up the save.
        ensureReminderPermission();
    };

    const confirmDelete = async () => {
        if (habit && (await removeHabit(habit.id))) {
            navigation.goBack();
        } else {
            setPopup({ kind: 'error' });
        }
    };

    const noun = isHabit ? 'habit' : 'routine';

    return (
        <BaseScreen
            title={habit ? `Edit ${noun}` : `New ${noun}`}
            headerLeft={<BackButton />}
            headerRight={
                habit ? (
                    <IconButton
                        icon="Trash"
                        variant="outline"
                        accessibilityLabel={`Delete ${noun}`}
                        onPress={() => setPopup({ kind: 'delete' })}
                    />
                ) : undefined
            }>
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                {habit && isHabit && (
                    <FadeIn>
                        <StatRow>
                            <StatTile label="Streak" value={currentStreak(habit)} suffix=" d" />
                            <StatTile label="Best" value={bestStreak(habit)} suffix=" d" />
                            <StatTile label="Times done" value={habit.completions.length} />
                        </StatRow>
                    </FadeIn>
                )}

                <View style={styles.kind}>
                    <Segmented options={KINDS} value={kind} onChange={changeKind} />
                    <ThemedText size="small" color="muted" style={styles.hint}>
                        {KIND_TEXT[kind]}
                    </ThemedText>
                </View>

                <SectionHeader title="What" />
                <TextField
                    value={title}
                    onChangeText={setTitle}
                    placeholder={isHabit ? 'e.g. Workout, Study, Read' : 'e.g. Work, Commute, Dinner'}
                    maxLength={MAX_TITLE}
                />
                {!habit && (
                    <ChipGroup>
                        {SUGGESTIONS[kind].map(s => (
                            <Chip
                                key={s.title}
                                icon={s.icon}
                                label={s.title}
                                selected={trimmed === s.title}
                                onPress={() => pickSuggestion(s)}
                            />
                        ))}
                    </ChipGroup>
                )}

                {isHabit && (
                    <>
                        <SectionHeader title="Why" />
                        <TextField
                            value={why}
                            onChangeText={setWhy}
                            placeholder="Why do you do this? In your own words. You’ll see it when it calls."
                            maxLength={MAX_WHY}
                            multiline
                        />
                    </>
                )}

                <SectionHeader title={isHabit ? 'Calls you at' : 'Usually starts at'} />
                <View style={styles.time}>
                    <TimeInput label="Time" hourValue={hour} minutesValue={minute} setHour={setHour} setMinutes={setMinute} />
                </View>

                <SectionHeader title="How long" />
                <Card>
                    <DurationPicker
                        value={duration}
                        onChange={setDuration}
                        min={5}
                        max={MAX_TASK_MINUTES}
                        presets={LENGTHS}
                        accessibilityLabel="Duration"
                    />
                </Card>

                <SectionHeader title={isHabit ? 'Days' : 'When'} />
                <ChipGroup>
                    {DAY_PRESETS.map(preset => (
                        <Chip
                            key={preset.label}
                            label={preset.label}
                            selected={repeat.kind === 'days' && !custom && sameDays(repeat.days, preset.days)}
                            onPress={() => pickDays(preset.days)}
                        />
                    ))}
                    <Chip label="Pick days" selected={repeat.kind === 'days' && custom} onPress={() => pickDays(null)} />
                    {!isHabit && (
                        <Chip
                            label="One date"
                            selected={repeat.kind === 'once'}
                            onPress={() => {
                                animateLayout();
                                setRepeat({ kind: 'once', date: repeat.kind === 'once' ? repeat.date : dates[0] });
                            }}
                        />
                    )}
                </ChipGroup>
                {repeat.kind === 'days' && custom && (
                    <Card>
                        <DayPicker value={repeat.days} onChange={days => setRepeat({ kind: 'days', days })} />
                    </Card>
                )}
                {repeat.kind === 'once' && (
                    <ChipGroup>
                        {(dates.includes(repeat.date) ? dates : [repeat.date, ...dates]).map(d => (
                            <Chip
                                key={d}
                                label={d === dates[0] ? 'Today' : shortDate(fromDateKey(d), today)}
                                selected={repeat.date === d}
                                onPress={() => setRepeat({ kind: 'once', date: d })}
                            />
                        ))}
                    </ChipGroup>
                )}
                <ThemedText size="small" color="muted" style={styles.note}>
                    {repeat.kind === 'once'
                        ? 'Just this once, like an appointment.'
                        : isHabit
                        ? `${describeHabitDays(repeat.days)}. Missing a day ends its streak.`
                        : `${describeHabitDays(repeat.days)}.`}
                </ThemedText>

                <SectionHeader title="Icon" />
                <IconPicker icons={HABIT_ICONS} value={icon} onChange={setIcon} />

                {isHabit && (
                    <>
                        <SectionHeader title="Checked off by" />
                        <View style={styles.linkPicker}>
                            <Segmented options={LINKS} value={link} onChange={setLink} />
                            <ThemedText size="small" color="muted" style={styles.hint}>
                                {LINK_DESCRIPTION[link]}
                            </ThemedText>
                        </View>
                    </>
                )}

                {problem && trimmed.length > 0 && (
                    <ThemedText size="small" color="primaryRed" style={styles.problem}>
                        {problem}
                    </ThemedText>
                )}
                <Button
                    label={habit ? 'Save changes' : `Add ${noun}`}
                    disabled={!!problem}
                    onPress={save}
                    style={styles.save}
                />
            </ScrollView>

            <Dialog
                visible={popup?.kind === 'delete'}
                onClose={() => setPopup(null)}
                icon="Trash"
                tone="danger"
                title={`Delete “${habit?.title ?? ''}”?`}
                message={isHabit ? 'Its streak and history are removed.' : 'It stops counting from now on.'}
                actions={confirmActions(() => setPopup(null), 'Delete', confirmDelete, true)}
            />
            <ErrorPopup {...ERRORS.saveFailed} visible={popup?.kind === 'error'} onClose={() => setPopup(null)} />
        </BaseScreen>
    );
};

const styles = StyleSheet.create({
    scroll: {
        paddingBottom: spacing.xl,
    },
    kind: {
        marginHorizontal: gutter,
        marginTop: spacing.sm,
    },
    time: {
        flexDirection: 'row',
        marginHorizontal: gutter,
    },
    note: {
        marginHorizontal: gutter + 2,
        marginTop: spacing.xs,
    },
    linkPicker: {
        marginHorizontal: gutter,
    },
    hint: {
        marginTop: spacing.sm,
        marginHorizontal: 2,
    },
    problem: {
        marginTop: spacing.lg,
        marginHorizontal: gutter + 2,
    },
    save: {
        marginHorizontal: gutter,
        marginTop: spacing.lg,
    },
});

export default TaskEditorScreen;
