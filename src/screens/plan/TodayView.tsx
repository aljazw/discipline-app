import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { RootStackNavigation, Todo } from '../../types/types';
import Button from '../../components/Button';
import { ListGroup } from '../../components/ListGroup';
import CheckButton from '../../components/CheckButton';
import Dialog, { DialogAction } from '../../components/Dialog';
import ErrorPopup from '../../components/ErrorPopup';
import Icon from '../../components/Icon';
import SectionHeader from '../../components/SectionHeader';
import { ThemedText } from '../../components/ThemedText';
import { FadeIn, animateLayout } from '../../components/Motion';
import { DropDialog, PickDayDialog, SkipDialog, TookDialog } from '../../components/plan/PlanDialogs';
import { useTheme } from '../../context/ThemeContext';
import { useHabits } from '../../hooks/useHabits';
import { useTodos } from '../../hooks/useTodos';
import { updateHabit, updateTodo } from '../../storage';
import { gutter, spacing } from '../../theme';
import { toDateKey } from '../../utils/dates';
import { formatDuration, formatMinutes } from '../../utils/dayPlan';
import { currentStreak, unskipHabit } from '../../utils/habits';
import { haptics } from '../../utils/haptics';
import {
    TodayItem,
    describeDeadline,
    describeSlice,
    planToday,
    sliceTitle,
} from '../../utils/plan';
import { setHabitDone, skipHabitOn } from '../../utils/planService';
import { completeAll, completeCurrent, dropWithReason, logTime, pickDay, postpone, skipSlice } from '../../utils/todos';
import { ERRORS } from '../../constants/strings';

type Popup =
    | { kind: 'menu'; item: TodayItem }
    | { kind: 'skip'; item: TodayItem }
    | { kind: 'drop'; todo: Todo }
    | { kind: 'pick'; todo: Todo }
    | { kind: 'took'; todo: Todo; all: boolean }
    | { kind: 'log'; todo: Todo };

const titleOf = (item: TodayItem) =>
    item.kind === 'habit' ? item.habit.title : item.kind === 'slice' ? sliceTitle(item.todo) : item.todo.title;

/** What must be done today: habits, today's part of big tasks, and tasks out of time. Then one task up next. */
const TodayView: React.FC = () => {
    const navigation = useNavigation<RootStackNavigation>();
    const { colors } = useTheme().theme;
    const { habits, loaded: habitsLoaded } = useHabits();
    const { todos, loaded: todosLoaded } = useTodos();
    const [popup, setPopup] = useState<Popup | null>(null);
    const [showDone, setShowDone] = useState(false);
    const [failed, setFailed] = useState(false);
    const close = () => setPopup(null);

    const now = new Date();
    const key = toDateKey(now);
    const plan = planToday(habits, todos, now);
    const loaded = habitsLoaded && todosLoaded;

    const run = async (write: Promise<boolean>) => {
        animateLayout();
        if (!(await write)) {
            setFailed(true);
        }
    };
    const changeTodo = (todo: Todo, fn: (t: Todo) => Todo) => run(updateTodo(todo.id, fn));

    /** The round check on the left: done, or the step that leads there. */
    const check = (item: TodayItem) => {
        haptics.tap();
        if (item.kind === 'habit') {
            if (item.state === 'skipped') {
                setPopup({ kind: 'menu', item });
                return;
            }
            if (item.state === 'open') {
                haptics.success();
            }
            run(setHabitDone(item.habit.id, key, item.state === 'open'));
        } else if (item.state !== 'open') {
            setPopup({ kind: 'menu', item });
        } else if (item.kind === 'slice' && item.todo.big?.minutes) {
            setPopup({ kind: 'log', todo: item.todo });
        } else {
            setPopup({ kind: 'took', todo: item.todo, all: item.kind === 'task' });
        }
    };

    const menuActions = (item: TodayItem): DialogAction[] => {
        const edit: DialogAction = {
            label: 'Edit',
            variant: 'secondary',
            onPress: () => {
                close();
                if (item.kind === 'habit') {
                    navigation.navigate('TaskEditor', { habitId: item.habit.id });
                } else {
                    navigation.navigate('TodoEditor', { todoId: item.todo.id });
                }
            },
        };
        if (item.kind === 'habit') {
            if (item.state === 'skipped') {
                return [
                    edit,
                    {
                        label: 'Do it after all',
                        onPress: () => {
                            close();
                            run(updateHabit(item.habit.id, h => unskipHabit(h, key)));
                        },
                    },
                ];
            }
            return item.state === 'open'
                ? [edit, { label: 'Skip today', variant: 'danger', onPress: () => setPopup({ kind: 'skip', item }) }]
                : [edit];
        }
        if (item.kind === 'slice') {
            return item.state === 'open'
                ? [edit, { label: 'Skip today', variant: 'danger', onPress: () => setPopup({ kind: 'skip', item }) }]
                : [edit];
        }
        if (item.state === 'done') {
            return [edit];
        }
        const actions: DialogAction[] = [
            { label: 'Drop', variant: 'danger', onPress: () => setPopup({ kind: 'drop', todo: item.todo }) },
        ];
        if (!item.todo.dueOn) {
            actions.push({ label: 'Pick a day', variant: 'secondary', onPress: () => setPopup({ kind: 'pick', todo: item.todo }) });
        }
        return [edit, ...actions];
    };

    const describe = (item: TodayItem): string => {
        if (item.kind === 'habit') {
            if (item.state === 'skipped') {
                return `Skipped: ${item.habit.skips?.[key] ?? ''}`;
            }
            const streak = currentStreak(item.habit, now);
            return [
                `${formatMinutes(item.habit.time)} · ${formatDuration(item.habit.duration)}`,
                streak > 0 ? `${streak}-day streak` : '',
            ]
                .filter(Boolean)
                .join(' · ');
        }
        if (item.kind === 'slice') {
            if (item.state === 'skipped') {
                return `Skipped: ${item.todo.skips?.[key] ?? ''}`;
            }
            return item.todo.big?.minutes
                ? `${item.todo.title} · ${describeSlice(item.todo, key)}`
                : `${describeSlice(item.todo, key)} · ${item.todo.title}`;
        }
        if (item.state === 'done') {
            return 'Done';
        }
        return item.todo.dueOn ? `Your picked day · ${describeDeadline(item.todo, key)}` : describeDeadline(item.todo, key);
    };

    const row = (item: TodayItem) => {
        const late = item.kind === 'task' && item.state === 'open' && item.late > 0;
        return (
            <Pressable
                key={`${item.kind}:${item.id}`}
                onPress={() => setPopup({ kind: 'menu', item })}
                accessibilityRole="button"
                accessibilityLabel={titleOf(item)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.elevated }]}>
                <CheckButton
                    round
                    size={24}
                    checked={item.state === 'done'}
                    onPress={() => check(item)}
                    accessibilityLabel={`${titleOf(item)} done`}
                />
                <View style={styles.rowText}>
                    <ThemedText
                        numberOfLines={2}
                        color={item.state === 'open' ? 'text' : 'muted'}
                        style={item.state === 'skipped' ? styles.struck : undefined}>
                        {titleOf(item)}
                    </ThemedText>
                    <ThemedText size="small" color={late ? 'primaryRed' : 'muted'} numberOfLines={1} tabular>
                        {describe(item)}
                    </ThemedText>
                </View>
            </Pressable>
        );
    };

    const { upNext } = plan;
    const finishedCount = plan.finished.length;

    return (
        <ScrollView contentContainerStyle={styles.scroll}>
            {loaded && plan.must.length === 0 && finishedCount === 0 && !upNext && (
                <ThemedText size="small" color="muted" style={styles.empty}>
                    Nothing to do today. Tasks and habits show up here on the day they need doing.
                </ThemedText>
            )}

            {plan.must.length > 0 && (
                <FadeIn>
                    <SectionHeader title="Must do today" />
                    <ListGroup>{plan.must.map(row)}</ListGroup>
                </FadeIn>
            )}
            {loaded && plan.must.length === 0 && finishedCount > 0 && (
                <View style={styles.allDone}>
                    <Icon name="Check" size={16} tint={colors.primaryGreen} />
                    <ThemedText size="small" color="muted" style={styles.allDoneText}>
                        All done for today. Anything else is a bonus.
                    </ThemedText>
                </View>
            )}

            {upNext && (
                <FadeIn key={upNext.id}>
                    <SectionHeader title="Up next" />
                    <ListGroup>
                        <View style={styles.row}>
                            <CheckButton
                                round
                                size={24}
                                checked={false}
                                onPress={() => {
                                    haptics.tap();
                                    setPopup({ kind: 'took', todo: upNext, all: true });
                                }}
                                accessibilityLabel={`${upNext.title} done`}
                            />
                            <View style={styles.rowText}>
                                <ThemedText numberOfLines={2}>{upNext.title}</ThemedText>
                                <ThemedText size="small" color="muted" numberOfLines={1}>
                                    {describeDeadline(upNext, key)}
                                </ThemedText>
                            </View>
                            <Button
                                label="Later"
                                variant="ghost"
                                compact
                                onPress={() => {
                                    haptics.tap();
                                    changeTodo(upNext, t => postpone(t, key));
                                }}
                                style={styles.later}
                            />
                        </View>
                    </ListGroup>
                    {plan.waiting > 0 && (
                        <Pressable onPress={() => navigation.navigate('BottomTabs', { screen: 'Habits', params: { view: 'tasks' } })}>
                            <ThemedText size="small" color="muted" style={styles.more}>
                                {plan.waiting === 1 ? '1 more task waits' : `${plan.waiting} more tasks wait`} in Tasks
                            </ThemedText>
                        </Pressable>
                    )}
                </FadeIn>
            )}

            {finishedCount > 0 && (
                <>
                    <SectionHeader
                        title={`Done today · ${finishedCount}`}
                        right={
                            <Button
                                label={showDone ? 'Hide' : 'Show'}
                                variant="ghost"
                                compact
                                onPress={() => {
                                    animateLayout();
                                    setShowDone(!showDone);
                                }}
                                style={styles.headerButton}
                            />
                        }
                    />
                    {showDone && <ListGroup>{plan.finished.map(row)}</ListGroup>}
                </>
            )}

            {popup?.kind === 'menu' && (
                <Dialog
                    visible
                    onClose={close}
                    title={titleOf(popup.item)}
                    message={
                        popup.item.kind === 'habit' && popup.item.habit.why
                            ? `“${popup.item.habit.why}”`
                            : describe(popup.item)
                    }
                    actions={menuActions(popup.item)}
                />
            )}

            <SkipDialog
                visible={popup?.kind === 'skip'}
                title={popup?.kind === 'skip' ? titleOf(popup.item) : ''}
                onClose={close}
                onSkip={reason => {
                    if (popup?.kind !== 'skip') {
                        return;
                    }
                    const { item } = popup;
                    close();
                    if (item.kind === 'habit') {
                        run(skipHabitOn(item.habit.id, key, reason));
                    } else if (item.kind === 'slice') {
                        changeTodo(item.todo, t => skipSlice(t, key, reason));
                    }
                }}
            />
            <DropDialog
                visible={popup?.kind === 'drop'}
                title={popup?.kind === 'drop' ? popup.todo.title : ''}
                onClose={close}
                onDrop={reason => {
                    if (popup?.kind === 'drop') {
                        close();
                        changeTodo(popup.todo, t => dropWithReason(t, Date.now(), reason));
                    }
                }}
            />
            <PickDayDialog
                visible={popup?.kind === 'pick'}
                onClose={close}
                onPick={day => {
                    if (popup?.kind === 'pick') {
                        close();
                        changeTodo(popup.todo, t => pickDay(t, day));
                    }
                }}
            />
            <TookDialog
                visible={popup?.kind === 'took'}
                onClose={close}
                onPick={minutes => {
                    if (popup?.kind !== 'took') {
                        return;
                    }
                    const { todo, all } = popup;
                    close();
                    haptics.success();
                    changeTodo(todo, t =>
                        all
                            ? { ...completeAll(t, Date.now()), ...(minutes ? { minutes } : {}) }
                            : completeCurrent(t, Date.now(), minutes),
                    );
                }}
            />
            <TookDialog
                visible={popup?.kind === 'log'}
                title="How long did you work on it?"
                options={[15, 25, 30, 45, 60, 90]}
                skipLabel="Cancel"
                onClose={close}
                onPick={minutes => {
                    if (popup?.kind !== 'log') {
                        return;
                    }
                    const { todo } = popup;
                    close();
                    if (minutes) {
                        haptics.success();
                        changeTodo(todo, t => logTime(t, key, minutes));
                    }
                }}
            />
            <ErrorPopup {...ERRORS.saveFailed} visible={failed} onClose={() => setFailed(false)} />
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    scroll: {
        paddingBottom: spacing.xl,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.sm + 2,
        paddingHorizontal: spacing.md,
        minHeight: 56,
    },
    rowText: {
        flex: 1,
        marginLeft: spacing.md,
    },
    struck: {
        textDecorationLine: 'line-through',
    },
    empty: {
        marginHorizontal: gutter + 2,
        marginTop: spacing.xl,
    },
    allDone: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: gutter + 2,
        marginTop: spacing.xl,
    },
    allDoneText: {
        marginLeft: spacing.sm,
    },
    later: {
        marginRight: -spacing.sm,
    },
    more: {
        marginHorizontal: gutter + 2,
        marginTop: spacing.sm,
    },
    headerButton: {
        marginVertical: -8,
        marginRight: -spacing.sm,
    },
});

export default TodayView;
