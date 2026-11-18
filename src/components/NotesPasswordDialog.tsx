import { APP_NAME } from '../constants/brand';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ModalPanel from './ModalPanel';
import Button from './Button';
import IconTile from './IconTile';
import TextField from './TextField';
import { ThemedText } from './ThemedText';
import { spacing } from '../theme';
import { haptics } from '../utils/haptics';
import {
    MIN_PASSWORD_LENGTH,
    changeNotesPassword,
    createNotesPassword,
    resetNotesPassword,
    unlockNotes,
} from '../utils/notes';

export type NotesPasswordMode = 'create' | 'unlock' | 'change';

interface Props {
    /** null = closed. */
    mode: NotesPasswordMode | null;
    onClose: () => void;
    /** After the password was set, the notes unlocked, or the password changed. */
    onDone: () => void;
    /** After a forgotten password wiped the protected notes. */
    onReset?: () => void;
}

const TITLES: Record<NotesPasswordMode, string> = {
    create: 'Set a notes password',
    unlock: 'Unlock notes',
    change: 'Change notes password',
};

const MESSAGES: Record<NotesPasswordMode, string> = {
    create: 'One password protects all your protected notes. They’re encrypted with it on this phone and in backups. There is no way to recover it: if you forget it, protected notes are lost.',
    unlock: 'Enter your notes password.',
    change: 'Your protected notes stay as they are; only the password that opens them changes.',
};

const tooShort = (password: string) => password.length < MIN_PASSWORD_LENGTH;

/** Sets, asks for, or changes the one password of all protected notes. */
const NotesPasswordDialog: React.FC<Props> = ({ mode, onClose, onDone, onReset }) => {
    const [current, setCurrent] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [forgot, setForgot] = useState(false);

    // Never keep a typed password around between openings.
    useEffect(() => {
        setCurrent('');
        setPassword('');
        setConfirm('');
        setError('');
        setForgot(false);
    }, [mode]);

    if (!mode) {
        return null;
    }

    const fail = (text: string) => {
        haptics.warning();
        setError(text);
    };

    const submit = async () => {
        setError('');
        try {
            if (mode === 'unlock') {
                if ((await unlockNotes(password)) === 'wrong') {
                    setPassword('');
                    return fail('Wrong password.');
                }
            } else {
                if (tooShort(password)) {
                    return fail(`Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase is easy to remember.`);
                }
                if (password !== confirm) {
                    return fail('The passwords don’t match.');
                }
                if (mode === 'create') {
                    if (!(await createNotesPassword(password))) {
                        return fail('Couldn’t save the password. Please try again.');
                    }
                } else {
                    const result = await changeNotesPassword(current, password);
                    if (result === 'wrong') {
                        setCurrent('');
                        return fail('Your current password is wrong.');
                    }
                    if (result === 'failed') {
                        return fail('Couldn’t save the new password. The old one still works.');
                    }
                }
            }
        } catch (e) {
            return fail(e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.');
        }
        haptics.success();
        onDone();
    };

    const reset = async () => {
        if (await resetNotesPassword()) {
            haptics.success();
            onReset?.();
            onClose();
        } else {
            fail('Couldn’t delete the protected notes. Please try again.');
        }
    };

    if (forgot) {
        return (
            <ModalPanel visible onClose={onClose}>
                <IconTile icon="Alert" tone="danger" size={40} style={styles.icon} />
                <ThemedText size="large" weight="bold">
                    Forgot your password?
                </ThemedText>
                <ThemedText color="muted" style={styles.message}>
                    Protected notes are encrypted with your password, so nobody, not even {APP_NAME}, can open them without
                    it. You can delete all protected notes and set a new password. Your other notes stay.
                </ThemedText>
                {!!error && (
                    <ThemedText size="small" color="primaryRed" style={styles.error}>
                        {error}
                    </ThemedText>
                )}
                <View style={styles.actions}>
                    <Button
                        label="Back"
                        variant="secondary"
                        compact
                        onPress={() => setForgot(false)}
                        style={styles.flex}
                    />
                    <Button
                        label="Delete them"
                        variant="danger"
                        compact
                        onPress={reset}
                        style={[styles.flex, styles.gap]}
                    />
                </View>
            </ModalPanel>
        );
    }

    const field = (value: string, onChange: (v: string) => void, placeholder: string, autoFocus = false) => (
        <TextField
            inset={false}
            surface="background"
            value={value}
            onChangeText={v => {
                onChange(v);
                setError('');
            }}
            placeholder={placeholder}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={mode === 'unlock' ? 'current-password' : 'new-password'}
            importantForAutofill="yes"
            autoFocus={autoFocus}
            maxLength={200}
            onSubmitEditing={mode === 'unlock' ? submit : undefined}
            style={styles.field}
        />
    );

    const ready =
        mode === 'unlock'
            ? password.length > 0
            : password.length > 0 && confirm.length > 0 && (mode === 'create' || current.length > 0);

    return (
        <ModalPanel visible onClose={onClose}>
            <IconTile icon="Lock" tone="accent" size={40} style={styles.icon} />
            <ThemedText size="large" weight="bold">
                {TITLES[mode]}
            </ThemedText>
            <ThemedText color="muted" style={styles.message}>
                {MESSAGES[mode]}
            </ThemedText>

            {mode === 'change' && field(current, setCurrent, 'Current password', true)}
            {field(password, setPassword, mode === 'unlock' ? 'Password' : 'New password', mode !== 'change')}
            {mode !== 'unlock' && field(confirm, setConfirm, 'Repeat the new password')}

            {!!error && (
                <ThemedText size="small" color="primaryRed" style={styles.error}>
                    {error}
                </ThemedText>
            )}
            {mode === 'unlock' && (
                <Pressable onPress={() => setForgot(true)} hitSlop={8} style={styles.forgot}>
                    <ThemedText size="small" color="accent" weight="medium">
                        Forgot password?
                    </ThemedText>
                </Pressable>
            )}

            <View style={styles.actions}>
                <Button label="Cancel" variant="secondary" compact onPress={onClose} style={styles.flex} />
                <Button
                    label={mode === 'unlock' ? 'Unlock' : 'Save'}
                    compact
                    disabled={!ready}
                    onPress={submit}
                    style={[styles.flex, styles.gap]}
                />
            </View>
        </ModalPanel>
    );
};

const styles = StyleSheet.create({
    icon: {
        marginBottom: spacing.md,
    },
    message: {
        marginTop: spacing.sm,
    },
    field: {
        marginTop: spacing.md,
    },
    error: {
        marginTop: spacing.sm,
    },
    forgot: {
        alignSelf: 'flex-start',
        marginTop: spacing.md,
    },
    actions: {
        flexDirection: 'row',
        marginTop: spacing.lg,
    },
    flex: {
        flex: 1,
    },
    gap: {
        marginLeft: spacing.sm,
    },
});

export default NotesPasswordDialog;
