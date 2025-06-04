const EventEmitter = require('events');
const ICal = require('node-ical');
const {DateTime, Duration} = require('luxon');

const EXSTOP = 1;
const EXSTART = 2;
const WHSTOP = 3;
const WHSTART = 4;
const MESTART = 5;
const MESTOP = 6;

class WorkingTimeCalculator extends EventEmitter {

    _alive = true;
    _calendars = [];
    _calendarRefreshInterval = 1000*60*60*24; // default 24 hour refresh
    _workingDays = new Map();
    _customExclusions = [];

    constructor(options = {}) {
        super();

        if (options.calendarRefreshInterval !== undefined) {
            const cri = +options.calendarRefreshInterval;
            if (Number.isNaN(cri)) {
                throw Error(`options.calendarRefreshInterval should be a Number`);
            }
            this._calendarRefreshInterval = cri;
        }

        this.debug = options.debug;
        if (this.debug && !(this.debug instanceof Function)) {
            this.debug = console.log.bind(console);
        }
    }

    addWorkingHours(days, startTime, stopTime, timezone = 'UTC') {
        days = [days].flat(Infinity);
        days.forEach(day => {
            let wds = this._workingDays.get(day);
            if (!wds) {
                wds = [];
                this._workingDays.set(day, wds);
            }
            wds.push({
                start: this._timeToUnits(startTime),
                stop: this._timeToUnits(stopTime),
                timezone
            });
        });
    }

    excludeBetween(date1, date2, reason = 'Custom Exclusion') {
        date1 = (date1 instanceof Date) ? DateTime.fromJSDate(date1) : DateTime.fromISO(date1, {setZone: true});
        date2 = (date2 instanceof Date) ? DateTime.fromJSDate(date2) : DateTime.fromISO(date2, {setZone: true});
        this._customExclusions.push({start: date1, end: date2, reason});
    }

    _timeToUnits(time) {
        let [hour, minute, seconds] = time.split(':');
        hour = +hour;
        minute = +minute;
        seconds = +seconds;
        if (Number.isNaN(hour) || Number.isNaN(minute)) {
            throw Error(`Badly formatted time: ${time}`);
        }
        if (Number.isNaN(seconds)) {
            seconds = 0;
        }
        return {hour, minute, seconds, milliseconds: 0};
    }

    _getExclusionMarkers(start, end) {
        const markers = [];

        this._calendars.forEach(cal => {
            cal.events.forEach(evt => {
                if (evt.start < end && evt.end > start) {
                    markers.push({type: EXSTART, at: evt.start, reason: evt.summary + ' Begin'});
                    markers.push({type: EXSTOP, at: evt.end, reason: evt.summary + ' End'});
                }
            });
        });

        this._customExclusions.forEach(ex => {
            if (ex.start < end && ex.end > start) {
                markers.push({type: EXSTART, at: ex.start, reason: ex.reason + ' Begin'});
                markers.push({type: EXSTOP, at: ex.end, reason: ex.reason + ' End'});
            }
        });

        return markers;
    }

    _getWorkingTimeMarkers(start, end) {
        const markers = [];
        let current = start;
        while (true) {
            markers.push(...this._getWorkingTimeMarkersForDate(current));
            if (current.toMillis() > end.toMillis()) {
                break;
            }
            current = current.plus({day: 1});
        }
        return markers;
    }

    _getMarkersBetween(start, end) {
        const markers = [];
        markers.push(...this._getWorkingTimeMarkers(start, end));
        markers.push(...this._getExclusionMarkers(start, end));
        markers.push({type: MESTART, at: start, reason: 'Measurement Begin'});
        markers.push({type: MESTOP, at: end, reason: 'Measurement End'});
        markers.sort((a, b) => {
            const am = a.at.toMillis();
            const bm = b.at.toMillis();
            if (am === bm) return 0;
            return am > bm ? 1 : -1;
        });
        return markers;
    }

    _getWorkingTimeMarkersForDate(date) {
        const markers = [];
        const wds = this._workingDays.get(date.weekday);

        if (wds) {
            wds.forEach(wd => {
                markers.push({type: WHSTART, at: date.setZone(wd.timezone).set(wd.start), reason: 'Working Hours Begin'});
                markers.push({type: WHSTOP, at: date.setZone(wd.timezone).set(wd.stop), reason: 'Working Hours End'});
            });
        }

        return markers;
    }

    calcDurationBetween(date1, date2) {
        date1 = (date1 instanceof Date) ? DateTime.fromJSDate(date1) : DateTime.fromISO(date1, {setZone: true});
        date2 = (date2 instanceof Date) ? DateTime.fromJSDate(date2) : DateTime.fromISO(date2, {setZone: true});

        const startDate = date1 > date2 ? date2 : date1;
        const endDate = date1 > date2 ? date1 : date2;

        const markers = this._getMarkersBetween(startDate, endDate);

        let inWorkingHours = 0;
        let inExclusion = 0;
        let inMeasurement = false;
        let totalDuration = Duration.fromMillis(0);

        for (let i = 0; i < markers.length; i++) {
            const marker = markers[i];
            const prevMarker = markers[i-1];

            if (inMeasurement && inWorkingHours && !inExclusion) {
                totalDuration = totalDuration.plus(marker.at.diff(prevMarker.at));
            }

            switch (marker.type) {
                case WHSTART: inWorkingHours++; break;
                case WHSTOP: inWorkingHours--; break;
                case EXSTART: inExclusion++; break;
                case EXSTOP: inExclusion--; break;
                case MESTART: inMeasurement = true; break;
                case MESTOP: inMeasurement = false; break;
            }

            if (this.debug) {
                this.debug(`${marker.at.setZone('UTC').toISO().padEnd(25)} ${marker.reason} [${totalDuration.toISO()}] W${inWorkingHours} X${inExclusion}`);
            }
        }

        return totalDuration;
    }

    calcMillisecondsBetween(start, end) {
        return this.calcDurationBetween(start, end).as('milliseconds');
    }

    calcSecondsBetween(start, end) {
        return this.calcDurationBetween(start, end).as('seconds');
    }

    calcMinutesBetween(start, end) {
        return this.calcDurationBetween(start, end).as('minutes');
    }

    calcHoursBetween(start, end) {
        return this.calcDurationBetween(start, end).as('hours');
    }

    async excludeCalendarUrl(options) {
        if (typeof options === 'string') {
            options = {url: options};
        }

        const cal = {
            url: options.url.replace(/^webcal(s)?:/i, 'http$1:'),
            filter: options.filter || (()=>true),
            nextRefresh: Date.now() + this._calendarRefreshInterval,
            refreshTimeout: null,
            events: []
        };

        this._calendars.push(cal);
        return await this._refreshCalendar(cal);
    }

    async excludeCalendarFile(options) {
        if (typeof options === 'string') {
            options = {path: options};
        }

        const cal = {
            path: options.path,
            filter: options.filter || (()=>true),
            events: []
        };

        const events = await ICal.async.parseFile(options.path);
        cal.events = this._parseICalEvents(events, cal.filter);
        this._calendars.push(cal);
    }

    dispose() {
        this._alive = false;
        for (const cal of this._calendars) {
            clearTimeout(cal.refreshTimeout);
            cal.refreshTimeout = null;
        }
    }

    _parseICalEvents(events, filter) {
        return Object.values(events).filter(evt => {
            return !!evt.start && !!evt.end;
        }).map(evt => {
            evt.start = DateTime.fromISO(evt.start.toISOString());
            evt.end = DateTime.fromISO(evt.end.toISOString());
            return evt;
        }).filter(filter);
    }

    async _refreshCalendar(cal) {
        const events = await ICal.async.fromURL(cal.url);
        cal.events = this._parseICalEvents(events, cal.filter);
        if (cal.url && this._calendarRefreshInterval > 0 && this._alive) {
            cal.nextRefresh = Date.now() + this._calendarRefreshInterval;
            cal.refreshTimeout = setTimeout(() => {
                this._refreshCalendar(cal).catch(err => this.emit('error', err));
            }, cal.nextRefresh - Date.now());
        }
    }
}

WorkingTimeCalculator.MONDAY = 1;
WorkingTimeCalculator.TUESDAY = 2;
WorkingTimeCalculator.WEDNESDAY = 3;
WorkingTimeCalculator.THURSDAY = 4;
WorkingTimeCalculator.FRIDAY = 5;
WorkingTimeCalculator.SATURDAY = 6;
WorkingTimeCalculator.SUNDAY = 7;

WorkingTimeCalculator.WEEKDAYS = [
    WorkingTimeCalculator.MONDAY,
    WorkingTimeCalculator.TUESDAY,
    WorkingTimeCalculator.WEDNESDAY,
    WorkingTimeCalculator.THURSDAY,
    WorkingTimeCalculator.FRIDAY,
];

WorkingTimeCalculator.WEEKENDS = [
    WorkingTimeCalculator.SUNDAY,
    WorkingTimeCalculator.SATURDAY,
];

module.exports = WorkingTimeCalculator;
