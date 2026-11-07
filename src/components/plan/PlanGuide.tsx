import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { spacing } from '../../theme';
import Dialog from '../Dialog';
import Icon, { IconName } from '../Icon';
import { ThemedText } from '../ThemedText';

const PARTS: { icon: IconName; title: string; text: string }[] = [
    { icon: 'Calendar', title: 'Today', text: 'What needs doing today, gathered from the other three.' },
    { icon: 'Target', title: 'Tasks', text: 'One-time things. You get a few days, then they must be done.' },
    { icon: 'Habits', title: 'Habits', text: 'On set days at a set time. The app calls you, and skipping takes a reason.' },
    { icon: 'Time', title: 'Routines', text: 'Things you do anyway, like work or sleep. Only the time is counted.' },
];

/** A short guide to the Plan tab's four views: Today, Tasks, Habits, Routines. */
const PlanGuide: React.FC<{ visible: boolean; onClose: () => void }> = ({ visible, onClose }) => {
    const { colors } = useTheme().theme;
    return (
        <Dialog
            visible={visible}
            onClose={onClose}
            title="How Plan works"
            actions={[{ label: 'Got it', onPress: onClose }]}>
            {PARTS.map(p => (
                <View key={p.title} style={styles.row}>
                    <Icon name={p.icon} size={18} tint={colors.accent} style={styles.icon} />
                    <View style={styles.text}>
                        <ThemedText weight="medium">{p.title}</ThemedText>
                        <ThemedText size="small" color="muted">
                            {p.text}
                        </ThemedText>
                    </View>
                </View>
            ))}
        </Dialog>
    );
};

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        marginTop: spacing.md,
    },
    icon: {
        marginTop: 2,
        marginRight: spacing.sm + 2,
    },
    text: {
        flex: 1,
    },
});

export default PlanGuide;
