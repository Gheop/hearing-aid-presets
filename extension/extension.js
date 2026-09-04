// Hearing Aid Presets : icône dans la barre quand une aide auditive LE Audio
// exposant le Hearing Access Service (HAS, 0x1854) est connectée, menu pour
// changer de programme et couper les micros (Microphone Control Service,
// 0x184d). Tout passe par le GATT que BlueZ exporte sur D-Bus, aucun démon.
//
// Prérequis : bluetoothd lancé avec --noplugin=micp, sinon BlueZ réserve la
// caractéristique Mute pour son plugin interne et refuse l'écriture
// (« Operation Not Authorized »).

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const BLUEZ = 'org.bluez';
const IFACE_DEVICE = 'org.bluez.Device1';
const IFACE_SERVICE = 'org.bluez.GattService1';
const IFACE_CHAR = 'org.bluez.GattCharacteristic1';

const UUID_HAS = '00001854-0000-1000-8000-00805f9b34fb';
const UUID_FEATURES = '00002bda-0000-1000-8000-00805f9b34fb';
const UUID_CONTROL_POINT = '00002bdb-0000-1000-8000-00805f9b34fb';
const UUID_ACTIVE_INDEX = '00002bdc-0000-1000-8000-00805f9b34fb';
const UUID_MICS = '0000184d-0000-1000-8000-00805f9b34fb';
const UUID_MUTE = '00002bc3-0000-1000-8000-00805f9b34fb';

// Opcodes HAP 1.0, section 3.2.2
const OP_READ_PRESETS = 0x01;
const OP_READ_PRESET_RESPONSE = 0x02;
const OP_PRESET_CHANGED = 0x03;
const OP_SET_ACTIVE = 0x05;
const OP_SET_ACTIVE_SYNC = 0x08;

const FEATURE_PRESET_SYNC = 0x04;
const PROP_AVAILABLE = 0x02;

// MICS Mute : 0 actif, 1 coupé, 2 mute non disponible
const MUTE_OFF = 0;
const MUTE_ON = 1;
const MUTE_DISABLED = 2;

function readValue(proxy) {
    return new Promise((resolve, reject) => {
        proxy.call('ReadValue', new GLib.Variant('(a{sv})', [{}]),
            Gio.DBusCallFlags.NONE, -1, null, (p, res) => {
                try {
                    const [bytes] = p.call_finish(res).deepUnpack();
                    resolve(Array.from(bytes));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

function writeValue(proxy, bytes) {
    return new Promise((resolve, reject) => {
        proxy.call('WriteValue', new GLib.Variant('(aya{sv})', [bytes, {}]),
            Gio.DBusCallFlags.NONE, -1, null, (p, res) => {
                try {
                    p.call_finish(res);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
    });
}

function callSimple(proxy, method) {
    return new Promise((resolve, reject) => {
        proxy.call(method, null, Gio.DBusCallFlags.NONE, -1, null, (p, res) => {
            try {
                p.call_finish(res);
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

function propString(proxy, name) {
    const v = proxy.get_cached_property(name);
    return v ? v.deepUnpack() : null;
}

function valueBytes(changed) {
    const props = changed.deepUnpack();
    return props.Value ? Array.from(props.Value.deepUnpack()) : null;
}

const Indicator = GObject.registerClass(
class HearingAidIndicator extends PanelMenu.Button {
    _init(extension, device) {
        super._init(0.0, 'Hearing Aid Presets');
        this._device = device;
        this._items = new Map();
        this._updatingSwitch = false;

        const iconPath = `${extension.path}/icons/hearing-aid-symbolic.svg`;
        this.add_child(new St.Icon({
            gicon: Gio.icon_new_for_string(iconPath),
            style_class: 'system-status-icon',
        }));

        this._header = new PopupMenu.PopupMenuItem(device.alias, { reactive: false });
        this._header.label.add_style_class_name('popup-subtitle-menu-item');
        this.menu.addMenuItem(this._header);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._section);
        this._section.addMenuItem(new PopupMenu.PopupMenuItem('Lecture des programmes…', { reactive: false }));

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._micSwitch = new PopupMenu.PopupSwitchMenuItem('Micro vers le PC', true);
        this._micSwitch.connect('toggled', (item, state) => {
            if (!this._updatingSwitch)
                this._device.setMuted(!state);
        });
        this.menu.addMenuItem(this._micSwitch);
        this.setMute(device.mute);
    }

    setPresets(presets, active) {
        this._section.removeAll();
        this._items.clear();
        if (presets.size === 0) {
            this._section.addMenuItem(new PopupMenu.PopupMenuItem('Aucun programme', { reactive: false }));
            return;
        }
        const sorted = [...presets.entries()].sort((a, b) => a[0] - b[0]);
        for (const [index, preset] of sorted) {
            const item = new PopupMenu.PopupMenuItem(preset.name);
            item.setSensitive(preset.available);
            item.setOrnament(index === active
                ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
            item.connect('activate', () => this._device.setActive(index));
            this._section.addMenuItem(item);
            this._items.set(index, item);
        }
    }

    setActive(active) {
        for (const [index, item] of this._items) {
            item.setOrnament(index === active
                ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        }
    }

    // mute : null si aucune aide ne l'expose, sinon MUTE_OFF / MUTE_ON / MUTE_DISABLED
    setMute(mute) {
        this._updatingSwitch = true;
        this._micSwitch.visible = mute !== null;
        this._micSwitch.setSensitive(mute !== MUTE_DISABLED);
        this._micSwitch.setToggleState(mute !== MUTE_ON);
        this._updatingSwitch = false;
    }

    setAlias(alias) {
        this._header.label.text = alias;
    }
});

// L'aide auditive « pilote » : la première connectée dont les trois
// caractéristiques HAS sont exportées. Les presets étant synchronisés entre
// les deux oreilles (bit Preset Synchronization), en piloter une suffit.
// Le mute micro, lui, n'est pas synchronisé : on écrit sur toutes les aides
// connectées qui l'exposent.
class HearingDevice {
    constructor(manager, path, deviceProxy, chars) {
        this._manager = manager;
        this.path = path;
        this._deviceProxy = deviceProxy;
        this._cp = chars.controlPoint;
        this._activeChar = chars.activeIndex;
        this._featuresChar = chars.features;
        this.presets = new Map();
        this.active = null;
        this.features = 0;
        this.mute = null;
        this._signals = [];
        this._muteChars = new Map();   // proxy -> { signal, value }
        this._pendingRead = null;
        this._readTimeout = 0;
    }

    get alias() {
        return propString(this._deviceProxy, 'Alias') ||
            propString(this._deviceProxy, 'Name') || 'Aide auditive';
    }

    async start() {
        this._signals.push([this._cp, this._cp.connect('g-properties-changed',
            (p, changed) => this._onControlPoint(changed))]);
        this._signals.push([this._activeChar, this._activeChar.connect('g-properties-changed',
            (p, changed) => this._onActiveChanged(changed))]);

        try {
            const [features] = await readValue(this._featuresChar);
            this.features = features;
        } catch (e) {
            console.warn(`hearing-aid-presets: lecture Features impossible (${e.message})`);
        }
        try {
            await callSimple(this._cp, 'StartNotify');
            await callSimple(this._activeChar, 'StartNotify');
        } catch (e) {
            // Déjà notifié par un autre client, ou aide en train de partir :
            // on continue, les lectures directes marchent quand même.
            console.warn(`hearing-aid-presets: StartNotify (${e.message})`);
        }
        try {
            const [active] = await readValue(this._activeChar);
            this.active = active;
        } catch (e) {
            console.warn(`hearing-aid-presets: lecture Active Preset Index (${e.message})`);
        }
        await this.readPresets();
    }

    // Appelé à chaque rescan : les aides arrivent l'une après l'autre.
    async setMuteChars(proxies) {
        const wanted = new Set(proxies.map(p => p.get_object_path()));
        for (const [proxy, entry] of [...this._muteChars]) {
            if (wanted.has(proxy.get_object_path()))
                continue;
            proxy.disconnect(entry.signal);
            this._muteChars.delete(proxy);
        }
        for (const proxy of proxies) {
            if ([...this._muteChars.keys()].some(p => p.get_object_path() === proxy.get_object_path()))
                continue;
            const signal = proxy.connect('g-properties-changed', (p, changed) => {
                const bytes = valueBytes(changed);
                if (!bytes)
                    return;
                const entry = this._muteChars.get(p);
                if (entry) {
                    entry.value = bytes[0];
                    this._updateMute();
                }
            });
            const entry = { signal, value: null };
            this._muteChars.set(proxy, entry);
            try {
                await callSimple(proxy, 'StartNotify');
            } catch (e) {
                console.warn(`hearing-aid-presets: StartNotify Mute (${e.message})`);
            }
            try {
                [entry.value] = await readValue(proxy);
            } catch (e) {
                console.warn(`hearing-aid-presets: lecture Mute (${e.message})`);
            }
        }
        this._updateMute();
    }

    _updateMute() {
        const values = [...this._muteChars.values()].map(e => e.value).filter(v => v !== null);
        let mute;
        if (values.length === 0)
            mute = null;
        else if (values.every(v => v === MUTE_DISABLED))
            mute = MUTE_DISABLED;
        else if (values.some(v => v === MUTE_ON))
            mute = MUTE_ON;    // une oreille coupée suffit à afficher « coupé »
        else
            mute = MUTE_OFF;
        if (mute !== this.mute) {
            this.mute = mute;
            this._manager.onMuteChanged(this);
        }
    }

    async setMuted(muted) {
        const value = muted ? MUTE_ON : MUTE_OFF;
        const results = await Promise.allSettled(
            [...this._muteChars.keys()].map(proxy => writeValue(proxy, [value])));
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length > 0) {
            console.warn(`hearing-aid-presets: mute refusé (${failed[0].reason.message})`);
            Main.notify('Aides auditives',
                'Impossible de changer les micros. bluetoothd tourne-t-il avec --noplugin=micp ?');
            this._manager.onMuteChanged(this);   // remet l'interrupteur dans l'état réel
        }
    }

    readPresets() {
        if (this._pendingRead)
            return this._pendingRead;
        this._collected = new Map();
        this._pendingRead = new Promise(resolve => {
            this._resolveRead = resolve;
            // L'aide répond par une indication par preset ; si la dernière
            // n'arrive jamais, on livre ce qu'on a au bout de 5 s.
            this._readTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
                this._readTimeout = 0;
                this._finishRead();
                return GLib.SOURCE_REMOVE;
            });
        });
        writeValue(this._cp, [OP_READ_PRESETS, 0x01, 0xff]).catch(e => {
            console.warn(`hearing-aid-presets: Read Presets Request (${e.message})`);
            this._finishRead();
        });
        return this._pendingRead;
    }

    _finishRead() {
        if (this._readTimeout) {
            GLib.source_remove(this._readTimeout);
            this._readTimeout = 0;
        }
        if (!this._pendingRead)
            return;
        this.presets = this._collected;
        console.log(`hearing-aid-presets: ${this.alias} : ${this.presets.size} programmes, actif ${this.active}`);
        const resolve = this._resolveRead;
        this._pendingRead = null;
        this._resolveRead = null;
        this._manager.onPresetsChanged(this);
        resolve();
    }

    _onControlPoint(changed) {
        const bytes = valueBytes(changed);
        if (!bytes || bytes.length < 4)
            return;
        const opcode = bytes[0];
        if (opcode === OP_READ_PRESET_RESPONSE) {
            const [, isLast, index, properties] = bytes;
            const name = new TextDecoder().decode(new Uint8Array(bytes.slice(4)));
            if (this._collected)
                this._collected.set(index, { name, available: (properties & PROP_AVAILABLE) !== 0 });
            if (isLast)
                this._finishRead();
        } else if (opcode === OP_PRESET_CHANGED) {
            // Liste modifiée sur l'aide (app du téléphone, audioprothésiste) :
            // on relit tout plutôt que d'appliquer le delta.
            if (bytes[2] === 1)
                this.readPresets();
        }
    }

    _onActiveChanged(changed) {
        const bytes = valueBytes(changed);
        if (!bytes)
            return;
        this.active = bytes[0];
        this._manager.onActiveChanged(this);
    }

    async setActive(index) {
        // 0x08 = Set Active Preset, Synchronized Locally : l'aide propage à
        // l'autre oreille. Les Vivia refusent 0x05 (ATT 0x80), d'autres
        // modèles sans synchro refusent 0x08, d'où le repli.
        const first = (this.features & FEATURE_PRESET_SYNC) ? OP_SET_ACTIVE_SYNC : OP_SET_ACTIVE;
        const second = first === OP_SET_ACTIVE_SYNC ? OP_SET_ACTIVE : OP_SET_ACTIVE_SYNC;
        try {
            await writeValue(this._cp, [first, index]);
        } catch (e) {
            try {
                await writeValue(this._cp, [second, index]);
            } catch (e2) {
                console.warn(`hearing-aid-presets: changement de programme refusé (${e2.message})`);
                Main.notify('Aides auditives', 'Changement de programme refusé par l\'aide.');
            }
        }
    }

    stop() {
        for (const [proxy, id] of this._signals)
            proxy.disconnect(id);
        this._signals = [];
        for (const [proxy, entry] of this._muteChars)
            proxy.disconnect(entry.signal);
        if (this._readTimeout) {
            GLib.source_remove(this._readTimeout);
            this._readTimeout = 0;
        }
        this._pendingRead = null;
        for (const proxy of [this._cp, this._activeChar, ...this._muteChars.keys()]) {
            proxy.call('StopNotify', null, Gio.DBusCallFlags.NONE, -1, null, (p, res) => {
                try {
                    p.call_finish(res);
                } catch (e) {
                    // L'aide est souvent déjà partie à ce stade.
                }
            });
        }
        this._muteChars.clear();
    }
}

export default class HearingAidPresetsExtension extends Extension {
    enable() {
        this._indicator = null;
        this._device = null;
        this._cancellable = new Gio.Cancellable();
        this._managerSignals = [];
        this._rescanId = 0;

        Gio.DBusObjectManagerClient.new_for_bus(Gio.BusType.SYSTEM,
            Gio.DBusObjectManagerClientFlags.NONE, BLUEZ, '/', null, this._cancellable,
            (source, res) => {
                try {
                    this._manager = Gio.DBusObjectManagerClient.new_for_bus_finish(res);
                } catch (e) {
                    console.error(`hearing-aid-presets: BlueZ injoignable (${e.message})`);
                    return;
                }
                for (const signal of ['object-added', 'object-removed',
                    'interface-added', 'interface-removed'])
                    this._managerSignals.push(this._manager.connect(signal, () => this._scheduleRescan()));
                this._managerSignals.push(this._manager.connect(
                    'interface-proxy-properties-changed', (m, obj, iface, changed) => {
                        if (iface.get_interface_name() !== IFACE_DEVICE)
                            return;
                        const props = changed.deepUnpack();
                        if ('Connected' in props || 'ServicesResolved' in props)
                            this._scheduleRescan();
                        else if ('Alias' in props && this._indicator &&
                                 this._device && obj.get_object_path() === this._device.path)
                            this._indicator.setAlias(this._device.alias);
                    }));
                this._rescan();
            });
    }

    disable() {
        this._cancellable.cancel();
        if (this._rescanId) {
            GLib.source_remove(this._rescanId);
            this._rescanId = 0;
        }
        if (this._manager) {
            for (const id of this._managerSignals)
                this._manager.disconnect(id);
            this._managerSignals = [];
            this._manager = null;
        }
        this._dropDevice();
    }

    // BlueZ ajoute les objets GATT un par un ; on attend que ça se calme.
    _scheduleRescan() {
        if (this._rescanId)
            GLib.source_remove(this._rescanId);
        this._rescanId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._rescanId = 0;
            this._rescan();
            return GLib.SOURCE_REMOVE;
        });
    }

    _isConnected(devicePath) {
        const obj = this._manager.get_object(devicePath);
        const dev = obj && obj.get_interface(IFACE_DEVICE);
        if (!dev)
            return null;
        const connected = dev.get_cached_property('Connected');
        return connected && connected.deepUnpack() ? dev : null;
    }

    _findDevices() {
        const services = new Map();   // service path -> uuid (HAS ou MICS)
        const hasChars = new Map();   // device path -> { controlPoint, activeIndex, features }
        const muteChars = [];
        const objects = this._manager.get_objects();
        for (const obj of objects) {
            const service = obj.get_interface(IFACE_SERVICE);
            if (!service)
                continue;
            const uuid = propString(service, 'UUID');
            if (uuid === UUID_HAS || uuid === UUID_MICS)
                services.set(obj.get_object_path(), uuid);
        }
        for (const obj of objects) {
            const ch = obj.get_interface(IFACE_CHAR);
            if (!ch)
                continue;
            const servicePath = propString(ch, 'Service');
            const serviceUuid = services.get(servicePath);
            if (!serviceUuid)
                continue;
            const devicePath = servicePath.replace(/\/service[0-9a-f]+$/, '');
            const uuid = propString(ch, 'UUID');
            if (serviceUuid === UUID_MICS) {
                if (uuid === UUID_MUTE && this._isConnected(devicePath))
                    muteChars.push(ch);
                continue;
            }
            const entry = hasChars.get(devicePath) || {};
            switch (uuid) {
            case UUID_CONTROL_POINT: entry.controlPoint = ch; break;
            case UUID_ACTIVE_INDEX: entry.activeIndex = ch; break;
            case UUID_FEATURES: entry.features = ch; break;
            }
            hasChars.set(devicePath, entry);
        }
        const usable = [];
        for (const [path, chars] of hasChars) {
            if (!chars.controlPoint || !chars.activeIndex || !chars.features)
                continue;
            const dev = this._isConnected(path);
            if (dev)
                usable.push({ path, dev, chars });
        }
        return { usable, muteChars };
    }

    _rescan() {
        if (!this._manager)
            return;
        const { usable, muteChars } = this._findDevices();
        if (this._device) {
            if (usable.some(u => u.path === this._device.path)) {
                this._device.setMuteChars(muteChars).catch(e =>
                    console.warn(`hearing-aid-presets: mute (${e.message})`));
                return;
            }
            this._dropDevice();
        }
        if (usable.length === 0)
            return;
        const { path, dev, chars } = usable[0];
        this._device = new HearingDevice(this, path, dev, chars);
        this._indicator = new Indicator(this, this._device);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        console.log(`hearing-aid-presets: indicateur créé pour ${path}, ${muteChars.length} micro(s)`);
        this._device.start().catch(e =>
            console.error(`hearing-aid-presets: démarrage (${e.message})`));
        this._device.setMuteChars(muteChars).catch(e =>
            console.warn(`hearing-aid-presets: mute (${e.message})`));
    }

    _dropDevice() {
        if (this._device) {
            this._device.stop();
            this._device = null;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    onPresetsChanged(device) {
        if (this._indicator && device === this._device)
            this._indicator.setPresets(device.presets, device.active);
    }

    onActiveChanged(device) {
        if (this._indicator && device === this._device)
            this._indicator.setActive(device.active);
    }

    onMuteChanged(device) {
        if (this._indicator && device === this._device) {
            this._indicator.setMute(device.mute);
            console.log(`hearing-aid-presets: micros ${device.mute === MUTE_ON ? 'coupés' : 'actifs'} (${device.mute})`);
        }
    }
}
