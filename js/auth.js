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

  var SESSION_KEY = 'ases_tm_session';

  /* ── Registered users ──────────────────────────────────────── */
  var USERS = [
    {
      username: atob('a2FybG9z'),       // karlos
      password: atob('SGlkYWxnbyMx'),   // Hidalgo#1
      role:     'admin',
      display:  'Karlos'
    }
  ];

  /* ── Public API ─────────────────────────────────────────────── */

  /**
   * Attempt login.
   * @returns {{ ok: true, username, role, display } | { ok: false, message }}
   */
  function login(username, password) {
    var trimUser = (username || '').trim().toLowerCase();
    var user = USERS.find(function (u) {
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

  return { login: login, logout: logout, getSession: getSession, isAdmin: isAdmin };

}());
