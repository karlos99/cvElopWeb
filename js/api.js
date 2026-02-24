/**
 * api.js — Async HTTP client for PHP backend branch
 *
 * Every exported method mirrors the original synchronous API surface but
 * now returns a Promise that resolves to the same data shape.
 *
 * All GET operations pass `token` as a query parameter (Apache may strip
 * the Authorization header, so it's duplicated there for safety).
 * All POST operations send JSON + an Authorization header.
 *
 * Error handling: if the server returns `{ ok: false, error: "..." }` the
 * Promise rejects with an Error whose message is the server-provided string.
 */

var API = (function () {
  'use strict';

  var ENDPOINT = 'api.php';
  var TOKEN    = 'ases-elop-2026-secure';

  /* ── fetch wrappers ────────────────────────────────────────────── */

  async function get(action, params) {
    var qs = new URLSearchParams(Object.assign({ action: action, token: TOKEN }, params || {}));
    var res = await fetch(ENDPOINT + '?' + qs.toString(), {
      headers: { 'Authorization': 'Bearer ' + TOKEN }
    });
    var data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Server error');
    return data.data;
  }

  async function post(action, body) {
    var payload = Object.assign({ action: action }, body || {});
    var res = await fetch(ENDPOINT + '?token=' + encodeURIComponent(TOKEN), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN },
      body:    JSON.stringify(payload)
    });
    var data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Server error');
    return data.data;
  }

  /* ── public API ────────────────────────────────────────────────── */

  return {

    /* ── no-op compat shim (called from app.js onMounted) ── */
    seedSampleData: async function () { /* handled by PHP seed logic */ },

    /* ── Schools ────────────────────────────────────────── */
    listSchools: function (activeOnly) {
      return get('listSchools', { activeOnly: activeOnly === false ? '0' : '1' });
    },
    createSchool: function (data) {
      return post('createSchool', data);
    },
    updateSchool: function (id, data) {
      return post('updateSchool', Object.assign({ SchoolID: id }, data));
    },

    /* ── Tournaments ─────────────────────────────────────── */
    listTournaments: function (includeAll) {
      return get('listTournaments', { includeAll: includeAll ? '1' : '0' });
    },
    getTournament: function (id) {
      return get('getTournament', { id: id });
    },
    createTournament: function (data) {
      return post('createTournament', data);
    },
    setTournamentStatus: function (id, status) {
      return post('setTournamentStatus', { id: id, status: status });
    },
    toggleTournamentPublic: function (id) {
      return post('toggleTournamentPublic', { id: id });
    },
    deleteTournament: function (id) {
      return post('deleteTournament', { id: id });
    },

    /* ── Teams ───────────────────────────────────────────── */
    listTeams: function (tournamentId) {
      return get('listTeams', { tournamentId: tournamentId });
    },
    setParticipants: function (tournamentId, teams) {
      return post('setParticipants', { tournamentId: tournamentId, teams: teams });
    },
    addAllSchoolsByLevel: function (tournamentId) {
      return post('addAllSchoolsByLevel', { tournamentId: tournamentId });
    },

    /* ── Games ───────────────────────────────────────────── */
    listGames: function (tournamentId) {
      return get('listGames', { tournamentId: tournamentId });
    },
    saveScore: function (gameId, scoreA, scoreB) {
      return post('saveScore', { gameId: gameId, scoreA: scoreA, scoreB: scoreB });
    },
    updateGameTeams: function (gameId, teamA, teamB, location) {
      return post('updateGameTeams', { gameId: gameId, teamA: teamA, teamB: teamB, location: location || '' });
    },

    /* ── Schedule ────────────────────────────────────────── */
    generateSchedule: function (tournamentId) {
      return post('generateSchedule', { tournamentId: tournamentId });
    },
    createCustomSchedule: function (tournamentId, customMatchups, autoGenerate) {
      return post('createCustomSchedule', { tournamentId: tournamentId, customMatchups: customMatchups, autoGenerate: !!autoGenerate });
    },
    generateBracket: function (tournamentId, force) {
      return post('generateBracket', { tournamentId: tournamentId, force: !!force });
    },
    markByeGamesComplete: function (tournamentId) {
      return post('markByeGamesComplete', { tournamentId: tournamentId });
    },

    /* ── Standings ───────────────────────────────────────── */
    getStandings: function (tournamentId) {
      return get('getStandings', { tournamentId: tournamentId });
    },
    rebuildStandings: function (tournamentId) {
      return post('rebuildStandings', { tournamentId: tournamentId });
    },

    /* ── Sports ──────────────────────────────────────────── */
    listSports: function () {
      return get('listSports');
    },
    saveSports: function (sports) {
      return post('saveSports', { sports: sports });
    },

    /* ── Show-location setting ───────────────────────────── */
    getShowLocation: function (tournamentId) {
      return get('getShowLocation', { tournamentId: tournamentId });
    },
    setShowLocation: function (tournamentId, val) {
      return post('setShowLocation', { tournamentId: tournamentId, val: val });
    }

  };
}());
