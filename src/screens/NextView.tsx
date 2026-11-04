import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Todo } from '../types/types';
import Button from '../components/Button';
import Card from '../components/Card';
import Chip from '../components/Chip';
import ChipGroup from '../components/ChipGroup';
import Dialog, { confirmActions } from '../components/Dialog';
import ErrorPopup from '../components/ErrorPopup';
import IconButton from '../components/IconButton';
import { ListGroup, ListRow, Toggle } from '../components/ListGroup';
import SectionHeader from '../components/SectionHeader';
import StatRow from '../components/StatRow';
import StatTile from '../components/StatTile';
import TextField from '../components/TextField';
import { ThemedText } from '../components/ThemedText';
import { FadeIn, animateLayout } from '../components/Motion';
import { useTheme } from '../context/ThemeContext';
import { useTodos } from '../hooks/useTodos';
import { deleteTodo, saveTodo, updateTodo } from '../storage';
import { gutter, spacing } from '../theme';
import { startOfWeek, toDateKey } from '../utils/dates';
import { haptics } from '../utils/haptics';
import {
    MAX_TITLE,
    POSTPONE_LIMIT,
    completeCurrent,
    currentStep,
    currentTitle,
    describeAge,
    describeProgress,
    doneSince,
    drop,
    isOpen,
    isSnoozed,
    makeSmaller,
    mustDecide,
    newStep,
    newTodo,
    openInOrder,
    pickNext,
    postpone,
} from '../utils/todos';
import { ERRORS } from '../constants/strings';

const TOOK: { label: string; minutes: number }[] = [
    { label: '5 min', minutes: 5 },
    { label: '15 min', minutes: 15 },
    { label: '30 min', minutes: 30 },
    { label: '1 h', minutes: 60 },
    { label: '2 h', minutes: 120 },
    { label: '4 h', minutes: 240 },
];

type Dialogs = { kind: 'took'; todo: Todo } | { kind: 'smaller'; todo: Todo } | { kind: 'edit'; todo: Todo } | null;

/**
 * One-time things, one at a time. Write everything down; the app puts up the
 * one that has waited longest, and "Not now" can't go on forever.
 */
const NextView: React.FC = () => {
    const { theme } = useTheme();
    const { todos, loaded } = useTodos();
    const [draft, setDraft] = useState('');
    const [quickOnly, setQuickOnly] = useState(false);
    const [showAll, setShowAll] = useState(false);
    const [dialog, setDialog] = useState<Dialogs>(null);
    const [failed, setFailed] = useState(false);
    const close = () => setDialog(null);

    const now = Date.now();
    const todayKey = toDateKey(new Date(now));
    const open = useMemo(() => openInOrder(todos, todayKey), [todos, todayKey]);
    const hasQuick = open.some(t => t.quick);
    const next = pickNext(todos, todayKey, quickOnly && hasQuick);
    const snoozed = open.filter(t => isSnoozed(t, todayKey)).length;
    const doneThisWeek = doneSince(todos, startOfWeek(new Date(now)).getTime());

    const run = async (write: Promise<boolean>) => {
        if (!(await write)) {
            setFailed(true);
        }
    };
    const change = (todo: Todo, fn: (t: Todo) => Todo) => {
        animateLayout();
        return run(updateTodo(todo.id, fn));
    };

    const add = () => {
        const title = draft.trim();
        if (!title) {
            return;
        }
        haptics.tap();
        setDraft('');
        animateLayout();
        run(saveTodo(newTodo(title, Date.now())));
    };

    const finish = (todo: Todo, minutes?: number) => {
        close();
        haptics.success();
        change(todo, t => completeCurrent(t, Date.now(), minutes));
    };

    return (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <TextField
                value={draft}
                onChangeText={setDraft}
                placeholder="Add something you need to do"
                maxLength={MAX_TITLE}
                onSubmitEditing={add}
                submitBehavior="submit"
                returnKeyType="done"
                style={styles.add}
            />

            {loaded && todos.length > 0 && (
                <FadeIn>
                    <StatRow>
                        <StatTile label="Open" value={open.length} />
                        <StatTile label="Done this week" value={doneThisWeek} />
                    </StatRow>
                </FadeIn>
            )}

            {loaded && next && (
                <FadeIn key={next.id + (currentStep(next)?.id ?? '')}>
                    <Card highlight={mustDecide(next) ? theme.colors.warning : undefined} style={styles.hero}>
                        <ThemedText size="small" color="muted" numberOfLines={1}>
                            {currentStep(next) ? `${describeProgress(next)} · ${next.title}` : 'Up next'}
                        </ThemedText>
                        <ThemedText size="large" weight="bold" style={styles.heroTitle}>
                            {currentTitle(next)}
                        </ThemedText>
                        <ThemedText size="small" color="muted">
                            {describeAge(next, now)}
                        </ThemedText>
                        {mustDecide(next) && (
                            <ThemedText size="small" color="warning" style={styles.decide}>
                                Put off {next.postponed} times. Do it now, make it smaller, or drop it.
                            </ThemedText>
                        )}
                        <View style={styles.buttons}>
                            <Button
                                label="Done"
                                icon="Check"
                                iconLeading
                                onPress={() => setDialog({ kind: 'took', todo: next })}
                                style={styles.flex}
                            />
                            {mustDecide(next) ? (
                                <Button
                                    label="Make smaller"
                                    variant="secondary"
                                    onPress={() => setDialog({ kind: 'smaller', todo: next })}
                                    style={styles.gap}
                                />
                            ) : (
                                <Button
                                    label="Not now"
                                    variant="secondary"
                                    onPress={() => {
                                        haptics.tap();
                                        change(next, t => postpone(t, todayKey));
                                    }}
                                    style={styles.gap}
                                />
                            )}
                        </View>
                        <View style={styles.links}>
                            {!mustDecide(next) && (
                                <Button
                                    label="Make smaller"
                                    variant="ghost"
                                    compact
                                    onPress={() => setDialog({ kind: 'smaller', todo: next })}
                                />
                            )}
                            <Button
                                label="Drop"
                                variant="ghost"
                                compact
                                onPress={() => change(next, t => drop(t, Date.now()))}
                            />
                        </View>
                    </Card>
                </FadeIn>
            )}

            {loaded && !next && open.length > 0 && (
                <Card>
                    <ThemedText weight="strong">That's it for today</ThemedText>
                    <ThemedText size="small" color="muted" style={styles.text}>
                        {snoozed === 1 ? 'One thing is' : `${snoozed} things are`} put off until tomorrow.
                    </ThemedText>
                </Card>
            )}

            {loaded && todos.length === 0 && (
                <Card>
                    <ThemedText weight="strong">Get it out of your head</ThemedText>
                    <ThemedText size="small" color="muted" style={styles.text}>
                        Write down every small thing you keep meaning to do. One comes up at a time, the one that has
                        waited longest. After {POSTPONE_LIMIT} times "Not now" you have to do it, make it smaller or
                        drop it.
                    </ThemedText>
                </Card>
            )}

            {hasQuick && (
                <ChipGroup style={styles.chips}>
                    <Chip
                        label="Quick ones only"
                        icon="Zap"
                        selected={quickOnly}
                        onPress={() => {
                            animateLayout();
                            setQuickOnly(!quickOnly);
                        }}
                    />
                </ChipGroup>
            )}

            {open.length > 1 && (
                <>
                    <SectionHeader
                        title={`All open · ${open.length}`}
                        right={
                            <Button
                                label={showAll ? 'Hide' : 'Show'}
                                variant="ghost"
                                compact
                                onPress={() => {
                                    animateLayout();
                                    setShowAll(!showAll);
                                }}
                                style={styles.headerButton}
                            />
                        }
                    />
                    {showAll && (
                        <ListGroup>
                            {open.map(todo => (
                                <ListRow
                                    key={todo.id}
                                    icon={todo.quick ? 'Zap' : todo.steps.length > 0 ? 'Layers' : 'Target'}
                                    title={todo.title}
                                    description={[
                                        describeProgress(todo),
                                        isSnoozed(todo, todayKey) ? 'Tomorrow' : describeAge(todo, now),
                                    ]
                                        .filter(Boolean)
                                        .join(' · ')}
                                    onPress={() => setDialog({ kind: 'edit', todo })}
                                />
                            ))}
                        </ListGroup>
                    )}
                </>
            )}

            <Dialog
                visible={dialog?.kind === 'took'}
                onClose={close}
                title="How long did it take?"
                message="For the day log. Skip if you don't know."
                actions={[
                    {
                        label: 'Skip',
                        variant: 'secondary',
                        onPress: () => (dialog?.kind === 'took' ? finish(dialog.todo) : undefined),
                    },
                ]}>
                <ChipGroup style={styles.dialogChips}>
                    {TOOK.map(option => (
                        <Chip
                            key={option.minutes}
                            label={option.label}
                            onPress={() => (dialog?.kind === 'took' ? finish(dialog.todo, option.minutes) : undefined)}
                        />
                    ))}
                </ChipGroup>
            </Dialog>

            {dialog?.kind === 'smaller' && (
                <SmallerDialog
                    todo={dialog.todo}
                    onClose={close}
                    onAdd={title => {
                        close();
                        change(dialog.todo, t => makeSmaller(t, title));
                    }}
                />
            )}

            {dialog?.kind === 'edit' && (
                <EditDialog
                    todo={todos.find(t => t.id === dialog.todo.id && isOpen(t)) ?? dialog.todo}
                    onClose={close}
                    onSave={todo => {
                        close();
                        animateLayout();
                        run(saveTodo(todo));
                    }}
                    onDelete={() => {
                        close();
                        animateLayout();
                        run(deleteTodo(dialog.todo.id));
                    }}
                />
            )}

            <ErrorPopup {...ERRORS.saveFailed} visible={failed} onClose={() => setFailed(false)} />
        </ScrollView>
    );
};

/** "What's the first small step?" Vague things get put off; a concrete first step doesn't. */
const SmallerDialog: React.FC<{ todo: Todo; onClose: () => void; onAdd: (title: string) => void }> = ({
    todo,
    onClose,
    onAdd,
}) => {
    const [title, setTitle] = useState('');
    const ok = title.trim().length > 0;
    return (
        <Dialog
            visible
            onClose={onClose}
            title="Make it smaller"
            message={`What's the first small step of "${currentTitle(todo)}"? Something you could do in a few minutes.`}
            actions={[
                { label: 'Cancel', variant: 'secondary', onPress: onClose },
                { label: 'Add step', onPress: () => (ok ? onAdd(title) : undefined) },
            ]}>
            <TextField
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Find last year's papers"
                maxLength={MAX_TITLE}
                inset={false}
                surface="background"
                autoFocus
                onSubmitEditing={() => ok && onAdd(title)}
                style={styles.dialogField}
            />
        </Dialog>
    );
};

/** Rename, mark quick, and manage the steps of a to-do. */
const EditDialog: React.FC<{
    todo: Todo;
    onClose: () => void;
    onSave: (todo: Todo) => void;
    onDelete: () => void;
}> = ({ todo, onClose, onSave, onDelete }) => {
    const [title, setTitle] = useState(todo.title);
    const [quick, setQuick] = useState(!!todo.quick);
    const [steps, setSteps] = useState(todo.steps);
    const [stepDraft, setStepDraft] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);

    const addStep = () => {
        if (stepDraft.trim()) {
            animateLayout();
            setSteps([...steps, newStep(stepDraft)]);
            setStepDraft('');
        }
    };
    const save = () => {
        const trimmed = title.trim();
        if (!trimmed) {
            return;
        }
        onSave({ ...todo, title: trimmed, steps, quick: quick || undefined });
    };

    if (confirmDelete) {
        return (
            <Dialog
                visible
                onClose={() => setConfirmDelete(false)}
                icon="Trash"
                tone="danger"
                title="Delete it?"
                message="It's removed as if it was never added. To decide not to do it, use Drop instead."
                actions={confirmActions(() => setConfirmDelete(false), 'Delete', onDelete, true)}
            />
        );
    }

    return (
        <Dialog
            visible
            onClose={onClose}
            title="Edit"
            actions={[
                { label: 'Delete', variant: 'danger', onPress: () => setConfirmDelete(true) },
                { label: 'Save', onPress: save },
            ]}>
            <TextField
                value={title}
                onChangeText={setTitle}
                maxLength={MAX_TITLE}
                inset={false}
                surface="background"
                style={styles.dialogField}
            />
            <View style={styles.quickRow}>
                <View style={styles.flex}>
                    <ThemedText weight="medium">Quick</ThemedText>
                    <ThemedText size="small" color="muted">
                        Takes under 5 minutes
                    </ThemedText>
                </View>
                <Toggle value={quick} onValueChange={setQuick} />
            </View>

            <ThemedText size="small" color="muted" style={styles.stepsLabel}>
                {steps.length === 0 ? 'Steps, for something bigger' : 'Steps, done before the to-do itself'}
            </ThemedText>
            {steps.map(step => (
                <View key={step.id} style={styles.stepRow}>
                    <ThemedText
                        color={step.doneAt ? 'muted' : 'text'}
                        style={[styles.flex, step.doneAt ? styles.doneStep : null]}
                        numberOfLines={2}>
                        {step.title}
                    </ThemedText>
                    <IconButton
                        icon="Close"
                        size={18}
                        accessibilityLabel={`Remove ${step.title}`}
                        onPress={() => {
                            animateLayout();
                            setSteps(steps.filter(s => s.id !== step.id));
                        }}
                    />
                </View>
            ))}
            <TextField
                value={stepDraft}
                onChangeText={setStepDraft}
                placeholder="Add a step"
                maxLength={MAX_TITLE}
                inset={false}
                surface="background"
                onSubmitEditing={addStep}
                submitBehavior="submit"
                style={styles.dialogField}
            />
        </Dialog>
    );
};

const styles = StyleSheet.create({
    scroll: {
        paddingBottom: spacing.xl,
    },
    add: {
        marginTop: spacing.sm,
    },
    hero: {
        padding: spacing.lg,
    },
    heroTitle: {
        marginTop: spacing.xs,
        marginBottom: spacing.xs,
    },
    decide: {
        marginTop: spacing.sm,
    },
    buttons: {
        flexDirection: 'row',
        marginTop: spacing.md,
    },
    links: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: spacing.xs,
        marginBottom: -spacing.sm,
    },
    flex: {
        flex: 1,
    },
    gap: {
        marginLeft: spacing.sm,
    },
    text: {
        marginTop: spacing.xs,
    },
    chips: {
        marginTop: spacing.sm,
    },
    headerButton: {
        marginVertical: -8,
        marginRight: -spacing.sm,
    },
    dialogChips: {
        marginHorizontal: 0,
        marginTop: spacing.md,
    },
    dialogField: {
        marginTop: spacing.md,
    },
    quickRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: spacing.md,
    },
    stepsLabel: {
        marginTop: spacing.md,
        marginLeft: gutter / 4,
    },
    stepRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: spacing.xs,
    },
    doneStep: {
        textDecorationLine: 'line-through',
    },
});

export default NextView;
