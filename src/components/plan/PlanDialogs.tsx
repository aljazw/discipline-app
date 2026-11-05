/** Dialogs shared by Today and the call screen: skip (costs a video and a reason), drop, pick a day, how long. */
import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Chip from '../Chip';
import ChipGroup from '../ChipGroup';
import Dialog from '../Dialog';
import TextField from '../TextField';
import { ThemedText } from '../ThemedText';
import { spacing } from '../../theme';
import { addDays, toDateKey } from '../../utils/dates';
import { watchVideoToEnd } from '../../utils/promiseVideo';
import { MAX_REASON } from '../../storage/habits';

/** A reason must say something. */
const MIN_REASON = 3;

const reasonOk = (text: string) => text.trim().length >= MIN_REASON;

/**
 * Skipping a habit (or today's part of a big task) costs something: the
 * video, watched to the end, then the reason in your own words. Real
 * emergencies get through; skipping out of laziness takes longer than starting.
 */
export const SkipDialog: React.FC<{
    visible: boolean;
    title: string;
    onClose: () => void;
    onSkip: (reason: string) => void | Promise<unknown>;
}> = ({ visible, title, onClose, onSkip }) => {
    const [stage, setStage] = useState<'ask' | 'reason'>('ask');
    const [reason, setReason] = useState('');
    const [notWatched, setNotWatched] = useState(false);

    useEffect(() => {
        if (visible) {
            setStage('ask');
            setReason('');
            setNotWatched(false);
        }
    }, [visible]);

    const watch = async () => {
        if (await watchVideoToEnd()) {
            setStage('reason');
        } else {
            setNotWatched(true);
        }
    };

    if (stage === 'reason') {
        return (
            <Dialog
                visible={visible}
                onClose={onClose}
                dismissable={false}
                title="Why are you skipping?"
                message={`Be honest. You’ll see this again in your weekly review.`}
                actions={[
                    { label: 'Do it instead', variant: 'secondary', onPress: onClose },
                    { label: 'Skip today', variant: 'danger', onPress: () => (reasonOk(reason) ? onSkip(reason) : undefined) },
                ]}>
                <TextField
                    value={reason}
                    onChangeText={setReason}
                    placeholder="The real reason"
                    maxLength={MAX_REASON}
                    inset={false}
                    surface="background"
                    autoFocus
                    multiline
                    style={styles.field}
                />
            </Dialog>
        );
    }
    return (
        <Dialog
            visible={visible}
            onClose={onClose}
            icon="Alert"
            tone="danger"
            title={`Skip ${title} today?`}
            message={
                notWatched
                    ? 'The video has to be watched to the end.'
                    : 'Skipping costs something: watch a short video to the end, then write why.'
            }
            actions={[
                { label: 'Cancel', variant: 'secondary', onPress: onClose },
                { label: 'Watch video', variant: 'danger', onPress: watch },
            ]}
        />
    );
};

/** Dropping a task: a decision not to do it, with the reason. */
export const DropDialog: React.FC<{
    visible: boolean;
    title: string;
    onClose: () => void;
    onDrop: (reason: string) => void | Promise<unknown>;
}> = ({ visible, title, onClose, onDrop }) => {
    const [reason, setReason] = useState('');
    useEffect(() => {
        if (visible) {
            setReason('');
        }
    }, [visible]);
    return (
        <Dialog
            visible={visible}
            onClose={onClose}
            title={`Drop “${title}”?`}
            message="You decide not to do it at all. Why?"
            actions={[
                { label: 'Cancel', variant: 'secondary', onPress: onClose },
                { label: 'Drop', variant: 'danger', onPress: () => (reasonOk(reason) ? onDrop(reason) : undefined) },
            ]}>
            <TextField
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. Not needed any more"
                maxLength={MAX_REASON}
                inset={false}
                surface="background"
                autoFocus
                style={styles.field}
            />
        </Dialog>
    );
};

/** One more day for a task out of time; only once, and on that day it must be done. */
export const PickDayDialog: React.FC<{
    visible: boolean;
    onClose: () => void;
    onPick: (dateKey: string) => void | Promise<unknown>;
}> = ({ visible, onClose, onPick }) => {
    const today = new Date();
    const options = Array.from({ length: 7 }, (_, i) => {
        const date = addDays(today, i + 1);
        return {
            key: toDateKey(date),
            label: i === 0 ? 'Tomorrow' : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }),
        };
    });
    return (
        <Dialog
            visible={visible}
            onClose={onClose}
            title="Pick a day"
            message="You can do this only once. On that day it must be done."
            actions={[{ label: 'Cancel', variant: 'secondary', onPress: onClose }]}>
            <ChipGroup style={styles.chips}>
                {options.map(o => (
                    <Chip key={o.key} label={o.label} onPress={() => onPick(o.key)} />
                ))}
            </ChipGroup>
        </Dialog>
    );
};

const TOOK = [5, 15, 30, 60, 120, 240];

export const minutesLabel = (m: number) => (m < 60 ? `${m} min` : `${m / 60} h`);

/** How long something took, for the time log; skippable. */
export const TookDialog: React.FC<{
    visible: boolean;
    title?: string;
    options?: number[];
    onClose: () => void;
    onPick: (minutes?: number) => void | Promise<unknown>;
    skipLabel?: string;
}> = ({ visible, title = 'How long did it take?', options = TOOK, onClose, onPick, skipLabel = 'Skip' }) => (
    <Dialog
        visible={visible}
        onClose={onClose}
        title={title}
        message={<ThemedText color="muted">For where your time goes.</ThemedText>}
        actions={[{ label: skipLabel, variant: 'secondary', onPress: () => onPick(undefined) }]}>
        <ChipGroup style={styles.chips}>
            {options.map(m => (
                <Chip key={m} label={minutesLabel(m)} onPress={() => onPick(m)} />
            ))}
        </ChipGroup>
    </Dialog>
);

const styles = StyleSheet.create({
    field: {
        marginTop: spacing.md,
    },
    chips: {
        marginHorizontal: 0,
        marginTop: spacing.md,
    },
});
