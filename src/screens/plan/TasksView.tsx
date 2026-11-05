import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { RootStackNavigation, Todo } from '../../types/types';
import Card from '../../components/Card';
import ErrorPopup from '../../components/ErrorPopup';
import { ListGroup, ListRow } from '../../components/ListGroup';
import SectionHeader from '../../components/SectionHeader';
import TextField from '../../components/TextField';
import { ThemedText } from '../../components/ThemedText';
import { FadeIn, animateLayout } from '../../components/Motion';
import { useTodos } from '../../hooks/useTodos';
import { saveTodo } from '../../storage';
import { gutter, spacing } from '../../theme';
import { startOfWeek, toDateKey } from '../../utils/dates';
import { describeHabitDays } from '../../utils/habitText';
import { haptics } from '../../utils/haptics';
import { MAX_OPEN_TASKS, TASK_DAYS, daysLeft, describeDeadline, describeSlice, openTasks } from '../../utils/plan';
import { MAX_TITLE, doneSince, newTodo } from '../../utils/todos';
import { ERRORS } from '../../constants/strings';

/** Every open task: small ones by how much time they have left, then the big ones. */
const TasksView: React.FC = () => {
    const navigation = useNavigation<RootStackNavigation>();
    const { todos, loaded } = useTodos();
    const [draft, setDraft] = useState('');
    const [failed, setFailed] = useState(false);

    const now = Date.now();
    const key = toDateKey(new Date(now));
    const open = openTasks(todos);
    const small = open.filter(t => !t.big).sort((a, b) => daysLeft(a, key) - daysLeft(b, key) || a.createdAt - b.createdAt);
    const big = open.filter(t => t.big).sort((a, b) => a.createdAt - b.createdAt);
    const full = open.length >= MAX_OPEN_TASKS;
    const doneThisWeek = doneSince(todos, startOfWeek(new Date(now)).getTime());

    const add = async () => {
        const title = draft.trim();
        if (!title || full) {
            return;
        }
        haptics.tap();
        setDraft('');
        animateLayout();
        if (!(await saveTodo(newTodo(title, now)))) {
            setFailed(true);
        }
    };

    const open_ = (todo: Todo) => navigation.navigate('TodoEditor', { todoId: todo.id });

    return (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <TextField
                value={draft}
                onChangeText={setDraft}
                placeholder={full ? 'Finish or drop one first' : 'Add something you keep putting off'}
                editable={!full}
                maxLength={MAX_TITLE}
                onSubmitEditing={add}
                submitBehavior="submit"
                returnKeyType="done"
                style={styles.add}
            />
            <ThemedText size="small" color={full ? 'primaryRed' : 'muted'} style={styles.note} tabular>
                {open.length} of {MAX_OPEN_TASKS} open
                {doneThisWeek > 0 ? ` · ${doneThisWeek} done this week` : ''}
            </ThemedText>

            {loaded && open.length === 0 && (
                <Card style={styles.intro}>
                    <ThemedText weight="strong">Get it out of your head</ThemedText>
                    <ThemedText size="small" color="muted" style={styles.text}>
                        Write down the things you keep meaning to do. Each one has {TASK_DAYS} days; then it must be
                        done. Something bigger, like building an app or learning, can be split into steps or given time
                        each day: tap it after adding.
                    </ThemedText>
                </Card>
            )}

            {small.length > 0 && (
                <FadeIn>
                    <SectionHeader title="Tasks" />
                    <ListGroup>
                        {small.map(todo => (
                            <ListRow
                                key={todo.id}
                                icon={daysLeft(todo, key) <= 0 ? 'Alert' : 'Target'}
                                title={todo.title}
                                description={describeDeadline(todo, key)}
                                onPress={() => open_(todo)}
                            />
                        ))}
                    </ListGroup>
                </FadeIn>
            )}

            {big.length > 0 && (
                <FadeIn>
                    <SectionHeader title="Big tasks" />
                    <ListGroup>
                        {big.map(todo => (
                            <ListRow
                                key={todo.id}
                                icon="Layers"
                                title={todo.title}
                                description={`${
                                    todo.big?.minutes ? `${todo.big.minutes} min a day` : describeSlice(todo, key)
                                } · ${describeHabitDays(todo.big?.days ?? [])}`}
                                onPress={() => open_(todo)}
                            />
                        ))}
                    </ListGroup>
                </FadeIn>
            )}

            <ErrorPopup {...ERRORS.saveFailed} visible={failed} onClose={() => setFailed(false)} />
        </ScrollView>
    );
};

const styles = StyleSheet.create({
    scroll: {
        paddingBottom: spacing.xl,
    },
    add: {
        marginTop: spacing.sm,
    },
    note: {
        marginHorizontal: gutter + 2,
        marginTop: spacing.xs + 2,
    },
    intro: {
        marginTop: spacing.md,
    },
    text: {
        marginTop: spacing.xs,
    },
});

export default TasksView;
