import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import ApneaSessionBanner from '../components/ApneaSessionBanner';
import BaseScreen from '../components/BaseScreen';
import { ListGroup, ListRow } from '../components/ListGroup';
import { FadeIn } from '../components/Motion';
import { spacing } from '../theme';
import { RootStackNavigation } from '../types/types';
import { getDayHours, getPlanPrefs, getStoredNotes } from '../storage';
import { useMusic } from '../utils/music';

/** The extra apps inside the app: alarm, map, notes, music and apnea training. */
const ToolsScreen: React.FC = () => {
    const navigation = useNavigation<RootStackNavigation>();
    const music = useMusic();
    const [noteCount, setNoteCount] = useState<number | null>(null);
    /** The wake-up time while the alarm is on; null while it's off. */
    const [alarmAt, setAlarmAt] = useState<string | null>(null);

    useFocusEffect(
        useCallback(() => {
            getStoredNotes()
                .then(notes => setNoteCount(notes.length))
                .catch(() => setNoteCount(null));
            Promise.all([getPlanPrefs(), getDayHours()])
                .then(([prefs, hours]) => setAlarmAt(prefs.wakeAlarm ? hours.wake : null))
                .catch(() => setAlarmAt(null));
        }, []),
    );

    const musicText =
        music.count > 0 && music.title
            ? `${music.playWhenReady ? 'Playing' : 'Paused'} · ${music.title}`
            : 'Songs on your phone, plays in the background';
    const notesText = noteCount
        ? `${noteCount} note${noteCount === 1 ? '' : 's'} · protect any with a password`
        : 'Quick notes, protect any with a password';

    return (
        <BaseScreen title="Tools" subtitle="Everything else, in one place">
            <ScrollView contentContainerStyle={styles.scroll}>
                <ApneaSessionBanner />
                <FadeIn>
                    <ListGroup>
                        <ListRow
                            icon="Alarm"
                            title="Wake-up alarm"
                            description={alarmAt ? `On · rings at ${alarmAt}` : 'Off · wake up on time, every day'}
                            onPress={() => navigation.navigate('DayHours')}
                        />
                        <ListRow
                            icon="Map"
                            title="Map"
                            description="Offline charts, your speed and heading, tracks and Water Wolf surveys"
                            onPress={() => navigation.navigate('Map')}
                        />
                        <ListRow
                            icon="Notes"
                            title="Notes"
                            description={notesText}
                            onPress={() => navigation.navigate('Notes')}
                        />
                        <ListRow
                            icon="Music"
                            title="Music"
                            description={musicText}
                            onPress={() => navigation.navigate('Music')}
                        />
                        <ListRow
                            icon="Breathe"
                            title="Apnea training"
                            description="Breath-hold tables and breathing exercises"
                            onPress={() => navigation.navigate('Apnea')}
                        />
                    </ListGroup>
                </FadeIn>
            </ScrollView>
        </BaseScreen>
    );
};

const styles = StyleSheet.create({
    scroll: {
        paddingTop: spacing.sm,
        paddingBottom: spacing.xl,
    },
});

export default ToolsScreen;
