/**
 * api.js — Business Logic Layer
 *
 * Sits on top of DB (the DAL).  All application-level operations live here.
 * No DOM access — purely data.
 *
 * Mirrors the original Google Apps Script API surface:
 *   listSchools / createSchool / deleteSchool
 *   listTournaments / getTournament / createTournament /
 *     setTournamentStatus / updateTournamentPublic / deleteTournament
 *   listTeams / setParticipants / addAllSchoolsByLevel
 *   listGames / saveScore / updateGameTeams
 *   generateSchedule
 *   getStandings / rebuildStandings
 *   seedSampleData
 */

var API = (function () {

  /* ── private helpers ─────────────────────────────────────────── */

  /** Generate a unique ID with a given prefix using crypto.randomUUID. */
  function newId(prefix) {
    var uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    return prefix + '_' + uuid.slice(0, 12);
  }

  /** ISO-8601 timestamp for "now". */
  function now() {
    return new Date().toISOString();
  }

  /**
   * Round-robin schedule generator (Berger circle method).
   * Produces N-1 rounds for N teams, adding a BYE if N is odd.
   * Returns an array of game objects (not yet written to DB).
   */
  function generateRoundRobin(teams, tournamentId, stageName) {
    var teamList = teams.slice();
    var n = teamList.length;

    /* add a BYE slot when team count is odd */
    if (n % 2 !== 0) {
      teamList.push({ TeamID: 'BYE', TeamName: 'BYE' });
      n++;
    }

    var totalRounds = n - 1;
    var gamesPerRound = n / 2;
    var games = [];
    var gameNumber = 1;

    for (var round = 1; round <= totalRounds; round++) {
      for (var i = 0; i < gamesPerRound; i++) {
        var teamA = teamList[i];
        var teamB = teamList[n - 1 - i];
        games.push({
          GameID:        newId('G'),
          TournamentID:  tournamentId,
          Stage:         stageName,
          RoundNumber:   round,
          GameLabel:     stageName + ' R' + round + ' G' + gameNumber,
          TeamA_ID:      teamA.TeamID,
          TeamB_ID:      teamB.TeamID
        });
        gameNumber++;
      }
      /* rotate (keep index 0 fixed, rotate the rest clockwise) */
      if (round < totalRounds) {
        var last = teamList.pop();
        teamList.splice(1, 0, last);
      }
    }
    return games;
  }

  /**
   * Elementary schedule generator: max 3 rounds, circle method, no repeated matchups.
   * One team gets a standing BYE if team count is odd.
   * Returns game objects with Stage='GROUP'.
   */
  function generateElementarySchedule(teams, tournamentId) {
    var games = [];
    var teamList = teams.slice();
    var numTeams = teamList.length;
    var maxRounds = 3;
    var byeTeamId = null;

    if (numTeams % 2 !== 0) {
      var randomIndex = Math.floor(Math.random() * numTeams);
      byeTeamId = teamList[randomIndex].TeamID;
      teamList.splice(randomIndex, 1);
      numTeams = teamList.length;
    }

    for (var round = 1; round <= maxRounds; round++) {
      if (byeTeamId) {
        games.push({
          GameID: newId('G'), TournamentID: tournamentId, Stage: 'GROUP',
          RoundNumber: round,
          GameLabel: 'GROUP R' + round + ' G' + (games.length + 1),
          TeamA_ID: byeTeamId, TeamB_ID: 'BYE'
        });
      }
      for (var i = 0; i < numTeams / 2; i++) {
        var teamA = teamList[i];
        var teamB = teamList[numTeams - 1 - i];
        games.push({
          GameID: newId('G'), TournamentID: tournamentId, Stage: 'GROUP',
          RoundNumber: round,
          GameLabel: 'GROUP R' + round + ' G' + (games.length + 1),
          TeamA_ID: teamA.TeamID, TeamB_ID: teamB.TeamID
        });
      }
      if (round < maxRounds) {
        var lastTeam = teamList.pop();
        teamList.splice(1, 0, lastTeam);
      }
    }
    return games;
  }

  /**
   * Backtracking: tries to pair all teamIds into non-repeat pairs for a round.
   * Returns array of [teamA, teamB] pairs, or null if impossible.
   */
  function findRoundPairs(teamIds, usedPairs) {
    if (teamIds.length === 0) return [];
    var pivotTeam = teamIds[0];
    for (var p = 1; p < teamIds.length; p++) {
      var partner = teamIds[p];
      var pairKey = [pivotTeam, partner].sort().join('-');
      if (usedPairs[pairKey]) continue;
      var remaining = [];
      for (var r = 0; r < teamIds.length; r++) {
        if (r !== 0 && r !== p) remaining.push(teamIds[r]);
      }
      var subPairs = findRoundPairs(remaining, usedPairs);
      if (subPairs !== null) {
        subPairs.unshift([pivotTeam, partner]);
        return subPairs;
      }
    }
    return null;
  }

  /**
   * Auto-fill remaining GROUP games (ELEMENTARY_GROUP_BRACKET, 3-round cap).
   * Respects customMatchups already placed (avoids re-using those pairs).
   * Uses backtracking first, then greedy fallback.
   */
  function autoGenerateRemainingGames(teams, tournamentId, customMatchups, usedTeams, startGameNumber) {
    var games = [];
    var teamList = teams.slice();
    var numTeams = teamList.length;
    var maxRounds = 3;
    var byeTeamId = null;

    if (numTeams % 2 !== 0) {
      var ri = Math.floor(Math.random() * numTeams);
      byeTeamId = teamList[ri].TeamID;
      teamList.splice(ri, 1);
      numTeams = teamList.length;
    }

    /* build set of already-used pairs */
    var usedPairs = {};
    customMatchups = customMatchups || [];
    for (var m = 0; m < customMatchups.length; m++) {
      var mu = customMatchups[m];
      if (mu.TeamA_ID && mu.TeamB_ID &&
          String(mu.TeamA_ID) !== 'BYE' && String(mu.TeamB_ID) !== 'BYE') {
        usedPairs[[mu.TeamA_ID, mu.TeamB_ID].sort().join('-')] = true;
      }
    }

    /* normalize per-round usage from manual matchups */
    var roundUsedMap = {};
    for (var rk in usedTeams) {
      if (!usedTeams.hasOwnProperty(rk)) continue;
      var rn = Number(rk);
      roundUsedMap[rn] = roundUsedMap[rn] || {};
      var urt = usedTeams[rk] || {};
      for (var tid in urt) {
        if (urt.hasOwnProperty(tid) && String(tid) !== 'BYE') {
          roundUsedMap[rn][tid] = true;
        }
      }
    }

    for (var round = 1; round <= maxRounds; round++) {
      roundUsedMap[round] = roundUsedMap[round] || {};

      if (byeTeamId && !roundUsedMap[round][byeTeamId]) {
        games.push({
          GameID: newId('G'), TournamentID: tournamentId, Stage: 'GROUP',
          RoundNumber: round,
          GameLabel: 'GROUP R' + round + ' G' + (startGameNumber + games.length + 1),
          TeamA_ID: byeTeamId, TeamB_ID: 'BYE'
        });
        roundUsedMap[round][byeTeamId] = true;
      }

      var availableIds = teamList
        .map(function(t) { return t.TeamID; })
        .filter(function(id) { return !roundUsedMap[round][id]; });

      var roundPairs = findRoundPairs(availableIds, usedPairs);
      if (!roundPairs) {
        /* greedy fallback */
        roundPairs = [];
        var avail = availableIds.slice();
        while (avail.length >= 2) {
          var aId = avail[0];
          var partnerIdx = -1;
          for (var gi = 1; gi < avail.length; gi++) {
            var gk = [aId, avail[gi]].sort().join('-');
            if (!usedPairs[gk]) { partnerIdx = gi; break; }
          }
          if (partnerIdx === -1) { avail.shift(); continue; }
          var bId = avail[partnerIdx];
          roundPairs.push([aId, bId]);
          avail = avail.filter(function(id) { return id !== aId && id !== bId; });
        }
      }

      for (var pi = 0; pi < roundPairs.length; pi++) {
        var pair = roundPairs[pi];
        var pk = [pair[0], pair[1]].sort().join('-');
        if (usedPairs[pk]) continue;
        games.push({
          GameID: newId('G'), TournamentID: tournamentId, Stage: 'GROUP',
          RoundNumber: round,
          GameLabel: 'GROUP R' + round + ' G' + (startGameNumber + games.length + 1),
          TeamA_ID: pair[0], TeamB_ID: pair[1]
        });
        usedPairs[pk] = true;
        roundUsedMap[round][pair[0]] = true;
        roundUsedMap[round][pair[1]] = true;
      }
    }
    return games;
  }

  /**
   * Auto-fill remaining ROUND_ROBIN games respecting already-placed custom matchups.
   * Generates a full circle-method template, then slots each game into the earliest
   * available round (both teams free, round not full).  Overflow → extra rounds.
   */
  function autoGenerateRoundRobin(teams, tournamentId, stageName, customMatchups, usedTeams, startGameNumber) {
    var games = [];
    var teamList = teams.slice();
    var numTeams = teamList.length;
    var hasOdd = numTeams % 2 !== 0;

    var usedPairs = {};
    customMatchups = customMatchups || [];
    for (var m = 0; m < customMatchups.length; m++) {
      var mu = customMatchups[m];
      if (mu.TeamA_ID && mu.TeamB_ID) {
        usedPairs[[mu.TeamA_ID, mu.TeamB_ID].sort().join('-')] = true;
      }
    }

    if (hasOdd) { teamList.push({ TeamID: 'BYE', TeamName: 'BYE' }); numTeams++; }

    var totalRounds  = numTeams - 1;
    var gamesPerRound = numTeams / 2;

    /* build full template via circle method */
    var tpl = teamList.slice();
    var templateGames = [];
    for (var tr = 1; tr <= totalRounds; tr++) {
      for (var i = 0; i < numTeams / 2; i++) {
        var tA = tpl[i], tB = tpl[numTeams - 1 - i];
        templateGames.push({
          RoundNumber: tr, TeamA_ID: tA.TeamID, TeamB_ID: tB.TeamID,
          PairKey: [tA.TeamID, tB.TeamID].sort().join('-')
        });
      }
      if (tr < totalRounds) { var tLast = tpl.pop(); tpl.splice(1, 0, tLast); }
    }

    /* track per-round usage from custom matchups */
    var roundUsedMap = {}, roundGameCount = {};
    for (var r = 1; r <= totalRounds; r++) { roundUsedMap[r] = {}; roundGameCount[r] = 0; }

    for (var ek in usedTeams) {
      if (!usedTeams.hasOwnProperty(ek)) continue;
      var ern = Number(ek);
      if (!roundUsedMap[ern]) { roundUsedMap[ern] = {}; roundGameCount[ern] = 0; }
      var eIds = Object.keys(usedTeams[ek]);
      for (var u = 0; u < eIds.length; u++) {
        if (eIds[u] !== 'BYE') roundUsedMap[ern][eIds[u]] = true;
      }
    }
    for (var cm = 0; cm < customMatchups.length; cm++) {
      var cr = Number(customMatchups[cm].RoundNumber || 1);
      if (!roundGameCount[cr]) roundGameCount[cr] = 0;
      roundGameCount[cr]++;
    }

    var pending = templateGames.filter(function(tg) { return !usedPairs[tg.PairKey]; });

    for (var p = 0; p < pending.length; p++) {
      var gtp = pending[p];
      var placed = false;
      var candidates = [gtp.RoundNumber];
      for (var rr = 1; rr <= totalRounds; rr++) {
        if (rr !== gtp.RoundNumber) candidates.push(rr);
      }

      for (var c = 0; c < candidates.length; c++) {
        var tr2 = candidates[c];
        if (!roundUsedMap[tr2]) { roundUsedMap[tr2] = {}; roundGameCount[tr2] = 0; }
        var aId = gtp.TeamA_ID, bId = gtp.TeamB_ID;
        var aBusy = aId !== 'BYE' && !!roundUsedMap[tr2][aId];
        var bBusy = bId !== 'BYE' && !!roundUsedMap[tr2][bId];
        if (!aBusy && !bBusy && roundGameCount[tr2] < gamesPerRound) {
          games.push({
            GameID: newId('G'), TournamentID: tournamentId, Stage: stageName,
            RoundNumber: tr2,
            GameLabel: stageName + ' R' + tr2 + ' G' + (startGameNumber + games.length + 1),
            TeamA_ID: aId, TeamB_ID: bId
          });
          usedPairs[gtp.PairKey] = true;
          if (aId !== 'BYE') roundUsedMap[tr2][aId] = true;
          if (bId !== 'BYE') roundUsedMap[tr2][bId] = true;
          roundGameCount[tr2]++;
          placed = true;
          break;
        }
      }

      if (!placed) {
        /* overflow to extra rounds */
        var xr = totalRounds + 1;
        for (;;) {
          if (!roundUsedMap[xr]) { roundUsedMap[xr] = {}; roundGameCount[xr] = 0; }
          var xA = gtp.TeamA_ID, xB = gtp.TeamB_ID;
          var xABusy = xA !== 'BYE' && !!roundUsedMap[xr][xA];
          var xBBusy = xB !== 'BYE' && !!roundUsedMap[xr][xB];
          if (!xABusy && !xBBusy) {
            games.push({
              GameID: newId('G'), TournamentID: tournamentId, Stage: stageName,
              RoundNumber: xr,
              GameLabel: stageName + ' R' + xr + ' G' + (startGameNumber + games.length + 1),
              TeamA_ID: xA, TeamB_ID: xB
            });
            usedPairs[gtp.PairKey] = true;
            if (xA !== 'BYE') roundUsedMap[xr][xA] = true;
            if (xB !== 'BYE') roundUsedMap[xr][xB] = true;
            roundGameCount[xr]++;
            break;
          }
          xr++;
        }
      }
    }
    return games;
  }

  /**
   * Mark all BYE games in a tournament as complete.
   * The real team is the winner; scores are left at 0-0.
   */
  function markByeGamesComplete(tournamentId) {
    var ts = now();
    DB.run(
      "UPDATE Games SET IsComplete=1, WinnerTeamID=TeamA_ID, ScoreA='0', ScoreB='0', UpdatedAt=? WHERE TournamentID=? AND TeamB_ID='BYE' AND IsComplete=0",
      [ts, tournamentId]
    );
    DB.run(
      "UPDATE Games SET IsComplete=1, WinnerTeamID=TeamB_ID, ScoreA='0', ScoreB='0', UpdatedAt=? WHERE TournamentID=? AND TeamA_ID='BYE' AND IsComplete=0",
      [ts, tournamentId]
    );
  }

  /**
   * After a bracket game is saved, auto-populate the next-round teams
   * from the winners of the completed feeder games.
   * Handles both 8-team (QF→SF→Final) and 4-team (SF→Final) brackets.
   */
  function advanceBracketWinners(tournamentId) {
    var bGames = DB.query(
      "SELECT * FROM Games WHERE TournamentID = ? AND Stage IN ('QF','SF','FINAL')",
      [tournamentId]
    );
    function byLabel(lbl) {
      return bGames.filter(function(g){ return g.GameLabel === lbl; })[0] || null;
    }
    var sfs  = bGames.filter(function(g){ return g.Stage === 'SF'; })
                     .sort(function(a,b){ return a.GameLabel.localeCompare(b.GameLabel); });
    var fin  = bGames.filter(function(g){ return g.Stage === 'FINAL'; })[0] || null;
    var sf1  = sfs[0] || null;
    var sf2  = sfs[1] || null;
    /* QF → SF (8-team) */
    var qf1 = byLabel('QF 1'), qf2 = byLabel('QF 2');
    var qf3 = byLabel('QF 3'), qf4 = byLabel('QF 4');
    if (qf1 && qf2 && sf1 && qf1.IsComplete && qf2.IsComplete && qf1.WinnerTeamID && qf2.WinnerTeamID) {
      DB.run('UPDATE Games SET TeamA_ID=?, TeamB_ID=?, UpdatedAt=? WHERE GameID=?',
        [qf1.WinnerTeamID, qf2.WinnerTeamID, now(), sf1.GameID]);
    }
    if (qf3 && qf4 && sf2 && qf3.IsComplete && qf4.IsComplete && qf3.WinnerTeamID && qf4.WinnerTeamID) {
      DB.run('UPDATE Games SET TeamA_ID=?, TeamB_ID=?, UpdatedAt=? WHERE GameID=?',
        [qf3.WinnerTeamID, qf4.WinnerTeamID, now(), sf2.GameID]);
    }
    /* SF → Final */
    if (sf1 && sf2 && fin) {
      var sf1f = DB.queryOne('SELECT * FROM Games WHERE GameID=?', [sf1.GameID]);
      var sf2f = DB.queryOne('SELECT * FROM Games WHERE GameID=?', [sf2.GameID]);
      if (sf1f && sf2f && sf1f.IsComplete && sf2f.IsComplete && sf1f.WinnerTeamID && sf2f.WinnerTeamID) {
        DB.run('UPDATE Games SET TeamA_ID=?, TeamB_ID=?, UpdatedAt=? WHERE GameID=?',
          [sf1f.WinnerTeamID, sf2f.WinnerTeamID, now(), fin.GameID]);
      }
    }
  }

  /* ── public API ──────────────────────────────────────────────── */
  return {

    /* ────────────────── SCHOOLS ────────────────── */

    /**
     * Return all schools, optionally only active ones.
     * @param {boolean} [activeOnly=true]
     */
    listSchools: function (activeOnly) {
      if (activeOnly === undefined) activeOnly = true;
      if (activeOnly) {
        return DB.query('SELECT * FROM Schools WHERE IsActive = 1 ORDER BY Level, SchoolName');
      }
      return DB.query('SELECT * FROM Schools ORDER BY Level, SchoolName');
    },

    /** Create a new school record. */
    createSchool: function (data) {
      if (!data || !data.SchoolName) throw new Error('School name is required');
      var id = newId('SCH');
      DB.run(
        'INSERT INTO Schools (SchoolID, SchoolName, SchoolShortName, Level, LogoURL, IsActive) VALUES (?,?,?,?,?,?)',
        [id, data.SchoolName.trim(), data.SchoolShortName || '', data.Level || 'Elementary', data.LogoURL || '', 1]
      );
      return DB.queryOne('SELECT * FROM Schools WHERE SchoolID = ?', [id]);
    },

    /** Soft-delete (deactivate) a school. */
    deleteSchool: function (schoolId) {
      DB.run('UPDATE Schools SET IsActive = 0 WHERE SchoolID = ?', [schoolId]);
    },

    /** Update name / short name / level / logo / active status of an existing school. */
    updateSchool: function (schoolId, patch) {
      if (!schoolId) throw new Error('School ID required');
      var sets = [], vals = [];
      if (patch.SchoolName      !== undefined) { sets.push('SchoolName = ?');      vals.push(String(patch.SchoolName).trim()); }
      if (patch.SchoolShortName !== undefined) { sets.push('SchoolShortName = ?'); vals.push(patch.SchoolShortName || ''); }
      if (patch.Level           !== undefined) { sets.push('Level = ?');           vals.push(patch.Level); }
      if (patch.LogoURL         !== undefined) { sets.push('LogoURL = ?');         vals.push(patch.LogoURL || ''); }
      if (patch.IsActive        !== undefined) { sets.push('IsActive = ?');        vals.push(patch.IsActive ? 1 : 0); }
      if (!sets.length) return;
      vals.push(schoolId);
      DB.run('UPDATE Schools SET ' + sets.join(', ') + ' WHERE SchoolID = ?', vals);
      return DB.queryOne('SELECT * FROM Schools WHERE SchoolID = ?', [schoolId]);
    },

    /* ────────────────── TOURNAMENTS ────────────────── */

    /**
     * List tournaments.
     * @param {boolean} [includeAll=false] – when false only ACTIVE + PublicVisible=1
     */
    listTournaments: function (includeAll) {
      if (includeAll) {
        return DB.query('SELECT * FROM Tournaments ORDER BY SeasonYear DESC, TournamentName');
      }
      return DB.query(
        "SELECT * FROM Tournaments WHERE Status = 'ACTIVE' AND PublicVisible = 1 ORDER BY SeasonYear DESC, TournamentName"
      );
    },

    /** Fetch a single tournament by ID. */
    getTournament: function (id) {
      return DB.queryOne('SELECT * FROM Tournaments WHERE TournamentID = ?', [id]);
    },

    /** Create a new tournament and return it. */
    createTournament: function (data) {
      if (!data || !data.TournamentName) throw new Error('Tournament name is required');
      var id = newId('T');
      var n  = now();
      DB.run(
        'INSERT INTO Tournaments (TournamentID, TournamentName, Sport, Level, Format, SeasonYear, Status, PublicVisible, Notes, CreatedAt, UpdatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [
          id,
          data.TournamentName.trim(),
          data.Sport || '',
          data.Level || 'Elementary',
          data.Format || 'ROUND_ROBIN',
          data.SeasonYear || new Date().getFullYear(),
          data.Status  || 'DRAFT',
          data.PublicVisible ? 1 : 0,
          data.Notes || '',
          n, n
        ]
      );
      return DB.queryOne('SELECT * FROM Tournaments WHERE TournamentID = ?', [id]);
    },

    /** Change a tournament's Status field. */
    setTournamentStatus: function (id, status) {
      DB.run('UPDATE Tournaments SET Status = ?, UpdatedAt = ? WHERE TournamentID = ?', [status, now(), id]);
      return DB.queryOne('SELECT * FROM Tournaments WHERE TournamentID = ?', [id]);
    },

    /** Toggle the PublicVisible flag. */
    toggleTournamentPublic: function (id) {
      var t = DB.queryOne('SELECT PublicVisible FROM Tournaments WHERE TournamentID = ?', [id]);
      if (!t) return;
      var next = t.PublicVisible ? 0 : 1;
      DB.run('UPDATE Tournaments SET PublicVisible = ?, UpdatedAt = ? WHERE TournamentID = ?', [next, now(), id]);
      return DB.queryOne('SELECT * FROM Tournaments WHERE TournamentID = ?', [id]);
    },

    /**
     * Delete a tournament and all related rows
     * (Teams, Games, Standings for that tournament).
     */
    deleteTournament: function (id) {
      DB.run('DELETE FROM TournamentTeams WHERE TournamentID = ?', [id]);
      DB.run('DELETE FROM Games        WHERE TournamentID = ?', [id]);
      DB.run('DELETE FROM Standings    WHERE TournamentID = ?', [id]);
      DB.run('DELETE FROM Tournaments  WHERE TournamentID = ?', [id]);
      return { deleted: true };
    },

    /* ────────────────── TEAMS ────────────────── */

    /** Return all active teams for a tournament. */
    listTeams: function (tournamentId) {
      return DB.query(
        'SELECT * FROM TournamentTeams WHERE TournamentID = ? AND IsActive = 1 ORDER BY TeamName',
        [tournamentId]
      );
    },

    /**
     * Replace all teams for a tournament with the provided list.
     * Teams without a TeamID get a new one assigned.
     */
    setParticipants: function (tournamentId, teams) {
      DB.run('DELETE FROM TournamentTeams WHERE TournamentID = ?', [tournamentId]);
      teams.forEach(function (team) {
        var tid = (team.TeamID && team.TeamID.trim()) ? team.TeamID : newId('TEAM');
        DB.run(
          'INSERT OR REPLACE INTO TournamentTeams (TeamID, TournamentID, SchoolID, TeamName, TeamLabel, CoachName, CoachEmail, IsActive) VALUES (?,?,?,?,?,?,?,?)',
          [tid, tournamentId, team.SchoolID || '', team.TeamName || '', team.TeamLabel || '', team.CoachName || '', team.CoachEmail || '', 1]
        );
      });
      API.rebuildStandings(tournamentId);
      return API.listTeams(tournamentId);
    },

    /**
     * Add all active schools that match the tournament's Level and are not
     * already participating.  Returns { added, total }.
     */
    addAllSchoolsByLevel: function (tournamentId) {
      var tournament = API.getTournament(tournamentId);
      if (!tournament) throw new Error('Tournament not found: ' + tournamentId);

      var schools  = DB.query('SELECT * FROM Schools WHERE Level = ? AND IsActive = 1', [tournament.Level]);
      var existing = API.listTeams(tournamentId);
      var existingIds = {};
      existing.forEach(function (t) { existingIds[t.SchoolID] = true; });

      var added = 0;
      schools.forEach(function (school) {
        if (!existingIds[school.SchoolID]) {
          DB.run(
            'INSERT INTO TournamentTeams (TeamID, TournamentID, SchoolID, TeamName, TeamLabel, CoachName, CoachEmail, IsActive) VALUES (?,?,?,?,?,?,?,?)',
            [newId('TEAM'), tournamentId, school.SchoolID, school.SchoolName, '', '', '', 1]
          );
          added++;
        }
      });

      API.rebuildStandings(tournamentId);
      return { added: added, total: existing.length + added };
    },

    /* ────────────────── GAMES ────────────────── */

    /**
     * Return all games for a tournament, sorted by
     * Stage order → RoundNumber → GameLabel.
     */
    listGames: function (tournamentId) {
      return DB.query([
        'SELECT * FROM Games WHERE TournamentID = ?',
        'ORDER BY',
        "  CASE Stage WHEN 'GROUP' THEN 1 WHEN 'ROUND_ROBIN' THEN 2 WHEN 'QF' THEN 3 WHEN 'SF' THEN 4 WHEN 'FINAL' THEN 5 ELSE 9 END,",
        '  RoundNumber, GameLabel'
      ].join(' '), [tournamentId]);
    },

    /**
     * Save a score for a game.  Marks the game IsComplete=1 and sets WinnerTeamID.
     * Then rebuilds standings for the game's tournament.
     */
    saveScore: function (gameId, scoreA, scoreB) {
      var game = DB.queryOne('SELECT * FROM Games WHERE GameID = ?', [gameId]);
      if (!game) throw new Error('Game not found: ' + gameId);

      var a = Number(scoreA);
      var b = Number(scoreB);
      if (a === b) throw new Error('Ties are not allowed — scores must be different.');
      var winner = a > b ? game.TeamA_ID : (b > a ? game.TeamB_ID : '');

      DB.run(
        'UPDATE Games SET ScoreA = ?, ScoreB = ?, WinnerTeamID = ?, IsComplete = 1, UpdatedAt = ? WHERE GameID = ?',
        [String(a), String(b), winner, now(), gameId]
      );

      API.rebuildStandings(game.TournamentID);
      /* auto-advance bracket if this was a bracket-stage game */
      if (game.Stage === 'QF' || game.Stage === 'SF' || game.Stage === 'FINAL') {
        advanceBracketWinners(game.TournamentID);
      }
      return DB.queryOne('SELECT * FROM Games WHERE GameID = ?', [gameId]);
    },

    /** Change the two teams assigned to a game. */
    updateGameTeams: function (gameId, teamA_Id, teamB_Id) {
      DB.run(
        'UPDATE Games SET TeamA_ID = ?, TeamB_ID = ?, UpdatedAt = ? WHERE GameID = ?',
        [teamA_Id, teamB_Id, now(), gameId]
      );
      var game = DB.queryOne('SELECT * FROM Games WHERE GameID = ?', [gameId]);
      if (game) API.rebuildStandings(game.TournamentID);
      return game;
    },

    /* ────────────────── SCHEDULE ────────────────── */

    /**
     * Auto-generate a round-robin (or elementary group) schedule.
     * Deletes existing GROUP / ROUND_ROBIN games first.
     * Requires ≥ 2 active teams.
     */
    generateSchedule: function (tournamentId) {
      var tournament = API.getTournament(tournamentId);
      if (!tournament) throw new Error('Tournament not found: ' + tournamentId);

      var teams = API.listTeams(tournamentId);
      if (teams.length < 2) throw new Error('At least 2 active teams are required');

      /* remove old games for this stage */
      DB.run(
        "DELETE FROM Games WHERE TournamentID = ? AND (Stage = 'ROUND_ROBIN' OR Stage = 'GROUP')",
        [tournamentId]
      );

      var stageName = tournament.Format === 'ELEMENTARY_GROUP_BRACKET' ? 'GROUP' : 'ROUND_ROBIN';
      var games;
      if (tournament.Format === 'ELEMENTARY_GROUP_BRACKET') {
        games = generateElementarySchedule(teams, tournamentId);
      } else {
        games = generateRoundRobin(teams, tournamentId, stageName);
      }

      games.forEach(function (g) {
        DB.run(
          'INSERT INTO Games (GameID, TournamentID, Stage, RoundNumber, GameLabel, TeamA_ID, TeamB_ID, ScoreA, ScoreB, WinnerTeamID, Location, GameTimeLabel, IsComplete, CreatedAt, UpdatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [g.GameID, g.TournamentID, g.Stage, g.RoundNumber, g.GameLabel, g.TeamA_ID, g.TeamB_ID, '', '', '', '', '', 0, now(), now()]
        );
      });

      API.rebuildStandings(tournamentId);
      return { createdGames: games.length, stage: stageName };
    },

    /**
     * Create a schedule from manual matchups, optionally auto-filling remaining games.
     * @param {string} tournamentId
     * @param {Array}  customMatchups  [{RoundNumber, TeamA_ID, TeamB_ID}]
     * @param {boolean} autoGenerate   if true, fill remaining rounds automatically
     */
    createCustomSchedule: function (tournamentId, customMatchups, autoGenerate) {
      var tournament = API.getTournament(tournamentId);
      if (!tournament) throw new Error('Tournament not found: ' + tournamentId);

      var teams = API.listTeams(tournamentId);
      if (teams.length < 2) throw new Error('At least 2 active teams are required.');

      var stageName = tournament.Format === 'ELEMENTARY_GROUP_BRACKET' ? 'GROUP' : 'ROUND_ROBIN';
      var games    = [];
      var usedTeams = {};

      customMatchups = customMatchups || [];
      for (var i = 0; i < customMatchups.length; i++) {
        var mu = customMatchups[i];
        if (mu.TeamA_ID && mu.TeamB_ID && mu.TeamA_ID !== mu.TeamB_ID) {
          games.push({
            GameID: newId('G'), TournamentID: tournamentId, Stage: stageName,
            RoundNumber: mu.RoundNumber || 1,
            GameLabel: stageName + ' R' + (mu.RoundNumber || 1) + ' G' + (i + 1),
            TeamA_ID: mu.TeamA_ID, TeamB_ID: mu.TeamB_ID
          });
          var rk = mu.RoundNumber || 1;
          if (!usedTeams[rk]) usedTeams[rk] = {};
          usedTeams[rk][mu.TeamA_ID] = true;
          usedTeams[rk][mu.TeamB_ID] = true;
        }
      }

      if (autoGenerate) {
        if (tournament.Format === 'ELEMENTARY_GROUP_BRACKET') {
          games = games.concat(autoGenerateRemainingGames(teams, tournamentId, customMatchups, usedTeams, games.length));
        } else {
          games = games.concat(autoGenerateRoundRobin(teams, tournamentId, stageName, customMatchups, usedTeams, games.length));
        }
      }

      DB.run(
        "DELETE FROM Games WHERE TournamentID = ? AND (Stage = 'ROUND_ROBIN' OR Stage = 'GROUP')",
        [tournamentId]
      );
      games.forEach(function (g) {
        DB.run(
          'INSERT INTO Games (GameID, TournamentID, Stage, RoundNumber, GameLabel, TeamA_ID, TeamB_ID, ScoreA, ScoreB, WinnerTeamID, Location, GameTimeLabel, IsComplete, CreatedAt, UpdatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [g.GameID, g.TournamentID, g.Stage, g.RoundNumber, g.GameLabel, g.TeamA_ID, g.TeamB_ID, '', '', '', '', '', 0, now(), now()]
        );
      });

      API.rebuildStandings(tournamentId);
      return { createdGames: games.length, stage: stageName };
    },

    /**
     * Generate the knockout bracket (SF + Final) for an ELEMENTARY_GROUP_BRACKET tournament.
     * Seeds top-4 from standings: seed1 vs seed4, seed2 vs seed3 → Final.
     * @param {string}  tournamentId
     * @param {boolean} [force=false]  skip the "all group games complete" check
     */
    generateBracket: function (tournamentId, force) {
      var tournament = API.getTournament(tournamentId);
      if (!tournament) throw new Error('Tournament not found: ' + tournamentId);
      if (tournament.Format !== 'ELEMENTARY_GROUP_BRACKET') {
        throw new Error('Bracket generation is only for ELEMENTARY_GROUP_BRACKET tournaments.');
      }

      if (!force) {
        /* auto-complete any BYE games so they don't block bracket generation */
        markByeGamesComplete(tournamentId);
        var groupGames = DB.query(
          "SELECT * FROM Games WHERE TournamentID = ? AND Stage = 'GROUP'",
          [tournamentId]
        );
        var incomplete = groupGames.filter(function (g) {
          return !g.IsComplete && g.TeamA_ID !== 'BYE' && g.TeamB_ID !== 'BYE';
        });
        if (incomplete.length) {
          throw new Error('All group-stage games must be complete before generating the bracket. (' + incomplete.length + ' remaining)');
        }
      }

      var stg = API.rebuildStandings(tournamentId);
      if (stg.length < 4) throw new Error('Need at least 4 teams to generate the bracket.');

      var games = [];

      if (stg.length >= 8) {
        /* ── 8-team bracket: QF → SF → Final ── */
        /* Seeding: 1v8, 4v5, 2v7, 3v6 */
        var qf1 = { GameID: newId('G'), TournamentID: tournamentId, Stage: 'QF', RoundNumber: 1, GameLabel: 'QF 1', TeamA_ID: stg[0].TeamID, TeamB_ID: stg[7].TeamID };
        var qf2 = { GameID: newId('G'), TournamentID: tournamentId, Stage: 'QF', RoundNumber: 1, GameLabel: 'QF 2', TeamA_ID: stg[3].TeamID, TeamB_ID: stg[4].TeamID };
        var qf3 = { GameID: newId('G'), TournamentID: tournamentId, Stage: 'QF', RoundNumber: 1, GameLabel: 'QF 3', TeamA_ID: stg[1].TeamID, TeamB_ID: stg[6].TeamID };
        var qf4 = { GameID: newId('G'), TournamentID: tournamentId, Stage: 'QF', RoundNumber: 1, GameLabel: 'QF 4', TeamA_ID: stg[2].TeamID, TeamB_ID: stg[5].TeamID };
        var sf1 = { GameID: newId('G'), TournamentID: tournamentId, Stage: 'SF', RoundNumber: 2, GameLabel: 'SF 1 (W-QF1 vs W-QF2)', TeamA_ID: '', TeamB_ID: '' };
        var sf2 = { GameID: newId('G'), TournamentID: tournamentId, Stage: 'SF', RoundNumber: 2, GameLabel: 'SF 2 (W-QF3 vs W-QF4)', TeamA_ID: '', TeamB_ID: '' };
        var fin = { GameID: newId('G'), TournamentID: tournamentId, Stage: 'FINAL', RoundNumber: 3, GameLabel: 'Final', TeamA_ID: '', TeamB_ID: '' };
        games = [qf1, qf2, qf3, qf4, sf1, sf2, fin];
      } else {
        /* ── 4-team bracket: SF → Final ── */
        /* Seeding: 1v4, 2v3 */
        var sf1 = { GameID: newId('G'), TournamentID: tournamentId, Stage: 'SF', RoundNumber: 1, GameLabel: 'SF 1', TeamA_ID: stg[0].TeamID, TeamB_ID: stg[3] ? stg[3].TeamID : '' };
        var sf2 = { GameID: newId('G'), TournamentID: tournamentId, Stage: 'SF', RoundNumber: 1, GameLabel: 'SF 2', TeamA_ID: stg[1].TeamID, TeamB_ID: stg[2] ? stg[2].TeamID : '' };
        var fin = { GameID: newId('G'), TournamentID: tournamentId, Stage: 'FINAL', RoundNumber: 2, GameLabel: 'Final', TeamA_ID: '', TeamB_ID: '' };
        games = [sf1, sf2, fin];
      }

      DB.run("DELETE FROM Games WHERE TournamentID = ? AND Stage IN ('QF','SF','FINAL')", [tournamentId]);

      games.forEach(function (g) {
        DB.run(
          'INSERT INTO Games (GameID, TournamentID, Stage, RoundNumber, GameLabel, TeamA_ID, TeamB_ID, ScoreA, ScoreB, WinnerTeamID, Location, GameTimeLabel, IsComplete, CreatedAt, UpdatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [g.GameID, g.TournamentID, g.Stage, g.RoundNumber, g.GameLabel, g.TeamA_ID, g.TeamB_ID, '', '', '', '', '', 0, now(), now()]
        );
      });

      return { createdGames: games.length, hasQF: stg.length >= 8 };
    },

    /** Mark all BYE games in a tournament as complete (exposed for admin use). */
    markByeGamesComplete: function (tournamentId) {
      markByeGamesComplete(tournamentId);
    },

    /* ────────────────── STANDINGS ────────────────── */

    /**
     * Retrieve standings for a tournament (auto-rebuilds if empty).
     */
    getStandings: function (tournamentId) {
      var standings = DB.query(
        'SELECT * FROM Standings WHERE TournamentID = ? ORDER BY Rank',
        [tournamentId]
      );
      if (!standings.length) {
        return API.rebuildStandings(tournamentId);
      }
      return standings;
    },

    /**
     * Recalculate standings from completed GROUP / ROUND_ROBIN games
     * and persist them.  Returns the new standings array.
     */
    rebuildStandings: function (tournamentId) {
      var teams = API.listTeams(tournamentId);
      var stats = {};
      var n     = now();

      teams.forEach(function (team) {
        stats[team.TeamID] = {
          TournamentID:  tournamentId,
          TeamID:        team.TeamID,
          Wins:          0,
          Losses:        0,
          PointsFor:     0,
          PointsAgainst: 0,
          PointDiff:     0,
          Rank:          0,
          LastUpdatedAt: n
        };
      });

      var completedGames = DB.query(
        "SELECT * FROM Games WHERE TournamentID = ? AND IsComplete = 1 AND (Stage = 'GROUP' OR Stage = 'ROUND_ROBIN')",
        [tournamentId]
      );

      completedGames.forEach(function (game) {
        var sA = stats[game.TeamA_ID];
        var sB = stats[game.TeamB_ID];
        if (!sA || !sB) return;

        var a = Number(game.ScoreA || 0);
        var b = Number(game.ScoreB || 0);

        sA.PointsFor     += a;
        sA.PointsAgainst += b;
        sB.PointsFor     += b;
        sB.PointsAgainst += a;

        if (a > b) {
          sA.Wins++;
          sB.Losses++;
        } else if (b > a) {
          sB.Wins++;
          sA.Losses++;
        }
      });

      /* compute PointDiff and sort: wins desc → pointDiff desc → pointsFor desc */
      var rows = Object.keys(stats).map(function (k) { return stats[k]; });
      rows.forEach(function (r) { r.PointDiff = r.PointsFor - r.PointsAgainst; });
      rows.sort(function (a, b) {
        if (b.Wins !== a.Wins)           return b.Wins - a.Wins;
        if (b.PointDiff !== a.PointDiff) return b.PointDiff - a.PointDiff;
        return b.PointsFor - a.PointsFor;
      });
      rows.forEach(function (r, i) { r.Rank = i + 1; });

      /* persist */
      DB.run('DELETE FROM Standings WHERE TournamentID = ?', [tournamentId]);
      rows.forEach(function (r) {
        DB.run(
          'INSERT INTO Standings (TournamentID, TeamID, Wins, Losses, PointsFor, PointsAgainst, PointDiff, Rank, LastUpdatedAt) VALUES (?,?,?,?,?,?,?,?,?)',
          [r.TournamentID, r.TeamID, r.Wins, r.Losses, r.PointsFor, r.PointsAgainst, r.PointDiff, r.Rank, r.LastUpdatedAt]
        );
      });

      return DB.query('SELECT * FROM Standings WHERE TournamentID = ? ORDER BY Rank', [tournamentId]);
    },

    /* ────────────────── SEED DATA ───────────────── */

    /* ─────────────────── SPORTS LIST ─────────────────── */

    /**
     * Return the admin-configured list of sports.
     * Stored in localStorage as a JSON array; falls back to a default set.
     */
    listSports: function () {
      var SPORTS_KEY = 'cdElop26_sports_v1';
      try {
        var stored = localStorage.getItem(SPORTS_KEY);
        if (stored) return JSON.parse(stored);
      } catch (e) {}
      return ['Basketball', 'Volleyball', 'Soccer', 'Baseball', 'Softball', 'Badminton', 'Table Tennis', 'Flag Football'];
    },

    /**
     * Persist the sports list to localStorage.
     */
    saveSports: function (arr) {
      localStorage.setItem('cdElop26_sports_v1', JSON.stringify(arr));
    },

    /**
     * Seed sample schools on a fresh database.
     * Only runs when the Schools table is empty.
     */
    seedSampleData: function () {
      var count = DB.queryOne('SELECT COUNT(*) AS c FROM Schools');
      if (count && count.c > 0) return; /* already seeded */

      /* ── ASES district schools (from schools.csv) ── */
      var schools = [
        /* Elementary */
        { name: 'Cesar Chavez',           short: 'CC',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/CC_logo@3x_1749069437.png'    },
        { name: 'Coral Mountain',         short: 'CMA', level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/CMA_logo@3x_1749069438.png'   },
        { name: 'John Kelley',            short: 'JK',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/JK_logo@3x_1749069439.png'    },
        { name: 'Las Palmitas',           short: 'LP',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/canva_93356.png'               },
        { name: 'Mecca',                  short: 'MA',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/M_logo@3x_1749069440.png'     },
        { name: 'Mountain Vista',         short: 'MV',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/MV_logo@3x_1749069206.png'    },
        { name: 'Oasis',                  short: 'OA',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/O_logo@3x_1749069440.png'     },
        { name: 'Palm View',              short: 'PV',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/PV_logo@2x_1749069441.png'    },
        { name: 'Peter Pendleton',        short: 'PP',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/PP_logo@2x_1749069441.png'    },
        { name: 'Saul Martinez',          short: 'SM',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/SM_logo@2x_1749069441.png'    },
        { name: 'Sea View',               short: 'SV',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/SV_logo@3x_1749069441.png'    },
        { name: 'Valle del Sol',          short: 'VDS', level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/VDS_logo@3x_1749069448.png'   },
        { name: 'Valley View',            short: 'VV',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/VV_logoSq4_1749069208.png'    },
        { name: 'Westside',               short: 'WS',  level: 'Elementary', logo: 'https://files.smartsites.parentsquare.com/9154/W_logo@3x_1749069208.png'     },
        /* Middle */
        { name: 'Bobby Duke',             short: 'BD',  level: 'Middle',     logo: 'https://files.smartsites.parentsquare.com/9154/BB_logo@3x_1749069437.png'    },
        { name: 'Cahuilla Desert Academy',short: 'CDA', level: 'Middle',     logo: 'https://files.smartsites.parentsquare.com/9154/CDA_logo@3x_1749069203.png'   },
        { name: 'Toro Canyon',            short: 'TC',  level: 'Middle',     logo: 'https://files.smartsites.parentsquare.com/9154/TC_logo@3x_1749069442.png'    },
        { name: 'West Shores',            short: 'WSH', level: 'Middle',     logo: ''                                                                             }
      ];

      schools.forEach(function (s) {
        DB.run(
          'INSERT INTO Schools (SchoolID, SchoolName, SchoolShortName, Level, LogoURL, IsActive) VALUES (?,?,?,?,?,?)',
          [newId('SCH'), s.name, s.short, s.level, s.logo || '', 1]
        );
      });
    }
  };

}());
