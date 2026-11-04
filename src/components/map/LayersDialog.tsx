import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import ModalPanel from '../ModalPanel';
import Icon, { IconName } from '../Icon';
import IconTile from '../IconTile';
import Segmented from '../Segmented';
import { Toggle } from '../ListGroup';
import { ThemedText } from '../ThemedText';
import Button from '../Button';
import ProgressBar from '../ProgressBar';
import { useTheme } from '../../context/ThemeContext';
import { shapes, spacing } from '../../theme';
import { CoordFormat, MapPrefs, MapUnits, OnlineMap } from '../../types/types';
import { MapFile, formatBytes } from '../../utils/mapNative';
import { ONLINE_MAPS, fileBaseId, onlineBaseId } from '../../utils/mapStyle';

const ONLINE_ICONS: Record<string, IconName> = {
    osm: 'Map',
    topo: 'Mountain',
    cycle: 'Bike',
    satellite: 'Satellite',
};

export interface ImportProgress {
    copied: number;
    total: number;
}

/** Base map, what's drawn on top, and the map's units: everything behind the Layers button. */
const LayersDialog: React.FC<{
    visible: boolean;
    onClose: () => void;
    prefs: MapPrefs;
    files: MapFile[];
    onChange: (prefs: MapPrefs) => void;
    onAddFile: () => void;
    onAddOnline: () => void;
    onRemoveOnline: (map: OnlineMap) => void;
    importing: ImportProgress | null;
    onCancelImport: () => void;
}> = ({ visible, onClose, prefs, files, onChange, onAddFile, onAddOnline, onRemoveOnline, importing, onCancelImport }) => {
    const { colors } = useTheme().theme;
    const set = (patch: Partial<MapPrefs>) => onChange({ ...prefs, ...patch });

    const row = (key: string, icon: IconName, title: string, detail: string, onLongPress?: () => void) => {
        const selected = prefs.base === key;
        return (
            <Pressable
                key={key}
                onPress={() => set({ base: key })}
                onLongPress={onLongPress}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.elevated }]}>
                <IconTile icon={icon} size={32} tone={selected ? 'accent' : 'neutral'} />
                <View style={styles.rowText}>
                    <ThemedText weight="medium" numberOfLines={1} color={selected ? 'accent' : 'text'}>
                        {title}
                    </ThemedText>
                    <ThemedText size="small" color="muted" numberOfLines={1}>
                        {detail}
                    </ThemedText>
                </View>
                {selected && <Icon name="Check" size={18} tint={colors.accent} />}
            </Pressable>
        );
    };

    const toggle = (title: string, value: boolean, onValue: (v: boolean) => void, detail?: string) => (
        <View style={styles.toggle}>
            <View style={styles.rowText}>
                <ThemedText weight="medium">{title}</ThemedText>
                {!!detail && (
                    <ThemedText size="small" color="muted">
                        {detail}
                    </ThemedText>
                )}
            </View>
            <Toggle value={value} onValueChange={onValue} />
        </View>
    );

    return (
        <ModalPanel visible={visible} onClose={onClose}>
            <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
                <ThemedText size="large" weight="bold">
                    Map
                </ThemedText>

                <ThemedText size="small" color="muted" weight="medium" style={styles.section}>
                    OFFLINE
                </ThemedText>
                {files.map(f =>
                    row(
                        fileBaseId(f),
                        'Layers',
                        f.name,
                        `${f.kind === 'pmtiles' ? 'PMTiles' : 'MBTiles'} · ${formatBytes(f.size)} · zoom ${f.minZoom}–${f.maxZoom}`,
                    ),
                )}
                {importing ? (
                    <View style={styles.importing}>
                        <ThemedText size="small" color="muted">
                            Copying map{importing.total > 0 ? ` · ${Math.floor((importing.copied / importing.total) * 100)}%` : '…'}
                        </ThemedText>
                        <ProgressBar
                            fraction={importing.total > 0 ? importing.copied / importing.total : 0}
                            style={styles.progress}
                        />
                        <Button label="Cancel" variant="ghost" compact onPress={onCancelImport} />
                    </View>
                ) : (
                    <Pressable
                        onPress={onAddFile}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.elevated }]}>
                        <IconTile icon="Plus" size={32} tone="neutral" />
                        <View style={styles.rowText}>
                            <ThemedText weight="medium">Add map file</ThemedText>
                            <ThemedText size="small" color="muted">
                                MBTiles or PMTiles, works without internet
                            </ThemedText>
                        </View>
                    </Pressable>
                )}

                <ThemedText size="small" color="muted" weight="medium" style={styles.section}>
                    ONLINE
                </ThemedText>
                {ONLINE_MAPS.map(m => row(onlineBaseId(m), ONLINE_ICONS[m.id] ?? 'Globe', m.name, 'Loads as you go, kept for offline'))}
                {prefs.custom.map(m =>
                    row(onlineBaseId(m), 'Globe', m.name, 'Your map · hold to remove', () => onRemoveOnline(m)),
                )}
                <Pressable
                    onPress={onAddOnline}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.elevated }]}>
                    <IconTile icon="Plus" size={32} tone="neutral" />
                    <View style={styles.rowText}>
                        <ThemedText weight="medium">Add online map</ThemedText>
                        <ThemedText size="small" color="muted">
                            A tile URL or a map style link
                        </ThemedText>
                    </View>
                </Pressable>

                <ThemedText size="small" color="muted" weight="medium" style={styles.section}>
                    ON THE MAP
                </ThemedText>
                {toggle('Sea marks', prefs.seamarks, v => set({ seamarks: v }), 'Buoys, lights and harbors (online)')}
                {toggle('Saved places', prefs.showMarks, v => set({ showMarks: v }))}
                {toggle('All tracks', prefs.showTracks, v => set({ showTracks: v }))}
                {toggle('Keep screen on', prefs.keepAwake, v => set({ keepAwake: v }), 'While the map is open')}

                <ThemedText size="small" color="muted" weight="medium" style={styles.section}>
                    UNITS
                </ThemedText>
                <Segmented<MapUnits>
                    options={[
                        { value: 'metric', label: 'km/h' },
                        { value: 'nautical', label: 'knots' },
                        { value: 'imperial', label: 'mph' },
                    ]}
                    value={prefs.units}
                    onChange={units => set({ units })}
                />
                <Segmented<CoordFormat>
                    options={[
                        { value: 'dd', label: '45.1234°' },
                        { value: 'dm', label: '45° 07.4′' },
                        { value: 'dms', label: '45° 07′ 24″' },
                    ]}
                    value={prefs.coords}
                    onChange={coords => set({ coords })}
                    style={styles.segment}
                />
            </ScrollView>
            <Button label="Done" variant="secondary" onPress={onClose} style={styles.done} />
        </ModalPanel>
    );
};

const styles = StyleSheet.create({
    scroll: {
        maxHeight: 520,
    },
    section: {
        marginTop: spacing.lg,
        marginBottom: spacing.xs,
        letterSpacing: 0.6,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.sm - 2,
        paddingHorizontal: spacing.xs,
        borderRadius: shapes.borderRadius.medium,
    },
    rowText: {
        flex: 1,
        marginLeft: spacing.sm + 2,
        marginRight: spacing.sm,
    },
    toggle: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: spacing.sm - 4,
        marginLeft: -spacing.sm + 2,
    },
    importing: {
        paddingVertical: spacing.sm,
    },
    progress: {
        marginVertical: spacing.sm,
    },
    segment: {
        marginTop: spacing.sm,
    },
    done: {
        marginTop: spacing.md,
    },
});

export default LayersDialog;
