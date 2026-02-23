/**
 * db.js — SQLite Data Access Layer (DAL)
 *
 * Uses sql.js (WebAssembly SQLite that runs entirely in the browser).
 *
 * Initialisation priority:
 *   1. localStorage  — restores a previously saved user session
 *   2. Blank DB      — fresh schema seeded with SEED_SCHOOLS inline data
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

  /* ── school seed data ─────────────────────────────────────────── */
  var SEED_SCHOOLS = [
    { id: 'SCH_386c2dfb1f87', name: 'Cesar Chavez',           short: 'CC',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/CC_logo@3x_1749069437.png' },
    { id: 'SCH_9cc2338da6bb', name: 'Coral Mountain',         short: 'CMA', level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/CMA_logo@3x_1749069438.png' },
    { id: 'SCH_bd64324c1d01', name: 'John Kelley',            short: 'JK',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/JK_logo@3x_1749069439.png' },
    { id: 'SCH_56297ad34f65', name: 'Las Palmitas',           short: 'LP',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/canva_93356.png' },
    { id: 'SCH_06d5911145b1', name: 'Mecca',                  short: 'MA',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/M_logo@3x_1749069440.png' },
    { id: 'SCH_d5f7b302ee5b', name: 'Mountain Vista',         short: 'MV',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/MV_logo@3x_1749069206.png' },
    { id: 'SCH_7941531f4a15', name: 'Oasis',                  short: 'OA',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/O_logo@3x_1749069440.png' },
    { id: 'SCH_1da1b88dc9ef', name: 'Palm View',              short: 'PV',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/PV_logo@2x_1749069441.png' },
    { id: 'SCH_a5faabb21063', name: 'Peter Pendleton',        short: 'PP',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/PP_logo@2x_1749069441.png' },
    { id: 'SCH_04a8f5851e9b', name: 'Saul Martinez',          short: 'SM',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/SM_logo@2x_1749069441.png' },
    { id: 'SCH_baa0073e4774', name: 'Sea View',               short: 'SV',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/SV_logo@3x_1749069441.png' },
    { id: 'SCH_605eb559addd', name: 'Valle del Sol',          short: 'VDS', level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/VDS_logo@3x_1749069448.png' },
    { id: 'SCH_7cf27e194323', name: 'Valley View',            short: 'VV',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/VV_logoSq4_1749069208.png' },
    { id: 'SCH_ab10640ab04e', name: 'Westside',               short: 'WS',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/W_logo@3x_1749069208.png' },
    { id: 'SCH_c331282a101c', name: 'Bobby Duke',             short: 'BD',  level: 'Middle',     logo: 'https://files.smartsites.parentsquare.com/9154/BB_logo@3x_1749069437.png' },
    { id: 'SCH_f02a2adb02af', name: 'Cahuilla Desert Academy',short: 'CDA', level: 'Middle',     logo: 'https://files.smartsites.parentsquare.com/9154/CDA_logo@3x_1749069203.png' },
    { id: 'SCH_fbeebc7b32b6', name: 'Toro Canyon',            short: 'TC',  level: 'Middle',     logo: 'https://files.smartsites.parentsquare.com/9154/TC_logo@3x_1749069442.png' },
    { id: 'SCH_39c86450c3f1', name: 'West Shores',            short: 'WSH', level: 'Middle',     logo: '' }
  ];

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
     *   2. Blank DB      — fresh schema + SEED_SCHOOLS inserted inline
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

      /* ── Priority 2: fresh DB — create schema + seed schools ── */
      if (!saved) {
        _db = new _SQL.Database();
        _db.exec(SCHEMA_SQL);
        SEED_SCHOOLS.forEach(function (s) {
          _db.run(
            'INSERT OR IGNORE INTO Schools (SchoolID, SchoolName, SchoolShortName, Level, LogoURL, IsActive) VALUES (?,?,?,?,?,1)',
            [s.id, s.name, s.short, s.level, s.logo]
          );
        });
        console.log('[DB] Fresh DB — seeded ' + SEED_SCHOOLS.length + ' schools');
      } else {
        /* ensure all tables exist on an existing localStorage DB */
        _db.exec(SCHEMA_SQL);

        /* sync any missing/outdated logos from SEED_SCHOOLS inline data */
        SEED_SCHOOLS.forEach(function (s) {
          if (!s.logo) return;
          _db.run(
            "UPDATE Schools SET LogoURL = ? WHERE SchoolID = ? AND (LogoURL = '' OR LogoURL IS NULL)",
            [s.logo, s.id]
          );
        });
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
