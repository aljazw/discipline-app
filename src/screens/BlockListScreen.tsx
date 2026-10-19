import { APP_NAME } from '../constants/brand';
import { ScrollView, StyleSheet, View } from 'react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { BlockEntry, RootStackNavigation, Vacation } from '../types/types';
import AppIcon from '../components/AppIcon';
import Badge, { BadgeTone } from '../components/Badge';
import BaseScreen from '../components/BaseScreen';
import Button from '../components/Button';
import Card from '../components/Card';
import Dialog, { confirmActions } from '../components/Dialog';
import EmptyState from '../components/EmptyState';
import ErrorPopup from '../components/ErrorPopup';
import Favicon from '../components/Favicon';
import IconButton from '../components/IconButton';
import IconTile from '../components/IconTile';
import { ListGroup } from '../components/ListGroup';
import PassphrasePopup from '../components/PassphrasePopup';
import SearchBar from '../components/SearchBar';
import SectionHeader from '../components/SectionHeader';
import { ThemedText } from '../components/ThemedText';
import { FadeIn, animateLayout } from '../components/Motion';
import { usePassphrase } from '../context/PassphraseContext';
import { useTheme } from '../context/ThemeContext';
import { useBlockList } from '../hooks/useBlockList';
import { useAppForeground } from '../hooks/useAppForeground';
import { gutter, spacing } from '../theme';
import { checkAccessibilityEnabled, openAccessibilitySettings } from '../utils/accessibility';
import { describeMinutes, describeSchedule, isBlockActiveNow } from '../utils/schedule';
import { getLimitUsage, usageKeyOf } from '../utils/limitUsage';
import { haptics } from '../utils/haptics';
import { ERRORS } from '../constants/strings';
import { getVacation } from '../storage';
import { isOnVacation, vacationRangeLabel } from '../utils/vacation';
import { fromDateKey, shortDate } from '../utils/dates';

/** One dialog at a time. */
type Dialog =
    | { kind: 'remove'; entry: BlockEntry }
    | { kind: 'hide'; entry: BlockEntry }
    | { kind: 'passphrase'; entry: BlockEntry }
    | { kind: 'error'; title: string; text: string };

const SEARCH_THRESHOLD = 5;

/** The blocks tab: protection status and every blocked site and app, with Settings one tap away. */
const BlockListScreen: React.FC = () => {
    const { theme } = useTheme();
    const navigation = useNavigation<RootStackNavigation>();

    const { isPassphraseEnabled } = usePassphrase();
    const { entries, loaded: listLoaded, loadFailed, remove, hide } = useBlockList();
    const [now, setNow] = useState(new Date());
    const [protectionOn, setProtectionOn] = useState<boolean | null>(null);
    const [vacation, setVacation] = useState<Vacation | null>(null);
    const [query, setQuery] = useState('');
    const [dialog, setDialog] = useState<Dialog | null>(null);
    /** Minutes used today on blocks with a daily limit, by usage key. */
    const [usage, setUsage] = useState<Record<string, number>>({});

    const close = () => setDialog(null);

    // Fresh with every tick of `now`: on focus, on return to the app, and each minute.
    useEffect(() => {
        let alive = true;
        getLimitUsage().then(next => alive && setUsage(next));
        return () => {
            alive = false;
        };
    }, [now]);

    const refreshProtection = useCallback(() => {
        checkAccessibilityEnabled().then(setProtectionOn);
        getVacation()
            .then(setVacation)
            .catch(() => setVacation(null));
        setNow(new Date());
    }, []);
    useFocusEffect(refreshProtection);
    // Coming back from Accessibility settings should update the status at once.
    useAppForeground(refreshProtection);

    useEffect(() => {
        if (loadFailed) {
            setDialog({ kind: 'error', ...ERRORS.dataLoadError });
        }
    }, [loadFailed]);

    // Keep "Active" badges fresh while the screen is open.
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 60_000);
        return () => clearInterval(id);
    }, []);

    /** Runs a list change and reports failure in the error dialog. */
    const apply = async (change: (entry: BlockEntry) => Promise<boolean>, entry: BlockEntry) => {
        animateLayout();
        if (await change(entry)) {
            haptics.success();
            close();
        } else {
            setDialog({ kind: 'error', ...ERRORS.saveFailed });
        }
    };

    const confirmRemove = (entry: BlockEntry) =>
        isPassphraseEnabled ? setDialog({ kind: 'passphrase', entry }) : apply(remove, entry);

    const visible = useMemo(() => entries.filter(w => w.visible), [entries]);
    const onVacation = isOnVacation(vacation, now);
    /** On schedule now (a limited one may still have time left). */
    const onSchedule = useCallback(
        (entry: BlockEntry) => !onVacation && isBlockActiveNow(entry, now),
        [onVacation, now],
    );
    const usedOf = useCallback((entry: BlockEntry) => usage[usageKeyOf(entry)] ?? 0, [usage]);
    const activeCount = useMemo(
        () => entries.filter(w => onSchedule(w) && (!w.limit || usedOf(w) >= w.limit)).length,
        [entries, onSchedule, usedOf],
    );
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? visible.filter(w => w.label.toLowerCase().includes(q)) : visible;
    }, [visible, query]);

    const goToAdd = () => navigation.navigate('AddSite');

    return (
        <BaseScreen
            title="Blocks"
            subtitle="The websites and apps you keep away from"
            headerRight={
                <IconButton
                    icon="Settings"
                    variant="outline"
                    accessibilityLabel="Settings"
                    onPress={() => navigation.navigate('Settings')}
                />
            }>
            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                {/* ---- Protection status ---- */}
                <FadeIn>
                    {onVacation && vacation ? (
                        <Card onPress={() => navigation.navigate('Vacation')} accessibilityLabel="Vacation mode">
                            <View style={styles.statusTop}>
                                <IconTile icon="Vacation" tone="success" size={40} />
                                <View style={styles.statusText}>
                                    <ThemedText weight="strong">On vacation</ThemedText>
                                    <ThemedText size="small" color="muted" tabular>
                                        Blocks are paused until {shortDate(fromDateKey(vacation.end), now)}
                                    </ThemedText>
                                </View>
                                <Badge label={vacationRangeLabel(vacation, now)} tone="success" />
                            </View>
                        </Card>
                    ) : (
                        <Card highlight={protectionOn === false ? theme.colors.primaryRed : undefined}>
                            <View style={styles.statusTop}>
                                <IconTile
                                    icon={protectionOn === false ? 'ShieldOff' : 'Shield'}
                                    tone={protectionOn === false ? 'danger' : 'accent'}
                                    size={40}
                                />
                                <View style={styles.statusText}>
                                    <ThemedText weight="strong">
                                        {protectionOn === false ? 'Protection is off' : 'Protection is on'}
                                    </ThemedText>
                                    <ThemedText size="small" color="muted" tabular>
                                        {activeCount} of {entries.length} block{entries.length === 1 ? '' : 's'} active
                                        now
                                    </ThemedText>
                                </View>
                                {protectionOn !== null && (
                                    <Badge
                                        label={protectionOn ? 'Active' : 'Off'}
                                        tone={protectionOn ? 'success' : 'danger'}
                                        dot
                                    />
                                )}
                            </View>
                            {protectionOn === false && (
                                <Button
                                    label="Turn protection on"
                                    compact
                                    onPress={openAccessibilitySettings}
                                    style={styles.statusButton}
                                />
                            )}
                        </Card>
                    )}
                </FadeIn>

                {/* ---- Block list ---- */}
                <SectionHeader
                    title={`Block list · ${visible.length}`}
                    right={
                        visible.length > 0 && (
                            <Button
                                label="Add block"
                                icon="Plus"
                                iconLeading
                                variant="ghost"
                                compact
                                onPress={goToAdd}
                                style={styles.headerButton}
                            />
                        )
                    }
                />
                {!listLoaded ? null : visible.length === 0 ? (
                    <EmptyState
                        icon="Ban"
                        title="Nothing blocked yet"
                        text="Add the websites and apps that take your time. Block them all day or only during the hours you choose.">
                        <Button label="Add a block" icon="Plus" iconLeading onPress={goToAdd} />
                    </EmptyState>
                ) : (
                    <>
                        {visible.length > SEARCH_THRESHOLD && (
                            <View style={styles.search}>
                                <SearchBar
                                    placeholder="Search your list"
                                    keyboardType="default"
                                    onSearch={q => {
                                        animateLayout();
                                        setQuery(q);
                                    }}
                                />
                            </View>
                        )}
                        {filtered.length > 0 ? (
                            <ListGroup>
                                {filtered.map(entry => (
                                    <BlockRow
                                        key={`${entry.kind}:${entry.key}`}
                                        entry={entry}
                                        active={onSchedule(entry)}
                                        used={usedOf(entry)}
                                        onHide={() => setDialog({ kind: 'hide', entry })}
                                        onRemove={() => setDialog({ kind: 'remove', entry })}
                                    />
                                ))}
                            </ListGroup>
                        ) : (
                            <ThemedText color="muted" align="center" style={styles.noMatches}>
                                No blocks match “{query}”
                            </ThemedText>
                        )}
                    </>
                )}
            </ScrollView>

            <Dialog
                visible={dialog?.kind === 'remove'}
                onClose={close}
                icon="Trash"
                tone="danger"
                title="Remove this block?"
                message={`${dialog?.kind === 'remove' ? dialog.entry.label : ''} will no longer be blocked.`}
                actions={confirmActions(
                    close,
                    'Remove',
                    async () => {
                        if (dialog?.kind === 'remove') {
                            await confirmRemove(dialog.entry);
                        }
                    },
                    true,
                )}
            />
            <Dialog
                visible={dialog?.kind === 'hide'}
                onClose={close}
                icon="Hide"
                title={`Hide ${dialog?.kind === 'hide' ? dialog.entry.label : ''}?`}
                message={
                    <View>
                        <ThemedText color="muted">It stays blocked but no longer appears in this list.</ThemedText>
                        <ThemedText size="small" weight="medium" color="primaryRed" style={styles.warning}>
                            A hidden block can only be removed by clearing {APP_NAME}'s data in your phone's settings.
                        </ThemedText>
                    </View>
                }
                actions={confirmActions(close, 'Hide', async () => {
                    if (dialog?.kind === 'hide') {
                        await apply(hide, dialog.entry);
                    }
                })}
            />
            <PassphrasePopup
                visible={dialog?.kind === 'passphrase'}
                onClose={close}
                onConfirm={() => dialog?.kind === 'passphrase' && apply(remove, dialog.entry)}
            />
            <ErrorPopup
                title={dialog?.kind === 'error' ? dialog.title : ''}
                text={dialog?.kind === 'error' ? dialog.text : ''}
                visible={dialog?.kind === 'error'}
                onClose={close}
            />
        </BaseScreen>
    );
};

interface BlockRowProps {
    entry: BlockEntry;
    /** Its schedule is on now. */
    active: boolean;
    /** Minutes used today, for a block with a daily limit. */
    used: number;
    onHide: () => void;
    onRemove: () => void;
}

const BlockRow: React.FC<BlockRowProps> = ({ entry, active, used, onHide, onRemove }) => {
    const { limit } = entry;
    const usedUp = !!limit && used >= limit;
    const badge: { label: string; tone: BadgeTone } = !active
        ? { label: 'Paused', tone: 'neutral' }
        : !limit
        ? { label: 'Active', tone: 'success' }
        : usedUp
        ? { label: 'Used up', tone: 'danger' }
        : { label: `${limit - used} min left`, tone: 'accent' };
    const detail =
        limit && active
            ? `${describeMinutes(Math.min(used, limit))} of ${describeMinutes(limit)} used today`
            : describeSchedule(entry.days, entry.time, limit);
    return (
        <View style={styles.row}>
            <IconTile size={36}>
                {entry.kind === 'app' ? (
                    <AppIcon packageName={entry.key} size={24} />
                ) : (
                    <Favicon url={entry.label} size={20} />
                )}
            </IconTile>
            <View style={styles.rowText}>
                <ThemedText weight="medium" numberOfLines={1}>
                    {entry.label}
                </ThemedText>
                <ThemedText size="small" color="muted" numberOfLines={1}>
                    {detail}
                </ThemedText>
            </View>
            <Badge label={badge.label} tone={badge.tone} style={styles.rowBadge} />
            <IconButton icon="Hide" size={34} accessibilityLabel={`Hide ${entry.label}`} onPress={onHide} />
            <IconButton icon="Trash" size={34} accessibilityLabel={`Remove ${entry.label}`} onPress={onRemove} />
        </View>
    );
};

const styles = StyleSheet.create({
    scroll: {
        paddingBottom: spacing.xl,
    },
    statusTop: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    statusText: {
        flex: 1,
        marginHorizontal: spacing.sm + 2,
    },
    statusButton: {
        marginTop: spacing.md,
    },
    headerButton: {
        marginVertical: -8,
        marginRight: -spacing.sm,
    },
    search: {
        marginHorizontal: gutter,
        marginBottom: spacing.sm,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingLeft: spacing.md,
        paddingRight: spacing.xs,
    },
    rowText: {
        flex: 1,
        marginHorizontal: spacing.sm + 2,
    },
    rowBadge: {
        alignSelf: 'center',
        marginRight: 2,
    },
    noMatches: {
        marginTop: spacing.lg,
    },
    warning: {
        marginTop: spacing.sm,
    },
});

export default BlockListScreen;
