'use strict';

const { Clutter, GLib, GObject, St } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const Me = ExtensionUtils.getCurrentExtension();
const Accumulator = Me.imports.lib.accumulator;
const Counters = Me.imports.lib.counters;
const Format = Me.imports.lib.format;
const Store = Me.imports.lib.store;
const System = Me.imports.lib.system;

const POLL_SECONDS = 30;
const STATE_DIR = 'daily-net-usage-tracker';
const STATE_FILE = 'usage.json';

function statePath() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), STATE_DIR, STATE_FILE]);
}

function today() {
    return GLib.DateTime.new_now_local().format('%Y-%m-%d');
}

const UsageIndicator = GObject.registerClass(
class UsageIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Daily Net Usage', false);

        this._label = new St.Label({
            text: '↕ 0 B',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'dnu-label',
        });
        this.add_child(this._label);

        this._download = this._addRow('Download');
        this._upload = this._addRow('Upload');

        this._statePath = statePath();
        this._accumulator = this._resume();
        this._render();
        this._save();

        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, POLL_SECONDS, () => {
                this._tick();
                return GLib.SOURCE_CONTINUE;
            });
    }

    /* Rebuild the day's totals from the saved state plus whatever the counters
     * say now, crediting traffic that happened while we were not running. */
    _resume() {
        let stored = null;
        let samples = {};
        let bootId = null;
        let bootDate = null;
        try {
            stored = Store.load(this._statePath);
            samples = Counters.sample();
            bootId = System.bootId();
            bootDate = System.bootDate();
        } catch (e) {
            logError(e, 'daily-net-usage-tracker: could not read startup state');
        }
        return Accumulator.Accumulator.resume({
            stored, samples, bootId, bootDate, today: today(),
        });
    }

    _addRow(name) {
        const item = new PopupMenu.PopupMenuItem(name, {
            reactive: false,
            can_focus: false,
        });
        item.label.x_expand = false;
        const value = new St.Label({
            text: '0 B',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'dnu-menu-value',
        });
        item.add_child(value);
        this.menu.addMenuItem(item);
        return value;
    }

    _tick() {
        // Nothing in here may throw: an exception in a shell timer is an
        // exception in the shell's main loop.
        let changed = false;
        try {
            changed = this._accumulator.update(Counters.sample(), today());
        } catch (e) {
            logError(e, 'daily-net-usage-tracker: could not read counters');
        }
        this._render();
        if (changed)
            this._save();
    }

    _render() {
        const { rx, tx, total } = this._accumulator;
        this._label.text = `↕ ${Format.formatBytes(total)}`;
        this._download.text = Format.formatBytes(rx);
        this._upload.text = Format.formatBytes(tx);
    }

    /* Saving every tick rather than on a slower timer keeps the loss from an
     * unclean shutdown down to one poll interval, and the file is ~200 bytes. */
    _save() {
        try {
            Store.save(this._statePath, this._accumulator.toState());
        } catch (e) {
            logError(e, 'daily-net-usage-tracker: could not save usage');
        }
    }

    destroy() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._save();
        super.destroy();
    }
});

class Extension {
    enable() {
        this._indicator = new UsageIndicator();
        Main.panel.addToStatusArea(Me.metadata.uuid, this._indicator, 0, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}

function init() {
    return new Extension();
}
