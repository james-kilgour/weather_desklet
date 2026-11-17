const Desklet = imports.ui.desklet;
const St = imports.gi.St;
const Mainloop = imports.mainloop;
const Util = imports.misc.util;
const Settings = imports.ui.settings;

// WMO weather codes (Open-Meteo) -> emoji. isDay switches sun/moon variants.
function icon(code, isDay) {
    if (code === 0) return isDay ? "☀️" : "🌙";
    if (code === 1) return isDay ? "🌤️" : "🌙";
    if (code === 2) return isDay ? "⛅" : "☁️";
    if (code === 3) return "☁️";
    if (code === 45 || code === 48) return "🌫️";
    if (code >= 51 && code <= 57) return "🌦️";
    if (code >= 61 && code <= 67) return "🌧️";
    if (code >= 71 && code <= 77) return "❄️";
    if (code >= 80 && code <= 82) return "🌦️";
    if (code === 85 || code === 86) return "🌨️";
    if (code >= 95) return "⛈️";
    return "❓";
}

// ---- Theme -------------------------------------------------------------
const TEXT   = "color: #f2f4fa;";
const DIM    = "color: rgba(242,244,250,0.60);";
const RAIN   = "color: #8ecbff;";
const SUN    = "color: #ffd88a;";
const SUNSET = "color: #ffab91;";

const CARD_STYLE =
    "padding: 16px; spacing: 12px; min-width: 360px; border-radius: 20px; " +
    "background-color: rgba(34,44,78,0.92); " +
    "background-gradient-direction: vertical; " +
    "background-gradient-start: rgba(40,54,96,0.92); " +
    "background-gradient-end: rgba(58,42,92,0.92); " +
    "border: 1px solid rgba(255,255,255,0.12); " +
    "box-shadow: 0 6px 18px rgba(0,0,0,0.35);";

const HOUR_CELL =
    "spacing: 3px; padding: 8px 6px; min-width: 46px; border-radius: 14px; " +
    "background-color: rgba(255,255,255,0.07);";
const HOUR_CELL_NOW =
    "spacing: 3px; padding: 8px 6px; min-width: 46px; border-radius: 14px; " +
    "background-color: rgba(142,203,255,0.18); " +
    "border: 1px solid rgba(142,203,255,0.45);";

const DAY_ROW =
    "spacing: 10px; padding: 8px 12px; border-radius: 14px; " +
    "background-color: rgba(255,255,255,0.06);";
// -------------------------------------------------------------------------

function label(text, style) {
    return new St.Label({ text: text, style: style || TEXT });
}

function MyDesklet(metadata, desklet_id) {
    this._init(metadata, desklet_id);
}

MyDesklet.prototype = {
    __proto__: Desklet.Desklet.prototype,

    _init: function(metadata, desklet_id) {
        Desklet.Desklet.prototype._init.call(this, metadata, desklet_id);

        this.settings = new Settings.DeskletSettings(this, metadata.uuid, desklet_id);
        this.settings.bindProperty(Settings.BindingDirection.IN,
            "latitude", "latitude", () => this._refresh(), null);
        this.settings.bindProperty(Settings.BindingDirection.IN,
            "longitude", "longitude", () => this._refresh(), null);

        this.box = new St.BoxLayout({ vertical: true, style: CARD_STYLE });
        this.setContent(this.box);
        this._show("Loading...");

        this._refresh();
        this._timeout = Mainloop.timeout_add_seconds(1800, () => {
            this._refresh();
            return true;  // keep repeating
        });
    },

    _show: function(text) {
        this.box.destroy_all_children();
        this.box.add_actor(label(text));
    },

    _refresh: function() {
        // parseFloat guards against shell injection via the settings fields
        let lat = parseFloat(this.latitude);
        let lon = parseFloat(this.longitude);
        if (isNaN(lat) || isNaN(lon)) {
            this._show("Invalid coordinates");
            return;
        }

        let url = "https://api.open-meteo.com/v1/forecast" +
            "?latitude=" + lat + "&longitude=" + lon +
            "&hourly=temperature_2m,precipitation_probability,weather_code,is_day" +
            "&daily=weather_code,temperature_2m_max,temperature_2m_min," +
            "precipitation_probability_max,sunrise,sunset" +
            "&timezone=auto&forecast_days=3&forecast_hours=6";

        Util.spawnCommandLineAsyncIO("curl -s --max-time 15 '" + url + "'",
            (stdout, stderr, exitCode) => {
                if (exitCode !== 0 || !stdout) {
                    this._show("Fetch failed");
                    return;
                }
                try {
                    let data = JSON.parse(stdout);
                    this._render(data.hourly, data.daily);
                } catch (e) {
                    global.logError("sunweather: " + e);
                    this._show("Parse error");
                }
            });
    },

    _render: function(h, d) {
        this.box.destroy_all_children();

        // Header: today's sunrise / sunset
        let header = new St.BoxLayout({ style: "spacing: 20px; padding: 0 4px;" });
        header.add_actor(label("🌅  " + d.sunrise[0].slice(11, 16),
            SUN + " font-size: 13pt; font-weight: bold;"));
        header.add_actor(label("🌇  " + d.sunset[0].slice(11, 16),
            SUNSET + " font-size: 13pt; font-weight: bold;"));
        this.box.add_actor(header);

        // Next 6 hours: one card per hour; first one highlighted
        let hourly = new St.BoxLayout({ style: "spacing: 8px;" });
        for (let i = 0; i < h.time.length; i++) {
            let col = new St.BoxLayout({
                vertical: true,
                style: i === 0 ? HOUR_CELL_NOW : HOUR_CELL
            });
            col.add_actor(label(h.time[i].slice(11, 16), DIM + " font-size: 9pt;"));
            col.add_actor(label(icon(h.weather_code[i], h.is_day[i] === 1),
                "font-size: 18pt;"));
            col.add_actor(label(Math.round(h.temperature_2m[i]) + "°",
                TEXT + " font-size: 13pt; font-weight: bold;"));
            col.add_actor(label("💧" + h.precipitation_probability[i] + "%",
                RAIN + " font-size: 9pt;"));
            hourly.add_actor(col);
        }
        this.box.add_actor(hourly);

        // Next 2 days (indices 1 and 2; index 0 is today)
        for (let i = 1; i < d.time.length; i++) {
            let day = new Date(d.time[i] + "T00:00:00")
                .toLocaleDateString(undefined, { weekday: "short" });
            let row = new St.BoxLayout({ style: DAY_ROW });
            row.add_actor(label(day, TEXT + " font-size: 11pt; font-weight: bold; min-width: 40px;"));
            row.add_actor(label(icon(d.weather_code[i], true), "font-size: 15pt;"));
            row.add_actor(label(Math.round(d.temperature_2m_min[i]) + "° / " +
                Math.round(d.temperature_2m_max[i]) + "°",
                TEXT + " font-size: 11pt; min-width: 70px;"));
            row.add_actor(label("💧" + d.precipitation_probability_max[i] + "%",
                RAIN + " font-size: 10pt; min-width: 55px;"));
            row.add_actor(label("🌅" + d.sunrise[i].slice(11, 16) +
                "  🌇" + d.sunset[i].slice(11, 16), DIM + " font-size: 9pt;"));
            this.box.add_actor(row);
        }
    },

    on_desklet_removed: function() {
        if (this._timeout) Mainloop.source_remove(this._timeout);
        this.settings.finalize();
    }
};

function main(metadata, desklet_id) {
    return new MyDesklet(metadata, desklet_id);
}
