# Working Time Calculator

Calculates the difference between two dates (& times) within working hours, excluding various exceptions.

## Installation

`$ npm i working-time-calculator`

## Simple Usage Example

```js
const WorkingTimeCalculator = require('working-time-calculator');

const wtc = new WorkingTimeCalculator();

wtc.addWorkingHours(WorkingTimeCalculator.WEEKDAYS, '08:30', '17:30', 'Europe/London');

wtc.calcMinutesBetween('2020-10-02T17:25:00+01:00', '2020-10-05T08:35:00+01:00'); // 10
```

## Advanced Usage Example (Import local calendar file)

```js
const WorkingTimeCalculator = require('working-time-calculator');

const wtc = new WorkingTimeCalculator();

wtc.addWorkingHours(WorkingTimeCalculator.WEEKDAYS, '08:30', '17:30', 'Europe/London');

wtc.calcHoursBetween('2020-08-31T08:30:00+01:00', '2020-09-01T17:30:00+01:00'); // 18

await wtc.excludeCalendarFile({
    path: './uk-public-holidays.ics',
});

wtc.calcHoursBetween('2020-08-31T08:30:00+01:00', '2020-09-01T17:30:00+01:00'); // 9 (Monday 31st was a bank holiday)
```

## Advanced Usage Example (Online calendar + filter)

```js
const WorkingTimeCalculator = require('working-time-calculator');

const wtc = new WorkingTimeCalculator({
    calendarRefreshInterval: 1000*60*60 // 1 hour calendar refresh interval
});

wtc.on('error', err => {
    // Error event handler called when encountering error while retrieving/parsing calendar
    console.error(err);
});

wtc.addWorkingHours([WorkingTimeCalculator.WEEKENDS, WorkingTimeCalculator.MONDAY], '08:30', '17:30', 'Europe/London');

await wtc.excludeCalendarUrl({
    url: 'webcal://......',
    filter: evt => {
        // only for events with description "Public Holiday"
        return evt.description === 'Public Holiday';
    }
});

wtc.calcHoursBetween('2020-08-30T08:30:00+01:00', '2020-09-01T17:30:00+01:00'); // 9 (Monday 31st was a bank holiday & don't work any other weekdays)

wtc.dispose(); // stop calendar sync
```

## API Documentation

[TODO]

WorkingTimeCalculator(options)  
.addWorkingHours(days, startTime, stopTime, timezone)  
(async) .excludeCalendarFile(config)  
(async) .excludeCalendarUrl(config)  
.excludeBetween(start, end)  
.calcHoursBetween(start, end) -> Number (Hours)  
.calcMinutesBetween(start, end) -> Number (Minutes)  
.calcSecondsBetween(start, end) -> Number (Seconds)  
.calcMillisecondsBetween(start, end) -> Number (Milliseconds)  
.calcDurationBetween(start, end) -> Luxon Duration  
