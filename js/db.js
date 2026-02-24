/**
 * db.js — no-op stub for PHP backend branch
 *
 * On the php-backend branch, all data access goes through api.php via HTTP.
 * This file satisfies any remaining `DB.*` call sites in app.js with inert stubs.
 */

var DB = (function () {
  'use strict';
  return {
    /** Resolves immediately — PHP initialises the DB server-side. */
    init:              async function () {},
    isReady:           function () { return true; },
    /** Data lives on the server; download is not applicable here. */
    download:          function () { alert('Data is stored on the server and cannot be downloaded from the browser.'); },
    enableServerSync:  function () {},
    disableServerSync: function () {},
    onSyncResult:      function () {},
    forceSyncToServer: function () {}
  };
}());
