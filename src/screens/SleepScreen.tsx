import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import BackButton from '../components/BackButton';
import Badge from '../components/Badge';
import BaseScreen from '../components/BaseScreen';
import Button from '../components/Button';
import Card from '../components/Card';
import Dialog, { confirmActions } from '../components/Dialog';
import ErrorPopup from '../components/ErrorPopup';
import { ListGroup, ListRow, Toggle } from '../components/ListGroup';
import PassphrasePopup from '../components/PassphrasePopup';
import SectionHeader from '../components/SectionHeader';
import { ThemedText } from '../components/ThemedText';
import TimeInput from '../components/TimeInput';
import { usePassphrase } from '../context/PassphraseContext';
import { gutter, spacing } from '../theme';
import { SleepSchedule } from '../types/types';
import { DEFAULT_SLEEP_SCHEDULE, isSleepWindow, isValidTime, sleepDuration } from '../utils/sleep';
import { getSleepDismissedUntil, getSleepSchedule, setSleepSchedule } from '../storage';
import { logger } from '../utils/logger';
import { ERRORS } from '../constants/strings';

type Dialog =
    | { kind: 'startsNow'; next: SleepSchedule }
    | { kind: 'passphrase'; next: SleepSchedule }
    | { kind: 'error' };

const split = (hhmm: string) => hhmm.split(':') as [string, string];

const SleepScreen: React.FC = () => {
    const { isPassphraseEnabled } = usePassphrase();
    const [saved, setSaved] = useState<SleepSchedule>(DEFAULT_SLEEP_SCHEDULE);
    const [pausedUntil, setPausedUntil] = useState(0);
    const [loaded, setLoaded] = useState(false);
    const [bedHour, setBedHour] = useState('23');
    const [bedMinutes, setBedMinutes] = useState('00');
    const [wakeHour, setWakeHour] = useState('07');
    const [wakeMinutes, setWakeMinutes] = useState('00');
    const [dialog, setDialog] = useState<Dialog | null>(null);
    const close = () => setDialog(null);

    const showTimes = (schedule: SleepSchedule) => {
        const [bh, bm] = split(schedule.bedtime);
        const [wh, wm] = split(schedule.wake);
        setBedHour(bh);
        setBedMinutes(bm);
        setWakeHour(wh);
        setWakeMinutes(wm);
    };

    useFocusEffect(
        useCallback(() => {
            Promise.all([getSleepSchedule(), getSleepDismissedUntil()])
                .then(([schedule, until]) => {
                    setSaved(schedule);
                    setPausedUntil(until);
                    showTimes(schedule);
                })
                .catch(error => logger.warn('Could not load sleep schedule', error))
                .finally(() => setLoaded(true));
        }, []),
    );

    const pad = (v: string) => v.padStart(2, '0');
    const bedtime = `${pad(bedHour)}:${pad(bedMinutes)}`;
    const wake = `${pad(wakeHour)}:${pad(wakeMinutes)}`;
    const timesValid = isValidTime(bedtime) && isValidTime(wake) && bedtime !== wake;
    const timesChanged = bedtime !== saved.bedtime || wake !== saved.wake;

    const save = async (next: SleepSchedule) => {
        close();
        if (await setSleepSchedule(next)) {
            setSaved(next);
            setPausedUntil(0);
            showTimes(next);
        } else {
            setDialog({ kind: 'error' });
        }
    };

    /** Saving into an active night covers the phone at once, so say so first. */
    const confirmAndSave = (next: SleepSchedule) =>
        next.enabled && isSleepWindow(next) ? setDialog({ kind: 'startsNow', next }) : save(next);

    const onToggle = (enabled: boolean) => {
        const next = { ...saved, enabled };
        if (!enabled && isPassphraseEnabled) {
            setDialog({ kind: 'passphrase', next });
        } else {
            confirmAndSave(next);
        }
    };

    const paused = pausedUntil > Date.now();
    const activeNow = isSleepWindow(saved) && !paused;
    const status = !saved.enabled
        ? { label: 'Off', tone: 'neutral' as const }
        : activeNow
        ? { label: 'Active now', tone: 'success' as const }
        : paused && isSleepWindow(saved)
        ? { label: `Off until ${saved.wake}`, tone: 'warning' as const }
        : { label: `Starts at ${saved.bedtime}`, tone: 'accent' as const };

    return (
        <BaseScreen
            title="Sleep time"
            subtitle="Your phone goes to bed when you do"
            headerLeft={<BackButton />}
            isLoading={!loaded}>
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                <Card>
                    <View style={styles.statusRow}>
                        <View style={styles.flex}>
                            <ThemedText weight="strong" tabular>
                                {saved.bedtime} – {saved.wake}
                            </ThemedText>
                            <ThemedText size="small" color="muted">
                                {sleepDuration(saved)} every night
                            </ThemedText>
                        </View>
                        <Badge label={status.label} tone={status.tone} dot />
                    </View>
                </Card>

                <ListGroup style={styles.group}>
                    <ListRow icon="Moon" title="Sleep time" description="Cover every app between bedtime and morning">
                        <Toggle value={saved.enabled} onValueChange={onToggle} />
                    </ListRow>
                </ListGroup>

                <SectionHeader title="Schedule" />
                <View style={styles.times}>
                    <TimeInput
                        label="Bedtime"
                        hourValue={bedHour}
                        minutesValue={bedMinutes}
                        setHour={setBedHour}
                        setMinutes={setBedMinutes}
                    />
                    <View style={styles.timeGap} />
                    <TimeInput
                        label="Wake up"
                        hourValue={wakeHour}
                        minutesValue={wakeMinutes}
                        setHour={setWakeHour}
                        setMinutes={setWakeMinutes}
                    />
                </View>
                {timesChanged && (
                    <Button
                        label={
                            timesValid
                                ? `Save · ${sleepDuration({ bedtime, wake })} of sleep`
                                : 'Enter two different times'
                        }
                        disabled={!timesValid}
                        onPress={() => confirmAndSave({ ...saved, bedtime, wake })}
                        style={styles.save}
                    />
                )}

                <SectionHeader title="How it works" />
                <ThemedText size="small" color="muted" style={styles.text}>
                    During sleep time every app opens the sleep page instead, including this app. Calls, messages, the
                    camera, the alarm clock, Settings, the home screen and the keyboard keep working.
                </ThemedText>
                <ThemedText size="small" color="muted" style={styles.text}>
                    To turn it off for the night you watch a short video to the end, then type one sentence. It comes
                    back on automatically the next evening.
                </ThemedText>
            </ScrollView>

            <Dialog
                visible={dialog?.kind === 'startsNow'}
                onClose={close}
                icon="Moon"
                title="Sleep time starts now"
                message="It's already past bedtime, so every app will be covered as soon as you leave this screen."
                actions={confirmActions(close, 'Start sleep time', () =>
                    dialog?.kind === 'startsNow' ? save(dialog.next) : undefined,
                )}
            />
            <PassphrasePopup
                visible={dialog?.kind === 'passphrase'}
                onClose={close}
                onConfirm={() => (dialog?.kind === 'passphrase' ? save(dialog.next) : undefined)}
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
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    group: {
        marginTop: spacing.md,
    },
    times: {
        flexDirection: 'row',
        marginHorizontal: gutter,
    },
    timeGap: {
        width: spacing.md,
    },
    save: {
        marginHorizontal: gutter,
        marginTop: spacing.md,
    },
    text: {
        marginHorizontal: gutter + 2,
        marginBottom: spacing.sm,
    },
});

export default SleepScreen;
