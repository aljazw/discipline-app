import { APP_NAME } from '../constants/brand';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import BackButton from '../components/BackButton';
import BaseScreen from '../components/BaseScreen';
import Dialog, { confirmActions } from '../components/Dialog';
import ErrorPopup from '../components/ErrorPopup';
import IconButton from '../components/IconButton';
import NotesPasswordDialog, { NotesPasswordMode } from '../components/NotesPasswordDialog';
import { ThemedText } from '../components/ThemedText';
import { useTheme } from '../context/ThemeContext';
import { gutter, spacing } from '../theme';
import { Note, RootStackNavigation, RootStackParamList } from '../types/types';
import { ERRORS } from '../constants/strings';
import { newId } from '../utils/dates';
import { haptics } from '../utils/haptics';
import { logger } from '../utils/logger';
import {
    deleteNote,
    hasNotesPassword,
    loadNote,
    saveNote,
    setNotesScreenSecure,
    useNotesUnlocked,
} from '../utils/notes';
import { noteDate } from './NotesScreen';

/** Typing pauses this long before the note is saved. */
const SAVE_DELAY_MS = 700;

type Dialog = 'unprotect' | 'delete' | 'error' | null;
/** What to do once the password dialog succeeds. */
type PasswordStep = { mode: NotesPasswordMode; then: 'protect' | 'open' } | null;

const contentOf = (n: Note) => JSON.stringify([n.title, n.body, n.protected]);
const isEmpty = (n: Note) => !n.title.trim() && !n.body.trim();

const NoteEditorScreen: React.FC = () => {
    const { colors } = useTheme().theme;
    const navigation = useNavigation<RootStackNavigation>();
    const { params } = useRoute<RouteProp<RootStackParamList, 'NoteEditor'>>();
    const unlocked = useNotesUnlocked();

    const [note, setNote] = useState<Note | null>(null);
    const [dialog, setDialog] = useState<Dialog>(null);
    const [password, setPassword] = useState<PasswordStep>(null);

    /** Latest note for saves that run outside a render (timers, leaving, backgrounding). */
    const current = useRef<Note | null>(null);
    current.current = note;
    /** Content as last saved; nothing is written while it matches. */
    const saved = useRef('');
    /** Saves run one after another, so an older one can never land last. */
    const saving = useRef<Promise<unknown>>(Promise.resolve());
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const deleted = useRef(false);
    /** Id of the note once it's in storage; a new one isn't kept until something is written in it. */
    const storedId = useRef(params?.noteId);

    // ---- Load --------------------------------------------------------------

    const open = useCallback(async () => {
        const id = storedId.current;
        if (!id) {
            const now = Date.now();
            const fresh: Note = {
                id: newId('n'),
                createdAt: now,
                updatedAt: now,
                title: '',
                body: '',
                protected: false,
                locked: false,
            };
            saved.current = contentOf(fresh);
            setNote(fresh);
            return;
        }
        const loaded = await loadNote(id);
        if (!loaded) {
            navigation.goBack();
            return;
        }
        if (loaded.locked) {
            setNote(null);
            setPassword({ mode: 'unlock', then: 'open' });
            return;
        }
        saved.current = contentOf(loaded);
        setNote(loaded);
    }, [navigation]);

    useEffect(() => {
        open().catch(error => logger.warn('Could not open the note', error));
    }, [open]);

    // The notes locked while this one was open (app left in the background): hide it until unlocked again.
    useEffect(() => {
        if (!unlocked && current.current?.protected) {
            setNote(null);
            setPassword({ mode: 'unlock', then: 'open' });
        }
    }, [unlocked]);

    // ---- Save --------------------------------------------------------------

    const save = useCallback(() => {
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }
        const run = async () => {
            const n = current.current;
            if (!n || deleted.current || contentOf(n) === saved.current || (!storedId.current && isEmpty(n))) {
                return;
            }
            const next = { ...n, updatedAt: Date.now() };
            if (await saveNote(next)) {
                saved.current = contentOf(next);
                storedId.current = next.id;
            } else {
                setDialog('error');
            }
        };
        saving.current = saving.current.then(run, run);
        return saving.current;
    }, []);

    const edit = (change: Partial<Note>) => {
        setNote(n => (n ? { ...n, ...change } : n));
        if (timer.current) {
            clearTimeout(timer.current);
        }
        timer.current = setTimeout(save, SAVE_DELAY_MS);
    };

    // Save when leaving the screen or the app.
    useEffect(
        () =>
            navigation.addListener('beforeRemove', () => {
                save();
            }),
        [navigation, save],
    );
    useEffect(() => {
        const sub = AppState.addEventListener('change', state => state === 'background' && save());
        return () => sub.remove();
    }, [save]);

    useFocusEffect(
        useCallback(() => {
            setNotesScreenSecure(!!note?.protected);
            return () => setNotesScreenSecure(false);
        }, [note?.protected]),
    );

    // ---- Protection ----------------------------------------------------------

    const protect = async () => {
        if (!(await hasNotesPassword())) {
            setPassword({ mode: 'create', then: 'protect' });
        } else if (!unlocked) {
            setPassword({ mode: 'unlock', then: 'protect' });
        } else {
            applyProtected(true);
        }
    };

    const applyProtected = (value: boolean) => {
        setNote(n => (n ? { ...n, protected: value } : n));
        current.current = current.current ? { ...current.current, protected: value } : null;
        haptics.success();
        save();
    };

    const onPasswordDone = () => {
        const step = password;
        setPassword(null);
        if (step?.then === 'protect') {
            applyProtected(true);
        } else {
            open().catch(error => logger.warn('Could not open the note', error));
        }
    };

    const remove = async () => {
        setDialog(null);
        const n = current.current;
        deleted.current = true;
        await saving.current;
        if (n && storedId.current && !(await deleteNote(n.id))) {
            deleted.current = false;
            setDialog('error');
            return;
        }
        haptics.success();
        navigation.goBack();
    };

    return (
        <BaseScreen
            title={note?.protected ? 'Protected note' : 'Note'}
            subtitle={note ? `Edited ${noteDate(note.updatedAt)}` : undefined}
            headerLeft={<BackButton />}
            headerRight={
                note ? (
                    <View style={styles.headerButtons}>
                        <IconButton
                            icon={note.protected ? 'Lock' : 'Unlock'}
                            variant="outline"
                            tint={note.protected ? colors.accent : undefined}
                            accessibilityLabel={note.protected ? 'Remove password protection' : 'Protect with password'}
                            onPress={() => (note.protected ? setDialog('unprotect') : protect())}
                        />
                        <IconButton
                            icon="Trash"
                            variant="outline"
                            accessibilityLabel="Delete note"
                            onPress={() => (storedId.current ? setDialog('delete') : remove())}
                            style={styles.headerGap}
                        />
                    </View>
                ) : undefined
            }>
            {note ? (
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    <TextInput
                        value={note.title}
                        onChangeText={title => edit({ title })}
                        placeholder="Title"
                        placeholderTextColor={colors.muted}
                        autoComplete="off"
                        importantForAutofill="no"
                        selectionColor={colors.accent}
                        style={[styles.title, { color: colors.text }]}
                        maxLength={200}
                        returnKeyType="next"
                        submitBehavior="submit"
                        autoFocus={!params?.noteId}
                    />
                    <TextInput
                        value={note.body}
                        onChangeText={body => edit({ body })}
                        placeholder="Note"
                        placeholderTextColor={colors.muted}
                        autoComplete="off"
                        importantForAutofill="no"
                        selectionColor={colors.accent}
                        style={[styles.body, { color: colors.text }]}
                        multiline
                        textAlignVertical="top"
                        scrollEnabled={false}
                    />
                </ScrollView>
            ) : (
                <ThemedText color="muted" align="center" style={styles.locked}>
                    This note is locked.
                </ThemedText>
            )}

            <NotesPasswordDialog
                mode={password?.mode ?? null}
                onClose={() => {
                    const step = password;
                    setPassword(null);
                    // Nothing to show without the password.
                    if (step?.then === 'open') {
                        navigation.goBack();
                    }
                }}
                onDone={onPasswordDone}
                onReset={() => navigation.goBack()}
            />

            <Dialog
                visible={dialog === 'unprotect'}
                onClose={() => setDialog(null)}
                icon="Unlock"
                title="Remove protection?"
                message={`The note will no longer be encrypted. Anyone who can open ${APP_NAME}, or a backup file, can read it.`}
                actions={confirmActions(
                    () => setDialog(null),
                    'Remove',
                    () => {
                        setDialog(null);
                        applyProtected(false);
                    },
                    true,
                )}
            />

            <Dialog
                visible={dialog === 'delete'}
                onClose={() => setDialog(null)}
                icon="Trash"
                tone="danger"
                title="Delete this note?"
                message="It can’t be brought back."
                actions={confirmActions(() => setDialog(null), 'Delete', remove, true)}
            />

            <ErrorPopup {...ERRORS.saveFailed} visible={dialog === 'error'} onClose={() => setDialog(null)} />
        </BaseScreen>
    );
};

const styles = StyleSheet.create({
    headerButtons: {
        flexDirection: 'row',
    },
    headerGap: {
        marginLeft: spacing.sm,
    },
    scroll: {
        flexGrow: 1,
        paddingHorizontal: gutter,
        paddingBottom: spacing.xl,
    },
    title: {
        fontSize: 22,
        fontWeight: '600',
        paddingVertical: spacing.sm,
    },
    body: {
        flexGrow: 1,
        minHeight: 240,
        fontSize: 16,
        lineHeight: 24,
        paddingTop: spacing.sm,
    },
    locked: {
        marginTop: spacing.xl,
    },
});

export default NoteEditorScreen;
