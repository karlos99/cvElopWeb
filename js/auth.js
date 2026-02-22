/**
 * auth.js — Authentication Module
 *
 * Manages user login / logout and session persistence via sessionStorage.
 * Runs entirely in the browser — no server, no Node.
 *
 * Credentials are stored base64-encoded so they are not plaintext in source.
 *   atob('a2FybG9z')    → 'karlos'
 *   atob('SGlkYWxnbyMx') → 'Hidalgo#1'
 */

var AUTH = (function () {

  var SESSION_KEY  = 'ases_tm_session';
  var USERS_KEY    = 'cdElop26_users_v1';

  /* ── Built-in super-admin (cannot be removed) ──────────────── */
  var SUPER_ADMIN = {
    username: atob('a2FybG9z'),       // karlos
    password: atob('SGlkYWxnbyMx'),   // Hidalgo#1
    role:     'admin',
    display:  'Karlos',
    builtin:  true
  };

  /* ── Stored users ───────────────────────────────────────────── */
  function getAllUsers() {
    var extra = [];
    try {
      var raw = localStorage.getItem(USERS_KEY);
      if (raw) extra = JSON.parse(raw);
    } catch (e) {}
    return [SUPER_ADMIN].concat(extra);
  }

  function getStoredUsers() {
    try {
      var raw = localStorage.getItem(USERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function saveStoredUsers(arr) {
    localStorage.setItem(USERS_KEY, JSON.stringify(arr));
  }

  /* ── Public API ─────────────────────────────────────────────── */

  /**
   * Attempt login.
   * @returns {{ ok: true, username, role, display } | { ok: false, message }}
   */
  function login(username, password) {
    var trimUser = (username || '').trim().toLowerCase();
    var user = getAllUsers().find(function (u) {
      return u.username.toLowerCase() === trimUser && u.password === password;
    });

    if (!user) {
      return { ok: false, message: 'Invalid username or password.' };
    }

    var session = { username: user.username, role: user.role, display: user.display };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) { /* ignore */ }

    return { ok: true, username: user.username, role: user.role, display: user.display };
  }

  /** Clear the current session. */
  function logout() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  /**
   * Return the current session object `{ username, role, display }`,
   * or null if nobody is logged in.
   */
  function getSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  /** Returns true when an admin session is active. */
  function isAdmin() {
    var s = getSession();
    return !!(s && s.role === 'admin');
  }

  /** Returns true when a scorer session (score-entry only) is active. */
  function isScorer() {
    var s = getSession();
    return !!(s && s.role === 'scorer');
  }

  /**
   * List all users.
   * Returns objects without passwords: { username, display, role, builtin }
   */
  function listUsers() {
    return getAllUsers().map(function (u) {
      return { username: u.username, display: u.display, role: u.role || 'admin', builtin: !!u.builtin };
    });
  }

  /**
   * Add a new user.
   * @param {string} username
   * @param {string} password
   * @param {string} display
   * @param {string} [role='admin']  'admin' | 'scorer'
   * @returns {{ ok: true } | { ok: false, message }}
   */
  function addUser(username, password, display, role) {
    var u = (username || '').trim();
    var p = (password || '').trim();
    var d = (display  || '').trim() || u;
    var r = (role || 'admin').trim();
    if (!u || !p) return { ok: false, message: 'Username and password are required.' };
    if (u.length < 3) return { ok: false, message: 'Username must be at least 3 characters.' };
    if (p.length < 6) return { ok: false, message: 'Password must be at least 6 characters.' };
    if (r !== 'admin' && r !== 'scorer') return { ok: false, message: 'Role must be admin or scorer.' };
    var all = getAllUsers();
    if (all.find(function (x) { return x.username.toLowerCase() === u.toLowerCase(); })) {
      return { ok: false, message: 'Username already exists.' };
    }
    var stored = getStoredUsers();
    stored.push({ username: u, password: p, role: r, display: d, builtin: false });
    saveStoredUsers(stored);
    return { ok: true };
  }

  /**
   * Remove an admin user by username.
   * Built-in super-admin cannot be removed.
   */
  function removeUser(username) {
    if ((username || '').toLowerCase() === SUPER_ADMIN.username.toLowerCase()) {
      return { ok: false, message: 'The built-in super-admin cannot be removed.' };
    }
    var stored = getStoredUsers().filter(function (u) {
      return u.username.toLowerCase() !== (username || '').toLowerCase();
    });
    saveStoredUsers(stored);
    return { ok: true };
  }

  return {
    login: login, logout: logout,
    getSession: getSession, isAdmin: isAdmin, isScorer: isScorer,
    listUsers: listUsers, addUser: addUser, removeUser: removeUser
  };

}());
