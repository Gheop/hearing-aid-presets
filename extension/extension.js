// Hearing Aid Presets: a top bar indicator while an LE Audio hearing aid that
// exposes the Hearing Access Service (HAS, 0x1854) is connected, with a menu
// to switch its programs. Everything goes through the GATT objects BlueZ
// exports on D-Bus: no daemon, no HAP client needed in BlueZ.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const BLUEZ = 'org.bluez';
const IFACE_DEVICE = 'org.bluez.Device1';
const IFACE_SERVICE = 'org.bluez.GattService1';
const IFACE_CHAR = 'org.bluez.GattCharacteristic1';

const UUID_HAS = '00001854-0000-1000-8000-00805f9b34fb';
const UUID_FEATURES = '00002bda-0000-1000-8000-00805f9b34fb';
const UUID_CONTROL_POINT = '00002bdb-0000-1000-8000-00805f9b34fb';
const UUID_ACTIVE_INDEX = '00002bdc-0000-1000-8000-00805f9b34fb';
const UUID_DIS = '0000180a-0000-1000-8000-00805f9b34fb';
const UUID_MANUFACTURER = '00002a29-0000-1000-8000-00805f9b34fb';
const UUID_MODEL = '00002a24-0000-1000-8000-00805f9b34fb';

// HAP 1.0, section 3.2.2
const OP_READ_PRESETS = 0x01;
const OP_READ_PRESET_RESPONSE = 0x02;
const OP_PRESET_CHANGED = 0x03;
const OP_SET_ACTIVE = 0x05;
const OP_SET_ACTIVE_SYNC = 0x08;

const FEATURE_PRESET_SYNC = 0x04;
const PROP_AVAILABLE = 0x02;

// Hearing aids report an internal model code ("VI960S-DRWC"), not the retail
// name. Known prefixes; anything else is shown as is.
const MODEL_FAMILIES = {
    VI: 'Vivia',
};

function friendlyModel(model) {
    const m = /^([A-Z]{2})(\d{3})/.exec(model);
    if (m && MODEL_FAMILIES[m[1]])
        return `${MODEL_FAMILIES[m[1]]} ${m[2]}`;
    return model;
}

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
        this._section.addMenuItem(new PopupMenu.PopupMenuItem(_('Reading programs…'), { reactive: false }));
    }

    setPresets(presets, active) {
        this._section.removeAll();
        this._items.clear();
        if (presets.size === 0) {
            this._section.addMenuItem(new PopupMenu.PopupMenuItem(_('No programs'), { reactive: false }));
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

    setAlias(alias) {
        this._header.label.text = alias;
    }
});

// The hearing aid we drive: the first connected one whose three HAS
// characteristics are exported. Presets are synchronised between ears
// (Preset Synchronization feature bit), so driving one aid is enough.
class HearingDevice {
    constructor(manager, path, deviceProxy, chars) {
        this._manager = manager;
        this.path = path;
        this._deviceProxy = deviceProxy;
        this._cp = chars.controlPoint;
        this._activeChar = chars.activeIndex;
        this._featuresChar = chars.features;
        this._manufacturerChar = chars.manufacturer || null;
        this._modelChar = chars.model || null;
        this.displayName = null;
        this.presets = new Map();
        this.active = null;
        this.features = 0;
        this._signals = [];
        this._pendingRead = null;
        this._readTimeout = 0;
    }

    get alias() {
        return this.displayName ||
            propString(this._deviceProxy, 'Alias') ||
            propString(this._deviceProxy, 'Name') || _('Hearing aid');
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
            console.warn(`hearing-aid-presets: cannot read Features (${e.message})`);
        }
        try {
            await callSimple(this._cp, 'StartNotify');
            await callSimple(this._activeChar, 'StartNotify');
        } catch (e) {
            // Another client already subscribed, or the aid is going away:
            // carry on, direct reads still work.
            console.warn(`hearing-aid-presets: StartNotify (${e.message})`);
        }
        try {
            const [active] = await readValue(this._activeChar);
            this.active = active;
        } catch (e) {
            console.warn(`hearing-aid-presets: cannot read Active Preset Index (${e.message})`);
        }
        await this.readPresets();
        await this._readDisplayName();
    }

    // Manufacturer + model from the Device Information Service, when present.
    async _readDisplayName() {
        const parts = [];
        for (const proxy of [this._manufacturerChar, this._modelChar]) {
            if (!proxy)
                continue;
            try {
                const bytes = await readValue(proxy);
                const text = new TextDecoder().decode(new Uint8Array(bytes)).trim();
                if (text)
                    parts.push(proxy === this._modelChar ? friendlyModel(text) : text);
            } catch (e) {
                console.warn(`hearing-aid-presets: cannot read Device Information (${e.message})`);
            }
        }
        if (parts.length > 0) {
            this.displayName = parts.join(' ');
            console.log(`hearing-aid-presets: model ${this.displayName}`);
            this._manager.onAliasChanged(this);
        }
    }

    readPresets() {
        if (this._pendingRead)
            return this._pendingRead;
        this._collected = new Map();
        this._pendingRead = new Promise(resolve => {
            this._resolveRead = resolve;
            // The aid answers with one indication per preset; if the last one
            // never shows up, deliver what we have after 5 s.
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
        console.log(`hearing-aid-presets: ${this.alias}: ${this.presets.size} programs, active ${this.active}`);
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
            // The list changed on the aid (phone app, audiologist): re-read
            // everything rather than applying the delta.
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
        // 0x08 = Set Active Preset, Synchronized Locally: the aid forwards it
        // to the other ear. ReSound Vivia refuse 0x05 (ATT 0x80); aids without
        // synchronisation refuse 0x08, hence the fallback.
        const first = (this.features & FEATURE_PRESET_SYNC) ? OP_SET_ACTIVE_SYNC : OP_SET_ACTIVE;
        const second = first === OP_SET_ACTIVE_SYNC ? OP_SET_ACTIVE : OP_SET_ACTIVE_SYNC;
        try {
            await writeValue(this._cp, [first, index]);
        } catch (e) {
            try {
                await writeValue(this._cp, [second, index]);
            } catch (e2) {
                console.warn(`hearing-aid-presets: program change refused (${e2.message})`);
                Main.notify(_('Hearing aids'), _('The hearing aid refused the program change.'));
            }
        }
    }

    stop() {
        for (const [proxy, id] of this._signals)
            proxy.disconnect(id);
        this._signals = [];
        if (this._readTimeout) {
            GLib.source_remove(this._readTimeout);
            this._readTimeout = 0;
        }
        this._pendingRead = null;
        for (const proxy of [this._cp, this._activeChar]) {
            proxy.call('StopNotify', null, Gio.DBusCallFlags.NONE, -1, null, (p, res) => {
                try {
                    p.call_finish(res);
                } catch (e) {
                    // The aid is usually gone already at this point.
                }
            });
        }
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
                    console.error(`hearing-aid-presets: cannot reach BlueZ (${e.message})`);
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

    // BlueZ adds GATT objects one by one; wait for the burst to settle.
    _scheduleRescan() {
        if (this._rescanId)
            GLib.source_remove(this._rescanId);
        this._rescanId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._rescanId = 0;
            this._rescan();
            return GLib.SOURCE_REMOVE;
        });
    }

    _connectedDevice(devicePath) {
        const obj = this._manager.get_object(devicePath);
        const dev = obj && obj.get_interface(IFACE_DEVICE);
        if (!dev)
            return null;
        const connected = dev.get_cached_property('Connected');
        return connected && connected.deepUnpack() ? dev : null;
    }

    _findDevices() {
        const services = new Map();   // service path -> uuid (HAS or DIS)
        const chars = new Map();      // device path -> { controlPoint, activeIndex, features, manufacturer, model }
        const objects = this._manager.get_objects();
        for (const obj of objects) {
            const service = obj.get_interface(IFACE_SERVICE);
            if (!service)
                continue;
            const uuid = propString(service, 'UUID');
            if (uuid === UUID_HAS || uuid === UUID_DIS)
                services.set(obj.get_object_path(), uuid);
        }
        for (const obj of objects) {
            const ch = obj.get_interface(IFACE_CHAR);
            if (!ch)
                continue;
            const servicePath = propString(ch, 'Service');
            if (!services.has(servicePath))
                continue;
            const devicePath = servicePath.replace(/\/service[0-9a-f]+$/, '');
            const entry = chars.get(devicePath) || {};
            switch (propString(ch, 'UUID')) {
            case UUID_CONTROL_POINT: entry.controlPoint = ch; break;
            case UUID_ACTIVE_INDEX: entry.activeIndex = ch; break;
            case UUID_FEATURES: entry.features = ch; break;
            case UUID_MANUFACTURER: entry.manufacturer = ch; break;
            case UUID_MODEL: entry.model = ch; break;
            }
            chars.set(devicePath, entry);
        }
        const usable = [];
        for (const [path, entry] of chars) {
            if (!entry.controlPoint || !entry.activeIndex || !entry.features)
                continue;
            const dev = this._connectedDevice(path);
            if (dev)
                usable.push({ path, dev, chars: entry });
        }
        return usable;
    }

    _rescan() {
        if (!this._manager)
            return;
        const usable = this._findDevices();
        if (this._device) {
            if (usable.some(u => u.path === this._device.path))
                return;
            this._dropDevice();
        }
        if (usable.length === 0)
            return;
        const { path, dev, chars } = usable[0];
        this._device = new HearingDevice(this, path, dev, chars);
        this._indicator = new Indicator(this, this._device);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        console.log(`hearing-aid-presets: indicator created for ${path}`);
        this._device.start().catch(e =>
            console.error(`hearing-aid-presets: start (${e.message})`));
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

    onAliasChanged(device) {
        if (this._indicator && device === this._device)
            this._indicator.setAlias(device.alias);
    }
}
