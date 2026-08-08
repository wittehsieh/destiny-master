/**
 * Solar time utility: converts a civil (wall-clock) birth time at a given
 * location into apparent (true) solar time, for feeding into the existing
 * ziwei chart engine's hour input.
 *
 * Pipeline: civil time + IANA timezone -> precise UTC instant (via Intl,
 * so historical DST/political offset changes are handled automatically)
 * -> Sun's hour angle at that instant for the observer's lat/lng (via
 * Astronomy Engine) -> apparent solar time.
 *
 * Depends on the global `Astronomy` object (astronomy.browser.min.js)
 * being loaded first.
 */
(function () {
  'use strict';

  /** 時辰 index (0-12) boundaries, matching iztro's own hour-index convention. */
  var HOUR_INDEX_BOUNDARIES = [
    { index: 0, startMin: 0 * 60, endMin: 1 * 60 },     // 早子 00:00-01:00
    { index: 1, startMin: 1 * 60, endMin: 3 * 60 },     // 丑 01:00-03:00
    { index: 2, startMin: 3 * 60, endMin: 5 * 60 },     // 寅 03:00-05:00
    { index: 3, startMin: 5 * 60, endMin: 7 * 60 },     // 卯 05:00-07:00
    { index: 4, startMin: 7 * 60, endMin: 9 * 60 },     // 辰 07:00-09:00
    { index: 5, startMin: 9 * 60, endMin: 11 * 60 },    // 巳 09:00-11:00
    { index: 6, startMin: 11 * 60, endMin: 13 * 60 },   // 午 11:00-13:00
    { index: 7, startMin: 13 * 60, endMin: 15 * 60 },   // 未 13:00-15:00
    { index: 8, startMin: 15 * 60, endMin: 17 * 60 },   // 申 15:00-17:00
    { index: 9, startMin: 17 * 60, endMin: 19 * 60 },   // 酉 17:00-19:00
    { index: 10, startMin: 19 * 60, endMin: 21 * 60 },  // 戌 19:00-21:00
    { index: 11, startMin: 21 * 60, endMin: 23 * 60 },  // 亥 21:00-23:00
    { index: 12, startMin: 23 * 60, endMin: 24 * 60 },  // 晚子 23:00-24:00
  ];

  /**
   * Returns the given IANA timezone's UTC offset, in minutes, at the given
   * instant. Uses the browser's built-in ICU/Intl timezone database, which
   * is historically DST- and political-change-aware (no hardcoded
   * "Taipei = UTC+8" assumptions).
   */
  function getOffsetMinutes(timeZoneId, date) {
    var dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZoneId,
      timeZoneName: 'longOffset',
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    var part = dtf.formatToParts(date).find(function (p) { return p.type === 'timeZoneName'; });
    var m = part && part.value.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!m) return 0;
    var sign = m[1] === '-' ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
  }

  /**
   * Converts a civil wall-clock date/time in the given IANA timezone into
   * the precise UTC instant it represents. Iterates a couple of times to
   * settle near DST transitions.
   */
  function civilToUtc(year, month, day, hour, minute, timeZoneId) {
    var base = Date.UTC(year, month - 1, day, hour, minute, 0);
    var guess = base;
    for (var i = 0; i < 3; i++) {
      var offset = getOffsetMinutes(timeZoneId, new Date(guess));
      var candidate = base - offset * 60000;
      if (candidate === guess) break;
      guess = candidate;
    }
    return new Date(guess);
  }

  /**
   * True (apparent) solar time-of-day, in decimal hours [0, 24), for the
   * given UTC instant and observer location. This is the Sun's actual
   * hour angle at that instant/place, so it inherently includes both the
   * longitude effect and the equation of time -- no separate calculation
   * of either is needed.
   */
  function trueSolarHours(utcDate, latitude, longitude) {
    var observer = new Astronomy.Observer(latitude, longitude, 0);
    var hourAngle = Astronomy.HourAngle(Astronomy.Body.Sun, utcDate, observer);
    return (hourAngle + 12) % 24;
  }

  /** Maps decimal hours [0,24) to iztro's 0-12 時辰 index. */
  function hourIndexFromDecimalHours(decimalHours) {
    var totalMin = Math.round(decimalHours * 60);
    if (totalMin >= 24 * 60) totalMin -= 24 * 60;
    for (var i = 0; i < HOUR_INDEX_BOUNDARIES.length; i++) {
      var b = HOUR_INDEX_BOUNDARIES[i];
      if (totalMin >= b.startMin && totalMin < b.endMin) return b.index;
    }
    return 0;
  }

  /**
   * @param {{year:number,month:number,day:number}} birthDate
   * @param {{hour:number,minute:number}} birthTime civil wall-clock time
   * @param {{latitude:number,longitude:number,timezoneId:string}} location
   * @returns {{
   *   civilMinutes: number,
   *   trueSolarMinutes: number,
   *   correctionMinutes: number,
   *   trueSolarHour: number,
   *   trueSolarMinute: number,
   *   hourIndex: number,
   * }}
   */
  function calculateTrueSolarTime(birthDate, birthTime, location) {
    var utcInstant = civilToUtc(
      birthDate.year, birthDate.month, birthDate.day,
      birthTime.hour, birthTime.minute,
      location.timezoneId
    );

    var solarDecimalHours = trueSolarHours(utcInstant, location.latitude, location.longitude);
    var trueSolarTotalMin = Math.round(solarDecimalHours * 60) % (24 * 60);

    var civilTotalMin = birthTime.hour * 60 + birthTime.minute;

    // Shortest signed difference on a 24h wheel, so e.g. 23:58 -> 00:02
    // reports +4min rather than -1436min.
    var diff = trueSolarTotalMin - civilTotalMin;
    if (diff > 12 * 60) diff -= 24 * 60;
    if (diff < -12 * 60) diff += 24 * 60;

    return {
      civilMinutes: civilTotalMin,
      trueSolarMinutes: trueSolarTotalMin,
      correctionMinutes: diff,
      trueSolarHour: Math.floor(trueSolarTotalMin / 60),
      trueSolarMinute: trueSolarTotalMin % 60,
      hourIndex: hourIndexFromDecimalHours(solarDecimalHours),
    };
  }

  window.SolarTime = {
    calculateTrueSolarTime: calculateTrueSolarTime,
    hourIndexFromDecimalHours: hourIndexFromDecimalHours,
    civilToUtc: civilToUtc,
    getOffsetMinutes: getOffsetMinutes,
  };
})();
