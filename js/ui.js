/**
 * ui.js — Deprecated
 *
 * All rendering is now handled by Vue 3 (js/app.js).
 * This file is kept for reference only and is NOT loaded by index.html.
 */

/* istanbul ignore file */
var UI = (function () {

  /* ── helpers ─────────────────────────────────────────────────── */

  /** Return a team's display name from a dictionary keyed by TeamID. */
  function teamName(teamId, teamsMap) {
    if (!teamId || teamId === 'BYE') return 'BYE';
    var t = teamsMap[teamId];
    return t ? t.TeamName : teamId;
  }

  /** Escape HTML special characters to prevent XSS. */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Build a map of { TeamID → team } for quick lookups.
   * @param {Object[]} teams
   * @returns {Object}
   */
  function buildTeamsMap(teams) {
    var map = {};
    teams.forEach(function (t) { map[t.TeamID] = t; });
    return map;
  }

  /**
   * Group an array of games by RoundNumber and return an object
   * { roundNumber → game[] } plus a sorted array of round numbers.
   */
  function groupByRound(games) {
    var rounds = {};
    games.forEach(function (g) {
      var r = g.RoundNumber || 1;
      if (!rounds[r]) rounds[r] = [];
      rounds[r].push(g);
    });
    var sorted = Object.keys(rounds).map(Number).sort(function (a, b) { return a - b; });
    return { rounds: rounds, sorted: sorted };
  }

  /** Render a single game card as an HTML string. */
  function gameCardHTML(game, teamsMap, isAdmin) {
    var tA    = teamName(game.TeamA_ID, teamsMap);
    var tB    = teamName(game.TeamB_ID, teamsMap);
    var isBye = game.TeamA_ID === 'BYE' || game.TeamB_ID === 'BYE';

    var scoreADisplay = game.ScoreA !== '' && game.ScoreA !== null ? esc(game.ScoreA) : '—';
    var scoreBDisplay = game.ScoreB !== '' && game.ScoreB !== null ? esc(game.ScoreB) : '—';

    /* win/loss badge for completed games */
    var badgeA = '';
    var badgeB = '';
    if (game.IsComplete && !isBye) {
      var sa = Number(game.ScoreA);
      var sb = Number(game.ScoreB);
      if (sa > sb) {
        badgeA = '<span class="badge badge-success badge-xs ml-1">W</span>';
        badgeB = '<span class="badge badge-error badge-xs ml-1">L</span>';
      } else if (sb > sa) {
        badgeA = '<span class="badge badge-error badge-xs ml-1">L</span>';
        badgeB = '<span class="badge badge-success badge-xs ml-1">W</span>';
      }
    }

    var scoreSection;
    if (isAdmin && !isBye) {
      scoreSection = [
        '<div class="flex items-center gap-1">',
        '  <input type="number" class="input input-bordered input-xs w-14 text-center score-input"',
        '         data-game-id="' + esc(game.GameID) + '" data-field="scoreA"',
        '         value="' + esc(game.ScoreA) + '" min="0" />',
        '  <span class="text-base-content/40 font-bold">:</span>',
        '  <input type="number" class="input input-bordered input-xs w-14 text-center score-input"',
        '         data-game-id="' + esc(game.GameID) + '" data-field="scoreB"',
        '         value="' + esc(game.ScoreB) + '" min="0" />',
        '</div>'
      ].join('\n');
    } else {
      scoreSection = [
        '<div class="flex items-center gap-1 text-sm font-bold">',
        '  <span class="w-7 text-center">' + scoreADisplay + '</span>',
        '  <span class="text-base-content/30">:</span>',
        '  <span class="w-7 text-center">' + scoreBDisplay + '</span>',
        '</div>'
      ].join('\n');
    }

    var saveBtn = (isAdmin && !isBye)
      ? '<button class="btn btn-xs btn-primary save-score-btn ml-2" data-game-id="' + esc(game.GameID) + '">Save</button>'
      : '';

    return [
      '<div class="game-card bg-base-200 rounded-xl p-3 flex items-center justify-between gap-3">',
      '  <div class="flex-1 text-right text-sm font-medium truncate">',
      '    ' + esc(tA) + badgeA,
      '  </div>',
      '  <div class="flex items-center gap-1 flex-shrink-0">',
      '    ' + scoreSection,
      '    ' + saveBtn,
      '  </div>',
      '  <div class="flex-1 text-left text-sm font-medium truncate">',
      '    ' + badgeB + esc(tB),
      '  </div>',
      '</div>'
    ].join('\n');
  }

  /** Render a list of rounds → games into an HTML string. */
  function gamesListHTML(games, teamsMap, isAdmin, maxRounds) {
    if (!games || !games.length) {
      return '<div class="text-center py-8 text-base-content/40 text-sm">No games scheduled yet</div>';
    }
    var grouped = groupByRound(games);
    var rounds  = maxRounds ? grouped.sorted.slice(0, maxRounds) : grouped.sorted;
    var html    = '';

    rounds.forEach(function (roundNum) {
      html += '<div class="mb-5">';
      html += '  <div class="round-badge">Round ' + roundNum + '</div>';
      html += '  <div class="space-y-2 mt-2">';
      grouped.rounds[roundNum].forEach(function (g) {
        html += gameCardHTML(g, teamsMap, isAdmin);
      });
      html += '  </div>';
      html += '</div>';
    });
    return html;
  }

  /* ── public surface ─────────────────────────────────────────── */
  return {

    /**
     * Populate the tournament <select> element.
     * @param {Object[]} tournaments
     * @param {string}   selectedId
     */
    renderTournamentSelect: function (tournaments, selectedId) {
      var el = document.getElementById('tournament-select');
      if (!el) return;
      var html = '<option value="">Select a Tournament…</option>';
      tournaments.forEach(function (t) {
        var label = esc(t.TournamentName) + ' — ' + esc(t.Sport) + ' (' + esc(t.Status) + ')';
        var sel   = String(t.TournamentID) === String(selectedId) ? ' selected' : '';
        html += '<option value="' + esc(t.TournamentID) + '"' + sel + '>' + label + '</option>';
      });
      el.innerHTML = html;
    },

    /**
     * Render the compact standings list used in the overview card.
     * @param {Object[]} standings
     * @param {Object}   teamsMap  – { TeamID → team }
     */
    renderStandingsSummary: function (standings, teamsMap) {
      var el = document.getElementById('standings-summary');
      if (!el) return;
      if (!standings || !standings.length) {
        el.innerHTML = '<div class="text-center py-6 text-base-content/40 text-sm">No standings data yet</div>';
        return;
      }
      var html = '<div class="space-y-2">';
      standings.forEach(function (row) {
        var tName = teamName(row.TeamID, teamsMap);
        var diff  = row.PointDiff >= 0 ? '+' + row.PointDiff : String(row.PointDiff);
        html += [
          '<div class="flex items-center gap-3 p-2 rounded-lg hover:bg-base-200 transition cursor-pointer standings-row" data-team-id="' + esc(row.TeamID) + '">',
          '  <span class="text-base-content/40 font-bold w-5 text-center">' + esc(row.Rank) + '</span>',
          '  <span class="flex-1 font-medium text-sm truncate">' + esc(tName) + '</span>',
          '  <div class="flex gap-3 text-xs font-bold">',
          '    <span class="text-success">' + esc(row.Wins) + 'W</span>',
          '    <span class="text-error">'   + esc(row.Losses) + 'L</span>',
          '    <span class="text-base-content/50 hidden sm:inline">' + diff + '</span>',
          '  </div>',
          '</div>'
        ].join('\n');
      });
      html += '</div>';
      el.innerHTML = html;
    },

    /**
     * Render the full standings table.
     * @param {Object[]} standings
     * @param {Object}   teamsMap
     */
    renderFullStandings: function (standings, teamsMap) {
      var el = document.getElementById('full-standings');
      if (!el) return;
      if (!standings || !standings.length) {
        el.innerHTML = '<div class="text-center py-8 text-base-content/40 text-sm">No standings data</div>';
        return;
      }
      var html = [
        '<div class="overflow-x-auto">',
        '<table class="table table-sm w-full">',
        '<thead><tr>',
        '  <th class="w-8">#</th>',
        '  <th>Team</th>',
        '  <th class="text-center">W</th>',
        '  <th class="text-center">L</th>',
        '  <th class="text-center hidden sm:table-cell">PF</th>',
        '  <th class="text-center hidden sm:table-cell">PA</th>',
        '  <th class="text-center hidden md:table-cell">+/-</th>',
        '</tr></thead>',
        '<tbody>'
      ].join('\n');

      standings.forEach(function (row) {
        var tName = teamName(row.TeamID, teamsMap);
        var diff  = row.PointDiff >= 0 ? '+' + row.PointDiff : String(row.PointDiff);
        var diffClass = row.PointDiff >= 0 ? 'text-success' : 'text-error';
        html += [
          '<tr class="hover standings-row cursor-pointer" data-team-id="' + esc(row.TeamID) + '">',
          '  <td class="font-bold text-base-content/40">' + esc(row.Rank) + '</td>',
          '  <td class="font-medium">' + esc(tName) + '</td>',
          '  <td class="text-center font-bold text-success">' + esc(row.Wins) + '</td>',
          '  <td class="text-center font-bold text-error">'   + esc(row.Losses) + '</td>',
          '  <td class="text-center hidden sm:table-cell">'   + esc(row.PointsFor) + '</td>',
          '  <td class="text-center hidden sm:table-cell">'   + esc(row.PointsAgainst) + '</td>',
          '  <td class="text-center hidden md:table-cell ' + diffClass + '">' + diff + '</td>',
          '</tr>'
        ].join('\n');
      });

      html += '</tbody></table></div>';
      el.innerHTML = html;
    },

    /**
     * Render the recent-games panel (overview card — up to 3 rounds).
     * @param {Object[]} games
     * @param {Object}   teamsMap
     * @param {boolean}  isAdmin
     */
    renderRecentGames: function (games, teamsMap, isAdmin) {
      var el = document.getElementById('recent-games');
      if (!el) return;
      el.innerHTML = gamesListHTML(games, teamsMap, isAdmin, 3);
    },

    /**
     * Render all games (all rounds).
     * @param {Object[]} games
     * @param {Object}   teamsMap
     * @param {boolean}  isAdmin
     */
    renderAllGames: function (games, teamsMap, isAdmin) {
      var el = document.getElementById('all-games');
      if (!el) return;
      el.innerHTML = gamesListHTML(games, teamsMap, isAdmin, null);
    },

    /**
     * Render the admin editable teams table.
     * @param {Object[]} tournamentTeams – editable draft array (from App.state)
     * @param {Object[]} schools         – all available schools
     */
    renderAdminTeamsTable: function (tournamentTeams, schools) {
      var el = document.getElementById('teams-table-body');
      if (!el) return;
      if (!tournamentTeams || !tournamentTeams.length) {
        el.innerHTML = '<tr><td colspan="5" class="text-center text-base-content/50 py-4">No teams yet — click "+ Row" to add</td></tr>';
        return;
      }

      var schoolOptions = '<option value="">Select School</option>';
      schools.forEach(function (s) {
        schoolOptions += '<option value="' + esc(s.SchoolID) + '">' + esc(s.SchoolName) + ' (' + esc(s.Level) + ')</option>';
      });

      var html = '';
      tournamentTeams.forEach(function (team, idx) {
        html += [
          '<tr data-team-idx="' + idx + '">',
          '  <td>',
          '    <select class="select select-bordered select-sm w-full team-school-select" data-idx="' + idx + '">',
          schoolOptions.replace('value="' + team.SchoolID + '"', 'value="' + team.SchoolID + '" selected'),
          '    </select>',
          '  </td>',
          '  <td>',
          '    <input class="input input-bordered input-sm w-full team-name-input" data-idx="' + idx + '"',
          '           value="' + esc(team.TeamName) + '" placeholder="Team Name" />',
          '  </td>',
          '  <td>',
          '    <input class="input input-bordered input-sm w-20 team-label-input" data-idx="' + idx + '"',
          '           value="' + esc(team.TeamLabel) + '" placeholder="A/B/C" />',
          '  </td>',
          '  <td class="hidden md:table-cell">',
          '    <input class="input input-bordered input-sm w-full team-coach-input" data-idx="' + idx + '"',
          '           value="' + esc(team.CoachName) + '" placeholder="Coach Name" />',
          '  </td>',
          '  <td>',
          '    <button class="btn btn-xs btn-ghost text-error remove-team-row-btn" data-idx="' + idx + '">✕</button>',
          '  </td>',
          '</tr>'
        ].join('\n');
      });
      el.innerHTML = html;
    },

    /**
     * Render the schools management table inside the admin panel Schools tab.
     * Supports inline editing of a single row.
     * @param {Object[]} schools    — full school list
     * @param {string}   editingId  — SchoolID open for inline edit ('' = none)
     */
    renderSchoolsAdminTable: function (schools, editingId) {
      var el = document.getElementById('admin-schools-tbody');
      if (!el) return;

      /* read filter controls from DOM */
      var filterLevel  = (document.getElementById('school-filter-level')   || {}).value  || '';
      var showInactive = !!(document.getElementById('school-show-inactive') || {}).checked;

      var visible = (schools || []).filter(function (s) {
        if (!showInactive && !s.IsActive) return false;
        if (filterLevel && s.Level !== filterLevel) return false;
        return true;
      });

      if (!visible.length) {
        el.innerHTML = '<tr><td colspan="6" class="text-center text-base-content/50 py-6">No schools found</td></tr>';
        return;
      }

      var html = '';
      visible.forEach(function (s) {
        var sid = esc(s.SchoolID);
        if (String(s.SchoolID) === String(editingId)) {
          /* ── edit row ── */
          html += '<tr class="bg-base-200" data-school-id="' + sid + '">'
            + '<td><input class="input input-xs input-bordered w-full school-edit-name" value="' + esc(s.SchoolName) + '" /></td>'
            + '<td><input class="input input-xs input-bordered w-full school-edit-short" value="' + esc(s.SchoolShortName) + '" /></td>'
            + '<td><select class="select select-xs select-bordered w-full school-edit-level">'
            + '<option' + (s.Level === 'Elementary' ? ' selected' : '') + '>Elementary</option>'
            + '<option' + (s.Level === 'Middle'      ? ' selected' : '') + '>Middle</option>'
            + '<option' + (s.Level === 'High'        ? ' selected' : '') + '>High</option>'
            + '</select></td>'
            + '<td><input class="input input-xs input-bordered w-full school-edit-logo" placeholder="Logo URL" value="' + esc(s.LogoURL || '') + '" /></td>'
            + '<td class="text-center">' + (s.IsActive ? '<span class="badge badge-success badge-sm">Yes</span>' : '<span class="badge badge-ghost badge-sm">No</span>') + '</td>'
            + '<td class="whitespace-nowrap">'
            + '<button class="btn btn-xs btn-primary mr-1 school-save-btn" data-school-id="' + sid + '">Save</button>'
            + '<button class="btn btn-xs btn-ghost school-cancel-btn">✕ Cancel</button>'
            + '</td>'
            + '</tr>';
        } else {
          /* ── view row ── */
          var rowCls      = s.IsActive ? '' : ' opacity-40';
          var activeBadge = s.IsActive
            ? '<span class="badge badge-success badge-sm">Yes</span>'
            : '<span class="badge badge-ghost badge-sm">No</span>';
          var toggleLabel = s.IsActive ? 'Deactivate' : 'Reactivate';
          var toggleCls   = s.IsActive ? 'btn-warning' : 'btn-success';
          html += '<tr class="' + rowCls + '" data-school-id="' + sid + '">'
            + '<td class="font-medium">' + esc(s.SchoolName) + '</td>'
            + '<td class="text-base-content/70">' + esc(s.SchoolShortName) + '</td>'
            + '<td><span class="badge badge-sm badge-outline">' + esc(s.Level) + '</span></td>'
            + '<td class="text-xs text-base-content/50 max-w-xs truncate">' + esc(s.LogoURL || '—') + '</td>'
            + '<td class="text-center">' + activeBadge + '</td>'
            + '<td class="whitespace-nowrap">'
            + '<button class="btn btn-xs btn-ghost mr-1 school-edit-btn" data-school-id="' + sid + '" title="Edit">✏</button>'
            + '<button class="btn btn-xs ' + toggleCls + ' school-toggle-btn" data-school-id="' + sid + '">' + toggleLabel + '</button>'
            + '</td>'
            + '</tr>';
        }
      });
      el.innerHTML = html;
    },

    /**
     * Populate the <select> options inside the Edit Game modal.
     * @param {Object[]} teams
     * @param {string}   currentA
     * @param {string}   currentB
     */
    populateEditGameSelects: function (teams, currentA, currentB) {
      var baseOpts = '<option value="">— unassigned —</option>';
      teams.forEach(function (t) {
        baseOpts += '<option value="' + esc(t.TeamID) + '">' + esc(t.TeamName) + '</option>';
      });

      var elA = document.getElementById('edit-game-teamA');
      var elB = document.getElementById('edit-game-teamB');
      if (elA) elA.innerHTML = baseOpts.replace('value="' + currentA + '"', 'value="' + currentA + '" selected');
      if (elB) elB.innerHTML = baseOpts.replace('value="' + currentB + '"', 'value="' + currentB + '" selected');
    },

    /* ── Alerts ──────────────────────────────────────────────── */

    /**
     * Show a toast notification.
     * @param {string} message
     * @param {'success'|'error'|'info'|'warning'} [type='info']
     */
    showAlert: function (message, type) {
      var area = document.getElementById('alert-area');
      if (!area) return;
      var cssType = {
        success: 'alert-success',
        error:   'alert-error',
        warning: 'alert-warning',
        info:    'alert-info'
      }[type || 'info'] || 'alert-info';

      var toast = document.createElement('div');
      toast.className = 'alert ' + cssType + ' shadow-lg animate-slide-down text-sm';
      toast.innerHTML = '<span>' + esc(message) + '</span>';
      area.appendChild(toast);
      setTimeout(function () {
        toast.classList.add('opacity-0', 'transition-opacity', 'duration-300');
        setTimeout(function () { toast.remove(); }, 350);
      }, 4000);
    },

    /* ── Loading overlay ─────────────────────────────────────── */

    /**
     * Show or hide the full-screen loading overlay.
     * @param {boolean} visible
     */
    showLoading: function (visible) {
      var el = document.getElementById('loading-overlay');
      if (!el) return;
      if (visible) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    },

    /* ── Tab helpers ─────────────────────────────────────────── */

    /**
     * Activate a named tab inside the admin panel.
     * @param {'teams'|'schedule'|'actions'} tabName
     */
    setAdminTab: function (tabName) {
      var tabs     = document.querySelectorAll('[data-admin-tab]');
      var contents = ['teams', 'schedule', 'actions', 'schools'];

      tabs.forEach(function (tab) {
        if (tab.dataset.adminTab === tabName) {
          tab.classList.add('tab-active');
        } else {
          tab.classList.remove('tab-active');
        }
      });

      contents.forEach(function (name) {
        var el = document.getElementById('admin-tab-' + name);
        if (el) {
          el.classList.toggle('hidden', name !== tabName);
        }
      });
    },

    /**
     * Activate a named main-content view.
     * @param {'overview'|'standings'|'games'} viewName
     */
    setView: function (viewName) {
      var views  = ['overview', 'standings', 'games'];
      var tabs   = document.querySelectorAll('[data-view]');

      tabs.forEach(function (tab) {
        if (tab.dataset.view === viewName) {
          tab.classList.add('tab-active');
        } else {
          tab.classList.remove('tab-active');
        }
      });

      views.forEach(function (name) {
        var el = document.getElementById('view-' + name);
        if (el) {
          el.classList.toggle('hidden', name !== viewName);
        }
      });
    },

    /* ── Utility ─────────────────────────────────────────────── */

    /** Build and return a { TeamID → team } lookup map. */
    buildTeamsMap: buildTeamsMap
  };

}());
