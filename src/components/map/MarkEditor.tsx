import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Dialog, { confirmActions } from '../Dialog';
import Chip from '../Chip';
import TextField from '../TextField';
import { spacing } from '../../theme';
import { MarkKind } from '../../types/types';
import { MARK_KINDS } from '../../storage';
import { MARK_STYLE } from './mapUi';

export interface MarkDraft {
    name: string;
    kind: MarkKind;
    note: string;
}

/** Name, type and note of a place, for saving a new one or editing it. */
const MarkEditor: React.FC<{
    visible: boolean;
    title: string;
    initial: MarkDraft;
    onCancel: () => void;
    onSave: (draft: MarkDraft) => void;
}> = ({ visible, title, initial, onCancel, onSave }) => {
    const [draft, setDraft] = useState(initial);

    useEffect(() => {
        if (visible) {
            setDraft(initial);
        }
        // Only reset when the dialog opens, not on every parent render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);

    return (
        <Dialog
            visible={visible}
            onClose={onCancel}
            title={title}
            actions={confirmActions(onCancel, 'Save', () =>
                onSave({ ...draft, name: draft.name.trim() || MARK_STYLE[draft.kind].label }),
            )}>
            <TextField
                value={draft.name}
                onChangeText={name => setDraft(d => ({ ...d, name }))}
                placeholder={MARK_STYLE[draft.kind].label}
                maxLength={60}
                style={styles.field}
            />
            <View style={styles.kinds}>
                {MARK_KINDS.map(kind => (
                    <Chip
                        key={kind}
                        label={MARK_STYLE[kind].label}
                        icon={MARK_STYLE[kind].icon}
                        selected={draft.kind === kind}
                        onPress={() => setDraft(d => ({ ...d, kind }))}
                    />
                ))}
            </View>
            <TextField
                value={draft.note}
                onChangeText={note => setDraft(d => ({ ...d, note }))}
                placeholder="Note (depth, bait, what you caught…)"
                multiline
                maxLength={500}
                style={styles.field}
            />
        </Dialog>
    );
};

const styles = StyleSheet.create({
    field: {
        marginTop: spacing.md,
    },
    kinds: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginTop: spacing.sm,
    },
});

export default MarkEditor;
