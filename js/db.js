/**
 * db.js — SQLite Data Access Layer (DAL)
 *
 * Uses sql.js (WebAssembly SQLite that runs entirely in the browser).
 *
 * Initialisation priority:
 *   1. localStorage  — restores a previously saved user session
 *   2. /app.db       — server-side pre-built SQLite file (schema + seed data)
 *   3. Blank DB      — fallback when running without a web server
 *
 * The database is persisted to localStorage as a binary byte array so
 * data survives page reloads without any server or Node.js.
 *
 * Public surface:
 *   DB.init()           → Promise – initialise sql.js + load or create DB
 *   DB.query(sql, p)    → Array<Object> – SELECT
 *   DB.queryOne(sql, p) → Object|null – SELECT (first row only)
 *   DB.run(sql, p)      → void – INSERT / UPDATE / DELETE
 *   DB.save()           → void – flush DB bytes to localStorage
 *   DB.isReady()        → boolean
 */

var DB = (function () {

  /* ── private state ───────────────────────────────────────────── */
  var _db  = null;
  var _SQL = null;
  var STORAGE_KEY = 'cdElop26_db_v1';

  /* ── schema DDL ──────────────────────────────────────────────── */
  var SCHEMA_SQL = [
    'CREATE TABLE IF NOT EXISTS Schools (',
    '  SchoolID       TEXT PRIMARY KEY,',
    '  SchoolName     TEXT NOT NULL,',
    '  SchoolShortName TEXT DEFAULT \'\',',
    '  Level          TEXT DEFAULT \'Elementary\',',
    '  LogoURL        TEXT DEFAULT \'\',',
    '  IsActive       INTEGER DEFAULT 1',
    ');',

    'CREATE TABLE IF NOT EXISTS Tournaments (',
    '  TournamentID   TEXT PRIMARY KEY,',
    '  TournamentName TEXT NOT NULL,',
    '  Sport          TEXT DEFAULT \'\',',
    '  Level          TEXT DEFAULT \'Elementary\',',
    '  Format         TEXT DEFAULT \'ROUND_ROBIN\',',
    '  SeasonYear     INTEGER DEFAULT 2026,',
    '  Status         TEXT DEFAULT \'DRAFT\',',
    '  PublicVisible  INTEGER DEFAULT 0,',
    '  Notes          TEXT DEFAULT \'\',',
    '  CreatedAt      TEXT,',
    '  UpdatedAt      TEXT',
    ');',

    'CREATE TABLE IF NOT EXISTS TournamentTeams (',
    '  TeamID         TEXT PRIMARY KEY,',
    '  TournamentID   TEXT NOT NULL,',
    '  SchoolID       TEXT DEFAULT \'\',',
    '  TeamName       TEXT DEFAULT \'\',',
    '  TeamLabel      TEXT DEFAULT \'\',',
    '  CoachName      TEXT DEFAULT \'\',',
    '  CoachEmail     TEXT DEFAULT \'\',',
    '  IsActive       INTEGER DEFAULT 1',
    ');',

    'CREATE TABLE IF NOT EXISTS Games (',
    '  GameID         TEXT PRIMARY KEY,',
    '  TournamentID   TEXT NOT NULL,',
    '  Stage          TEXT DEFAULT \'ROUND_ROBIN\',',
    '  RoundNumber    INTEGER DEFAULT 1,',
    '  GameLabel      TEXT DEFAULT \'\',',
    '  TeamA_ID       TEXT DEFAULT \'\',',
    '  TeamB_ID       TEXT DEFAULT \'\',',
    '  ScoreA         TEXT DEFAULT \'\',',
    '  ScoreB         TEXT DEFAULT \'\',',
    '  WinnerTeamID   TEXT DEFAULT \'\',',
    '  Location       TEXT DEFAULT \'\',',
    '  GameTimeLabel  TEXT DEFAULT \'\',',
    '  IsComplete     INTEGER DEFAULT 0,',
    '  CreatedAt      TEXT,',
    '  UpdatedAt      TEXT',
    ');',

    'CREATE TABLE IF NOT EXISTS Standings (',
    '  TournamentID   TEXT NOT NULL,',
    '  TeamID         TEXT NOT NULL,',
    '  Wins           INTEGER DEFAULT 0,',
    '  Losses         INTEGER DEFAULT 0,',
    '  PointsFor      INTEGER DEFAULT 0,',
    '  PointsAgainst  INTEGER DEFAULT 0,',
    '  PointDiff      INTEGER DEFAULT 0,',
    '  Rank           INTEGER DEFAULT 0,',
    '  LastUpdatedAt  TEXT,',
    '  PRIMARY KEY (TournamentID, TeamID)',
    ');',

    'CREATE TABLE IF NOT EXISTS Settings (',
    '  Key   TEXT PRIMARY KEY,',
    '  Value TEXT',
    ');'
  ].join('\n');

  /* ── helpers ─────────────────────────────────────────────────── */

  /**
   * Convert a sql.js result set ({columns, values}) into an array of
   * plain objects — one object per row.
   */
  function toObjects(result) {
    if (!result || !result.columns || !result.values) return [];
    var cols = result.columns;
    return result.values.map(function (row) {
      var obj = {};
      for (var i = 0; i < cols.length; i++) {
        obj[cols[i]] = row[i];
      }
      return obj;
    });
  }

  /* ── public API ──────────────────────────────────────────────── */
  return {

    /**
     * Initialise sql.js (fetches the WASM binary from CDN), then loads the
     * database using the following priority:
     *
     *   1. localStorage  — user's persisted session from a previous visit
     *   2. /app.db       — pre-built SQLite file served by the web server
     *                      (contains schema + all district schools)
     *   3. Blank DB      — fallback for local file:// development
     *
     * Always ensures the schema tables exist (CREATE TABLE IF NOT EXISTS).
     */
    init: async function () {
      _SQL = await initSqlJs({
        locateFile: function (file) {
          return 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/' + file;
        }
      });

      /* ── Priority 1: localStorage ── */
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          var bytes = new Uint8Array(JSON.parse(saved));
          _db = new _SQL.Database(bytes);
          console.log('[DB] Restored from localStorage');
        } catch (e) {
          console.warn('[DB] localStorage data corrupt — will try app.db next:', e);
          saved = null;
        }
      }

      /* ── Priority 2: fetch /app.db from the server ── */
      if (!saved) {
        try {
          var resp = await fetch('app.db', { cache: 'no-store' });
          if (resp.ok) {
            var buf  = await resp.arrayBuffer();
            _db = new _SQL.Database(new Uint8Array(buf));
            console.log('[DB] Loaded from app.db (' + (buf.byteLength / 1024).toFixed(1) + ' KB)');
          } else {
            throw new Error('HTTP ' + resp.status);
          }
        } catch (e) {
          console.warn('[DB] Could not fetch app.db — starting blank:', e);
          _db = new _SQL.Database();
        }
      }

      /* ensure all tables exist (idempotent — safe to run on any DB) */
      _db.exec(SCHEMA_SQL);

      /* ── Logo sync: if any school is missing a logo, pull URLs from app.db ── *
       * Handles the case where localStorage was saved before logos were added   *
       * to the seed data. Matches by SchoolName (stable) not by SchoolID (uuid).*
       * Only fetches app.db when actually needed.                               */
      if (saved) {
        try {
          var logoCheck = _db.exec("SELECT COUNT(*) FROM Schools WHERE LogoURL = '' OR LogoURL IS NULL");
          var missingCount = (logoCheck.length && logoCheck[0].values.length) ? logoCheck[0].values[0][0] : 0;
          if (missingCount > 0) {
            var lresp = await fetch('app.db', { cache: 'no-store' });
            if (lresp.ok) {
              var lbuf     = await lresp.arrayBuffer();
              var freshDb  = new _SQL.Database(new Uint8Array(lbuf));
              var lresult  = freshDb.exec("SELECT SchoolName, LogoURL FROM Schools WHERE LogoURL != ''");
              if (lresult.length) {
                toObjects(lresult[0]).forEach(function (s) {
                  _db.run(
                    "UPDATE Schools SET LogoURL = ? WHERE SchoolName = ? AND (LogoURL = '' OR LogoURL IS NULL)",
                    [s.LogoURL, s.SchoolName]
                  );
                });
                console.log('[DB] Synced ' + missingCount + ' school logo(s) from app.db');
              }
              freshDb.close();
            }
          }
        } catch (e) {
          console.warn('[DB] Could not sync school logos:', e);
        }
      }

      this.save();
    },

    /**
     * Export the in-memory database to localStorage so data persists
     * across page reloads.
     */
    save: function () {
      if (!_db) return;
      var data = _db.export();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(data)));
      } catch (e) {
        console.warn('[DB] Could not save to localStorage (quota exceeded?):', e);
      }
    },

    /**
     * Execute a SELECT query and return all matching rows as objects.
     * @param {string} sql    - SQL with ? placeholders
     * @param {Array}  params - Bind parameters
     * @returns {Object[]}
     */
    query: function (sql, params) {
      if (!_db) return [];
      var res = _db.exec(sql, params || []);
      if (!res || !res.length) return [];
      return toObjects(res[0]);
    },

    /**
     * Execute a SELECT query and return the first row, or null.
     * @param {string} sql
     * @param {Array}  params
     * @returns {Object|null}
     */
    queryOne: function (sql, params) {
      var rows = this.query(sql, params);
      return rows.length ? rows[0] : null;
    },

    /**
     * Execute an INSERT / UPDATE / DELETE statement.
     * Automatically saves the DB to localStorage afterwards.
     * @param {string} sql
     * @param {Array}  params
     */
    run: function (sql, params) {
      if (!_db) throw new Error('[DB] Database not initialised');
      _db.run(sql, params || []);
      this.save();
    },

    /** @returns {boolean} */
    isReady: function () {
      return !!_db;
    }
  };

}());
