import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { RootStackNavigation, RootStackParamList, Todo, TodoStep } from '../types/types';
import BackButton from '../components/BackButton';
import BaseScreen from '../components/BaseScreen';
import Button from '../components/Button';
import Card from '../components/Card';
import Chip from '../components/Chip';
import ChipGroup from '../components/ChipGroup';
import DayPicker from '../components/DayPicker';
import Dialog, { confirmActions } from '../components/Dialog';
import DurationPicker from '../components/DurationPicker';
import ErrorPopup from '../components/ErrorPopup';
import Icon from '../components/Icon';
import IconButton from '../components/IconButton';
import SectionHeader from '../components/SectionHeader';
import Segmented from '../components/Segmented';
import TextField from '../components/TextField';
import { ThemedText } from '../components/ThemedText';
import { animateLayout } from '../components/Motion';
import { DropDialog } from '../components/plan/PlanDialogs';
import { useTheme } from '../context/ThemeContext';
import { deleteTodo, getTodos, saveTodo } from '../storage';
import { gutter, spacing } from '../theme';
import { fromDateKey, toDateKey } from '../utils/dates';
import { describeHabitDays } from '../utils/habitText';
import { haptics } from '../utils/haptics';
import { TASK_DAYS, deadlineOf, describeDeadline } from '../utils/plan';
import { MAX_TITLE, completeAll, dropWithReason, newStep } from '../utils/todos';
import { ERRORS } from '../constants/strings';
import { DAY_PRESETS, WEEKDAYS, sameDays } from '../constants/days';

type Size = 'small' | 'big';
type Mode = 'steps' | 'time';

const SIZES: { value: Size; label: string }[] = [
    { value: 'small', label: 'Small' },
    { value: 'big', label: 'Big' },
];

const MODES: { value: Mode; label: string }[] = [
    { value: 'steps', label: 'In steps' },
    { value: 'time', label: 'Time each day' },
];

const DAILY = [15, 25, 30, 45, 50, 60, 90, 120];

type Popup = 'delete' | 'drop' | 'error' | null;

/** A task's name and size: small (TASK_DAYS to do it) or big (steps, or time on set days). */
const TodoEditorScreen: React.FC = () => {
    const navigation = useNavigation<RootStackNavigation>();
    const { colors } = useTheme().theme;
    const { params } = useRoute<RouteProp<RootStackParamList, 'TodoEditor'>>();
    const [todo, setTodo] = useState<Todo | null>(null);
    const [title, setTitle] = useState('');
    const [size, setSize] = useState<Size>('small');
    const [mode, setMode] = useState<Mode>('steps');
    const [days, setDays] = useState<boolean[]>(WEEKDAYS);
    const [custom, setCustom] = useState(false);
    const [minutes, setMinutes] = useState(50);
    const [steps, setSteps] = useState<TodoStep[]>([]);
    const [stepDraft, setStepDraft] = useState('');
    const [popup, setPopup] = useState<Popup>(null);

    useEffect(() => {
        getTodos()
            .then(todos => {
                const found = todos.find(t => t.id === params.todoId);
                if (!found) {
                    navigation.goBack();
                    return;
                }
                setTodo(found);
                setTitle(found.title);
                setSteps(found.steps);
                if (found.big) {
                    setSize('big');
                    setDays(found.big.days);
                    setCustom(!DAY_PRESETS.some(p => sameDays(p.days, found.big!.days)));
                    setMode(found.big.minutes ? 'time' : 'steps');
                    setMinutes(found.big.minutes ?? 50);
                }
            })
            .catch(() => setPopup('error'));
    }, [navigation, params.todoId]);

    const trimmed = title.trim();
    const todayKey = toDateKey(new Date());
    const open = !!todo && !todo.doneAt && !todo.droppedAt;
    const problem = !trimmed ? 'Give it a name.' : size === 'big' && !days.some(Boolean) ? 'Pick at least one day.' : null;

    const addStep = () => {
        if (stepDraft.trim()) {
            animateLayout();
            setSteps([...steps, newStep(stepDraft)]);
            setStepDraft('');
        }
    };

    const write = async (next: Todo) => {
        if (await saveTodo(next)) {
            haptics.success();
            navigation.goBack();
        } else {
            setPopup('error');
        }
    };

    const save = () => {
        if (!todo || problem) {
            return;
        }
        write({
            ...todo,
            big: undefined,
            title: trimmed,
            steps: size === 'big' && mode === 'steps' ? steps : steps.filter(s => s.doneAt),
            ...(size === 'big' ? { big: { days, ...(mode === 'time' ? { minutes } : {}) } } : {}),
        });
    };

    const remove = async () => {
        setPopup(null);
        if (todo && (await deleteTodo(todo.id))) {
            navigation.goBack();
        } else {
            setPopup('error');
        }
    };

    const deadline = todo ? fromDateKey(deadlineOf(todo)).toLocaleDateString(undefined, { weekday: 'long' }) : '';

    return (
        <BaseScreen
            title={todo?.big || size === 'big' ? 'Big task' : 'Task'}
            headerLeft={<BackButton />}
            headerRight={
                todo ? (
                    <IconButton icon="Trash" variant="outline" accessibilityLabel="Delete task" onPress={() => setPopup('delete')} />
                ) : undefined
            }>
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                <SectionHeader title="What" />
                <TextField value={title} onChangeText={setTitle} maxLength={MAX_TITLE} placeholder="e.g. Call the dentist" />

                <SectionHeader title="Size" />
                <View style={styles.block}>
                    <Segmented
                        options={SIZES}
                        value={size}
                        onChange={v => {
                            animateLayout();
                            setSize(v);
                        }}
                    />
                    <ThemedText size="small" color="muted" style={styles.hint}>
                        {size === 'small'
                            ? todo && open
                                ? `Done in one go. It has ${TASK_DAYS} days: by ${deadline} it must be done (${describeDeadline(
                                      todo,
                                      todayKey,
                                  ).toLowerCase()}).`
                                : `Done in one go, within ${TASK_DAYS} days.`
                            : 'Takes many days, like building an app or learning. On each work day its part is a must-do.'}
                    </ThemedText>
                </View>

                {size === 'big' && (
                    <>
                        <SectionHeader title="Work on it" />
                        <ChipGroup>
                            {DAY_PRESETS.map(p => (
                                <Chip
                                    key={p.label}
                                    label={p.label}
                                    selected={!custom && sameDays(days, p.days)}
                                    onPress={() => {
                                        animateLayout();
                                        setCustom(false);
                                        setDays(p.days);
                                    }}
                                />
                            ))}
                            <Chip
                                label="Pick days"
                                selected={custom}
                                onPress={() => {
                                    animateLayout();
                                    setCustom(true);
                                }}
                            />
                        </ChipGroup>
                        {custom && (
                            <Card>
                                <DayPicker value={days} onChange={setDays} />
                            </Card>
                        )}

                        <View style={[styles.block, styles.gapTop]}>
                            <Segmented
                                options={MODES}
                                value={mode}
                                onChange={v => {
                                    animateLayout();
                                    setMode(v);
                                }}
                            />
                            <ThemedText size="small" color="muted" style={styles.hint}>
                                {mode === 'steps'
                                    ? `${describeHabitDays(days)}: one step a day, e.g. "Create the login screen". The last step is finishing it.`
                                    : `${describeHabitDays(days)}: a set time on it, e.g. learn for 50 minutes.`}
                            </ThemedText>
                        </View>

                        {mode === 'time' ? (
                            <Card style={styles.gapTop}>
                                <DurationPicker
                                    value={minutes}
                                    onChange={setMinutes}
                                    min={5}
                                    max={8 * 60}
                                    presets={DAILY}
                                    accessibilityLabel="Minutes a day"
                                />
                            </Card>
                        ) : (
                            <>
                                <SectionHeader title={`Steps · ${steps.filter(s => !s.doneAt).length} open`} />
                                {steps.length > 0 && (
                                    <Card>
                                        {steps.map((step, i) => (
                                            <View key={step.id} style={[styles.step, i > 0 && styles.stepGap]}>
                                                <Icon
                                                    name={step.doneAt ? 'Check' : 'Target'}
                                                    size={16}
                                                    tint={step.doneAt ? colors.primaryGreen : colors.muted}
                                                />
                                                <ThemedText
                                                    color={step.doneAt ? 'muted' : 'text'}
                                                    style={[styles.stepText, step.doneAt ? styles.struck : null]}
                                                    numberOfLines={2}>
                                                    {step.title}
                                                </ThemedText>
                                                {!step.doneAt && (
                                                    <IconButton
                                                        icon="Close"
                                                        size={30}
                                                        accessibilityLabel={`Remove ${step.title}`}
                                                        onPress={() => {
                                                            animateLayout();
                                                            setSteps(steps.filter(s => s.id !== step.id));
                                                        }}
                                                    />
                                                )}
                                            </View>
                                        ))}
                                    </Card>
                                )}
                                <TextField
                                    value={stepDraft}
                                    onChangeText={setStepDraft}
                                    placeholder="Add a step"
                                    maxLength={MAX_TITLE}
                                    onSubmitEditing={addStep}
                                    submitBehavior="submit"
                                    returnKeyType="done"
                                    style={styles.gapTop}
                                />
                            </>
                        )}
                    </>
                )}

                {problem && trimmed.length > 0 && (
                    <ThemedText size="small" color="primaryRed" style={styles.problem}>
                        {problem}
                    </ThemedText>
                )}
                <Button label="Save" disabled={!!problem || !todo} onPress={save} style={styles.save} />
                {open && todo && (
                    <View style={styles.row}>
                        <Button
                            label="Done"
                            icon="Check"
                            iconLeading
                            variant="secondary"
                            onPress={() => write(completeAll(todo, Date.now()))}
                            style={styles.flex}
                        />
                        <Button label="Drop" variant="secondary" onPress={() => setPopup('drop')} style={[styles.flex, styles.gap]} />
                    </View>
                )}
            </ScrollView>

            <DropDialog
                visible={popup === 'drop'}
                title={todo?.title ?? ''}
                onClose={() => setPopup(null)}
                onDrop={reason => {
                    setPopup(null);
                    if (todo) {
                        write(dropWithReason(todo, Date.now(), reason));
                    }
                }}
            />
            <Dialog
                visible={popup === 'delete'}
                onClose={() => setPopup(null)}
                icon="Trash"
                tone="danger"
                title="Delete it?"
                message="It's removed as if it was never added. To decide not to do it, use Drop instead."
                actions={confirmActions(() => setPopup(null), 'Delete', remove, true)}
            />
            <ErrorPopup {...ERRORS.saveFailed} visible={popup === 'error'} onClose={() => setPopup(null)} />
        </BaseScreen>
    );
};

const styles = StyleSheet.create({
    scroll: {
        paddingBottom: spacing.xl,
    },
    block: {
        marginHorizontal: gutter,
    },
    hint: {
        marginTop: spacing.sm,
        marginHorizontal: 2,
    },
    gapTop: {
        marginTop: spacing.md,
    },
    step: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    stepGap: {
        marginTop: spacing.sm,
    },
    stepText: {
        flex: 1,
        marginLeft: spacing.sm,
    },
    struck: {
        textDecorationLine: 'line-through',
    },
    problem: {
        marginTop: spacing.lg,
        marginHorizontal: gutter + 2,
    },
    save: {
        marginHorizontal: gutter,
        marginTop: spacing.lg,
    },
    row: {
        flexDirection: 'row',
        marginHorizontal: gutter,
        marginTop: spacing.sm,
    },
    flex: {
        flex: 1,
    },
    gap: {
        marginLeft: spacing.sm,
    },
});

export default TodoEditorScreen;
