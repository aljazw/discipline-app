import { StyleSheet, View } from 'react-native';
import { Habit } from '../types/types';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';
import { currentStreak, recentDays } from '../utils/habits';
import { describeHabitDays } from '../utils/habitText';
import { formatDuration, formatMinutes } from '../utils/dayPlan';
import { ThemedText } from './ThemedText';
import Card from './Card';
import IconButton from './IconButton';
import IconTile from './IconTile';

interface HabitCardProps {
    habit: Habit;
    onOpen: () => void;
    /** Reordering: up/down buttons instead of the last-7-days strip. Omit a handler at either end. */
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    reordering?: boolean;
}

/** One habit: icon, title, time, length, days, streak and the last 7 days. */
const HabitCard: React.FC<HabitCardProps> = ({ habit, onOpen, onMoveUp, onMoveDown, reordering }) => {
    const { colors } = useTheme().theme;
    const streak = currentStreak(habit);

    return (
        <Card onPress={reordering ? undefined : onOpen} accessibilityLabel={`Edit ${habit.title}`} style={styles.card}>
            <IconTile icon={habit.icon} size={40} />

            <View style={styles.body}>
                <ThemedText weight="medium" numberOfLines={1}>
                    {habit.title}
                </ThemedText>
                <ThemedText size="small" color="muted" numberOfLines={1} tabular>
                    {formatMinutes(habit.time)} · {formatDuration(habit.duration)} · {describeHabitDays(habit.days)}
                    {streak > 0 ? ` · ${streak}-day streak` : ''}
                </ThemedText>
                {!reordering && (
                    <View style={styles.strip}>
                        {recentDays(habit).map(day => (
                            <View
                                key={day.key}
                                style={[
                                    styles.day,
                                    day.scheduled && { backgroundColor: colors.elevated },
                                    day.done && { backgroundColor: colors.primaryGreen },
                                    day.isToday && { borderColor: colors.muted },
                                ]}
                            />
                        ))}
                    </View>
                )}
            </View>

            {reordering && (
                <View style={styles.moves}>
                    <IconButton
                        icon="Up"
                        size={34}
                        accessibilityLabel={`Move ${habit.title} earlier`}
                        onPress={onMoveUp ?? (() => undefined)}
                        tint={onMoveUp ? undefined : colors.border}
                    />
                    <IconButton
                        icon="Down"
                        size={34}
                        accessibilityLabel={`Move ${habit.title} later`}
                        onPress={onMoveDown ?? (() => undefined)}
                        tint={onMoveDown ? undefined : colors.border}
                    />
                </View>
            )}
        </Card>
    );
};

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: spacing.sm - 2,
        paddingVertical: spacing.sm + 4,
    },
    body: {
        flex: 1,
        marginHorizontal: spacing.sm + 2,
    },
    strip: {
        flexDirection: 'row',
        marginTop: spacing.sm - 2,
    },
    day: {
        flex: 1,
        maxWidth: 22,
        height: 4,
        borderRadius: 2,
        marginRight: 3,
        borderWidth: 0.5,
        borderColor: 'transparent',
    },
    moves: {
        flexDirection: 'row',
    },
});

export default HabitCard;
