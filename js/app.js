/**
 * app.js — Vue 3 Application (Composition API)
 *
 * Architecture:
 *   DB     → sql.js WASM SQLite data layer
 *   API    → business logic / data access
 *   AUTH   → session management
 *   Vue 3  → reactive UI (this file)
 *
 * Components:
 *   game-row   — a single game card (score display / scoring inputs)
 *   Root app   — full application controller
 */

(function () {
  'use strict';

  const { createApp, ref, reactive, computed, watch, onMounted } = Vue;

  /* ────────────────────────────────────────────────────────────
   * GameRow component
   * Props:  game, teamsMap, isAdmin, scoreEdits
   * Emits:  save-score(game), edit-game(game)
   * ────────────────────────────────────────────────────────── */
  const GameRow = {
    props: {
      game:         { type: Object,  required: true },
      teamsMap:     { type: Object,  required: true },
      isAdmin:      { type: Boolean, default: false },
      canScore:     { type: Boolean, default: false },
      scoreEdits:   { type: Object,  required: true },
      showLocation: { type: Boolean, default: false }
    },
    emits: ['save-score', 'edit-game', 'open-school'],
    template: `
      <div class="game-card" :class="{'game-card-complete': game.IsComplete}">

        <!-- Playoff label -->
        <div v-if="game.Stage === 'SF' || game.Stage === 'FINAL'" class="game-stage-badge">
          {{ game.GameLabel }}
        </div>

        <div class="game-matchup">

          <!-- ── Team A ── -->
          <div class="game-team-col"
               :style="game.TeamA_ID && game.TeamA_ID !== 'BYE' ? 'cursor:pointer' : ''"
               @click="game.TeamA_ID && game.TeamA_ID !== 'BYE' && $emit('open-school', game.TeamA_ID)"
               :class="{ 'team-col-winner': game.IsComplete && numA > numB,
                         'team-col-loser':  game.IsComplete && numA < numB }">
            <div class="team-logo-wrap">
              <img v-if="logoA" :src="logoA" class="team-logo-lg" loading="lazy"
                   :alt="nameA" @error="$event.target.style.display='none'" />
              <div v-else class="team-logo-fallback">{{ nameA.charAt(0) }}</div>
            </div>
            <span class="game-team-nm">{{ nameA }}</span>
          </div>

          <!-- ── Center score ── -->
          <div class="game-center">
            <!-- Admin edit inputs -->
            <template v-if="canScore && !isBye && scoreEdits[game.GameID]">
              <div class="score-edit-row">
                <input type="number" v-model="scoreEdits[game.GameID].a"
                       class="score-input-lg" min="0" />
                <span class="score-divider">—</span>
                <input type="number" v-model="scoreEdits[game.GameID].b"
                       class="score-input-lg" min="0" />
              </div>
              <button @click="$emit('save-score', game)" class="btn btn-success btn-xs mt-1" :disabled="isTied">Save</button>
              <div v-if="isTied" class="tie-warning">No ties allowed</div>
            </template>
            <!-- Completed score display -->
            <div v-else-if="game.IsComplete" class="score-final">
              <span class="score-num" :class="numA > numB ? 'score-win' : numA < numB ? 'score-loss' : ''">
                {{ game.ScoreA }}
              </span>
              <span class="score-divider">—</span>
              <span class="score-num" :class="numB > numA ? 'score-win' : numB < numA ? 'score-loss' : ''">
                {{ game.ScoreB }}
              </span>
            </div>
            <!-- Pending -->
            <div v-else class="score-pending">VS</div>
            <!-- Admin edit-teams button -->
            <button v-if="isAdmin" @click="$emit('edit-game', game)"
              class="btn btn-ghost btn-xs" title="Edit teams" style="color:#9ca3af">Edit</button>
          </div>

          <!-- ── Team B ── -->
          <div class="game-team-col"
               :style="game.TeamB_ID && game.TeamB_ID !== 'BYE' ? 'cursor:pointer' : ''"
               @click="game.TeamB_ID && game.TeamB_ID !== 'BYE' && $emit('open-school', game.TeamB_ID)"
               :class="{ 'team-col-winner': game.IsComplete && numB > numA,
                         'team-col-loser':  game.IsComplete && numB < numA }">
            <div class="team-logo-wrap">
              <img v-if="logoB" :src="logoB" class="team-logo-lg" loading="lazy"
                   :alt="nameB" @error="$event.target.style.display='none'" />
              <div v-else class="team-logo-fallback">{{ nameB.charAt(0) }}</div>
            </div>
            <span class="game-team-nm">{{ nameB }}</span>
          </div>

        </div>
        <div v-if="game.Location" class="game-location">📍 {{ game.Location }}</div>
      </div>
    `,
    computed: {
      numA()   { return Number(this.game.ScoreA || 0); },
      numB()   { return Number(this.game.ScoreB || 0); },
      isBye()  { return this.game.TeamA_ID === 'BYE' || this.game.TeamB_ID === 'BYE'; },
      nameA()  { return this._name(this.game.TeamA_ID); },
      nameB()  { return this._name(this.game.TeamB_ID); },
      logoA()  { const t = this.teamsMap[this.game.TeamA_ID]; return t && t.logoUrl ? t.logoUrl : ''; },
      logoB()  { const t = this.teamsMap[this.game.TeamB_ID]; return t && t.logoUrl ? t.logoUrl : ''; },
      isTied() {
        const e = this.scoreEdits && this.scoreEdits[this.game.GameID];
        if (!e) return false;
        const a = String(e.a === undefined ? '' : e.a).trim();
        const b = String(e.b === undefined ? '' : e.b).trim();
        return a !== '' && b !== '' && !isNaN(Number(a)) && !isNaN(Number(b)) && Number(a) === Number(b);
      },
      displayScore() {
        const a = (this.game.ScoreA !== '' && this.game.ScoreA !== null) ? this.game.ScoreA : '—';
        const b = (this.game.ScoreB !== '' && this.game.ScoreB !== null) ? this.game.ScoreB : '—';
        return a + ' : ' + b;
      }
    },
    methods: {
      _name(id) {
        if (id === 'BYE') return 'BYE';
        if (!id) return 'TBD';
        const t = this.teamsMap[id];
        return t ? t.TeamName : id;
      }
    }
  };

  /* ────────────────────────────────────────────────────────────
   * Root application
   * ────────────────────────────────────────────────────────── */
  const app = createApp({
    setup() {

      /* ── Static config ──────────────────────────────────── */
      const adminTabs = [
        { key: 'teams',    label: '1 · Teams'    },
        { key: 'schedule', label: '2 · Schedule' },
        { key: 'actions',  label: '3 · Settings' }
      ];
      const viewTabs = [
        { key: 'overview',  label: 'Overview'  },
        { key: 'standings', label: 'Standings' },
        { key: 'games',     label: 'Group Games' },
        { key: 'bracket',   label: 'Bracket' }
      ];

      /* ── Reactive state ─────────────────────────────────── */
      const loading            = ref(false);
      const toasts             = ref([]);
      const isAdmin            = ref(false);
      const viewMode           = ref('public');   // 'admin' | 'public'
      const selectedTournamentId = ref('');
      const tournaments        = ref([]);
      const teams              = ref([]);
      const games              = ref([]);
      const standings          = ref([]);
      const schools            = ref([]);
      const tournamentTeams    = ref([]);         // admin editable draft
      const currentView        = ref('overview');
      const adminTab           = ref('teams');
      const appTab             = ref('schools');   // 'schools' | 'sports' | 'users'
      const showAppSettings    = ref(false);
      const showCreateForm     = ref(false);
      const bulkMode           = ref(false);
      const showLoginModal     = ref(false);
      const schoolsEditingId   = ref('');
      const showMatchBuilder   = ref(false);
      const matchBuilderRounds = ref([]);

      /* sports list */
      const sports         = ref([]);
      const newSportName   = ref('');

      /* admin users */
      const adminUsers     = ref([]);
      const newAdminUser   = reactive({ username: '', password: '', display: '', role: 'admin' });

      /* scorer role */
      const isScorer       = ref(false);   // score-entry-only session

      /* bracket seeding edits keyed by GameID */
      const bracketEdits   = reactive({});

      /* overview phase filter */
      const overviewPhase  = ref('');  // '' = group/rr, 'QF', 'SF', 'FINAL'

      /* school detail page */
      const viewingTeamId  = ref('');   // TeamID of the school being viewed

      /* can enter scores: admins in admin-view OR scorer role */
      const canScoreGames  = computed(() => isAdminView.value || isScorer.value);

      /* form models */
      const newT = reactive({
        name: '', sport: '', year: new Date().getFullYear(),
        level: 'Elementary', format: 'ROUND_ROBIN', public: false, notes: ''
      });
      const loginForm  = reactive({ username: '', password: '', error: '', showPw: false });
      const newSchool  = reactive({ name: '', short: '', level: 'Elementary', logo: '' });
      const editSchool = reactive({ name: '', short: '', level: 'Elementary', logo: '' });
      const schoolFilter = reactive({ level: '', showInactive: false });
      const editModal  = reactive({ show: false, gameId: '', teamA: '', teamB: '', location: '' });

      /* score edit state keyed by GameID */
      const scoreEdits = reactive({});

      /* ── Computed ───────────────────────────────────────── */
      const isAdminView = computed(() => isAdmin.value && viewMode.value === 'admin');

      const schoolsMap = computed(() => {
        const map = {};
        schools.value.forEach(s => { map[s.SchoolID] = s; });
        return map;
      });

      /* enriched teams map: each entry has all team fields + logoUrl resolved from school */
      const teamsMap = computed(() => {
        const map = {};
        teams.value.forEach(t => {
          const sid = t.SchoolID ? String(t.SchoolID).trim() : '';
          const school = sid ? (schoolsMap.value[sid] || schools.value.find(s => String(s.SchoolID).trim() === sid)) : null;
          const schoolLogo = school ? (school.LogoURL || school.LogoUrl || school.logoUrl || '') : '';
          const teamLogo = t.LogoURL || t.LogoUrl || t.logoUrl || '';
          const schoolLevel = school ? (school.Level || '') : '';
          map[t.TeamID] = { ...t, logoUrl: schoolLogo || teamLogo, schoolLevel };
        });
        return map;
      });

      const selectedTournament = computed(() => {
        if (!selectedTournamentId.value) return null;
        return API.getTournament(selectedTournamentId.value);
      });

      const filteredSchools = computed(() =>
        schools.value.filter(s => {
          if (schoolFilter.level && s.Level !== schoolFilter.level) return false;
          if (!schoolFilter.showInactive && !s.IsActive)             return false;
          return true;
        })
      );

      const hasData = computed(() => games.value.length > 0 || standings.value.length > 0);

      const activePage = computed(() => {
        const t = selectedTournament.value;
        const tournamentName = t ? t.TournamentName : 'Tournament';
        if (currentView.value === 'standings') {
          return {
            title: 'Standings',
            subtitle: 'Current rankings and performance for ' + tournamentName + '.'
          };
        }
        if (currentView.value === 'games') {
          return {
            title: 'Games',
            subtitle: 'Manage and review all group-stage games for ' + tournamentName + '.'
          };
        }
        if (currentView.value === 'bracket') {
          return {
            title: 'Bracket',
            subtitle: 'Single-elimination progression for ' + tournamentName + '.'
          };
        }
        return {
          title: 'Overview',
          subtitle: 'Quick snapshot of standings and recent activity for ' + tournamentName + '.'
        };
      });

      /* All active teams for the selected tournament (for match builder dropdowns) */
      const availableTeams = computed(() => teams.value.slice());

      /* Validation warnings across all match builder rounds */
      const validationWarnings = computed(() => {
        const warns = [];
        matchBuilderRounds.value.forEach(round => {
          round.matchups.forEach((matchup, idx) => {
            const errs = getMatchupErrors(matchup, round.roundNumber);
            if (errs.length) warns.push({ round: round.roundNumber, matchupIndex: idx, errors: errs });
          });
        });
        return warns;
      });

      const authDisplayName = computed(() => {
        const s = AUTH.getSession();
        return s ? (s.display || s.username) : '';
      });

      /* ── School detail page ─────────────────────────────── */
      const schoolPageTeam = computed(() =>
        viewingTeamId.value ? (teamsMap.value[viewingTeamId.value] || null) : null
      );
      const schoolPageRecord = computed(() =>
        viewingTeamId.value ? (standings.value.find(r => r.TeamID === viewingTeamId.value) || null) : null
      );
      const schoolPageGames = computed(() => {
        if (!viewingTeamId.value) return [];
        const tid = viewingTeamId.value;
        const stageOrder = { GROUP: 0, ROUND_ROBIN: 0, QF: 1, SF: 2, FINAL: 3 };
        return games.value
          .filter(g => g.TeamA_ID === tid || g.TeamB_ID === tid)
          .sort((a, b) => {
            const so = (stageOrder[a.Stage] ?? 9) - (stageOrder[b.Stage] ?? 9);
            if (so !== 0) return so;
            return (a.RoundNumber || 0) - (b.RoundNumber || 0);
          });
      });

      /* Games grouped by stage section for the school detail page */
      const schoolPageGameSections = computed(() => {
        const stageLabel = {
          GROUP: 'Group Stage', ROUND_ROBIN: 'Round Robin',
          QF: 'Quarterfinals', SF: 'Semifinals', FINAL: 'Final'
        };
        const sections = [];
        let currentStage = null;
        for (const g of schoolPageGames.value) {
          const label = stageLabel[g.Stage] || g.Stage || 'Games';
          if (g.Stage !== currentStage) {
            sections.push({ stage: g.Stage, label, games: [] });
            currentStage = g.Stage;
          }
          sections[sections.length - 1].games.push(g);
        }
        return sections;
      });
      function openSchoolPage(teamId) { viewingTeamId.value = teamId; }
      function closeSchoolPage()      { viewingTeamId.value = '';     }

      /* Group games list into [{ round, games[] }] sorted by round */
      function groupByRound(list) {
        const map = {};
        list.forEach(g => {
          const r = g.RoundNumber || 1;
          if (!map[r]) map[r] = [];
          map[r].push(g);
        });
        return Object.keys(map).map(Number).sort((a, b) => a - b)
          .map(r => ({ round: r, games: map[r] }));
      }

      const recentRounds = computed(() => groupByRound(games.value.filter(g => g.Stage === 'GROUP' || g.Stage === 'ROUND_ROBIN')).slice(0, 2));
      const allRounds    = computed(() => groupByRound(games.value.filter(g => g.Stage === 'GROUP' || g.Stage === 'ROUND_ROBIN')));

      /* bracket games split by stage */
      const bracketGames = computed(() => games.value.filter(g => g.Stage === 'QF' || g.Stage === 'SF' || g.Stage === 'FINAL'));
      const hasBracket   = computed(() => bracketGames.value.length > 0);

      /* Overview phase tabs: which stages actually have games */
      const overviewPhases = computed(() => {
        const stages = new Set(games.value.map(g => g.Stage));
        const tabs = [{ key: '', label: 'Group Stage' }];
        if (stages.has('QF'))    tabs.push({ key: 'QF',    label: 'Quarterfinals' });
        if (stages.has('SF'))    tabs.push({ key: 'SF',    label: 'Semifinals'    });
        if (stages.has('FINAL')) tabs.push({ key: 'FINAL', label: 'Final'         });
        return tabs;
      });

      /* Most advanced bracket stage currently in play (used to auto-select overview tab) */
      const latestOverviewPhase = computed(() => {
        const stageOrder = ['FINAL', 'SF', 'QF'];
        for (const stage of stageOrder) {
          if (games.value.some(g => g.Stage === stage)) return stage;
        }
        return '';
      });

      /* Label for the currently selected overview phase */
      const overviewPhaseLabel = computed(() => {
        const ph = overviewPhases.value.find(p => p.key === overviewPhase.value);
        return ph ? ph.label : 'Group Stage';
      });

      /* Flat list of games for the selected bracket phase (QF / SF / FINAL) */
      const overviewStageGames = computed(() => {
        const phase = overviewPhase.value;
        if (!phase) return [];
        return games.value.filter(g => g.Stage === phase)
          .sort((a, b) => a.GameLabel.localeCompare(b.GameLabel, undefined, { numeric: true }));
      });

      /* Games shown in the overview "recent" panel (group phase only) */
      const overviewRounds = computed(() => recentRounds.value);

      /* show-location flag for selected tournament */
      const showLocation = computed(() =>
        selectedTournamentId.value
          ? API.getShowLocation(selectedTournamentId.value)
          : false
      );

      /* Build structured bracket: { qf: [...], sf: [...], final: game|null } */
      const bracketTree = computed(() => {
        const qf    = bracketGames.value.filter(g => g.Stage === 'QF').sort((a, b) => a.GameLabel.localeCompare(b.GameLabel));
        const sf    = bracketGames.value.filter(g => g.Stage === 'SF').sort((a, b) => a.GameLabel.localeCompare(b.GameLabel));
        const final = bracketGames.value.find(g => g.Stage === 'FINAL') || null;
        return { qf, sf, final };
      });

      /* ── Watchers ───────────────────────────────────────── */

      /* Keep scoreEdits in sync whenever games list is refreshed */
      watch(games, (newGames) => {
        newGames.forEach(g => {
          scoreEdits[g.GameID] = {
            a: (g.ScoreA !== null && g.ScoreA !== '') ? g.ScoreA : '',
            b: (g.ScoreB !== null && g.ScoreB !== '') ? g.ScoreB : ''
          };
        });
      }, { immediate: true });

      /* Keep bracketEdits in sync whenever bracket games change */
      watch(bracketGames, (bGames) => {
        bGames.forEach(g => {
          bracketEdits[g.GameID] = {
            teamA: g.TeamA_ID || '',
            teamB: g.TeamB_ID || ''
          };
        });
      }, { immediate: true });

      /* ── Alert helper ───────────────────────────────────── */
      function showAlert(msg, type = 'info') {
        const id = Date.now() + Math.random();
        toasts.value.push({ id, message: msg, type });
        setTimeout(() => {
          const i = toasts.value.findIndex(t => t.id === id);
          if (i > -1) toasts.value.splice(i, 1);
        }, 3500);
      }

      /* ── Data loading ───────────────────────────────────── */
      async function loadData() {
        loading.value = true;
        try {
          tournaments.value = API.listTournaments(isAdminView.value);
          schools.value = API.listSchools(false); // always load for logos

          if (tournaments.value.length && !selectedTournamentId.value) {
            selectedTournamentId.value = String(tournaments.value[0].TournamentID);
            await loadTournamentData();
            overviewPhase.value = latestOverviewPhase.value;
          } else if (selectedTournamentId.value) {
            await loadTournamentData();
            overviewPhase.value = latestOverviewPhase.value;
          }
        } catch (e) {
          showAlert(e.message || String(e), 'error');
        } finally {
          loading.value = false;
        }
      }

      async function loadTournamentData() {
        if (!selectedTournamentId.value) return;
        try {
          teams.value     = API.listTeams(selectedTournamentId.value);
          games.value     = API.listGames(selectedTournamentId.value);
          standings.value = API.getStandings(selectedTournamentId.value);
          if (isAdminView.value) syncTeamsDraft();
        } catch (e) {
          showAlert(e.message || String(e), 'error');
        }
      }

      function syncTeamsDraft() {
        tournamentTeams.value = teams.value.map(t => ({
          TeamID:    t.TeamID,
          SchoolID:  t.SchoolID  || '',
          TeamName:  t.TeamName  || '',
          TeamLabel: t.TeamLabel || '',
          CoachName: t.CoachName || ''
        }));
      }

      function reloadSchools() { schools.value = API.listSchools(false); }

      /* ── Tournament details helper ──────────────────────────── */
      function formatLabel(t) {
        if (!t) return '';
        const fmt = t.Format === 'ELEMENTARY_GROUP_BRACKET' ? 'Group + Bracket' : 'Round Robin';
        return fmt;
      }

      function statusClass(status) {
        const s = (status || '').toUpperCase();
        if (s === 'ACTIVE')    return 'status-active';
        if (s === 'COMPLETED') return 'status-completed';
        return 'status-draft';
      }

      /* ── Team name helper ───────────────────────────────── */
      function teamNameFor(id) {
        if (!id || id === 'BYE') return 'BYE';
        const key = String(id).trim();
        const t = teamsMap.value[key] || teams.value.find(team => String(team.TeamID).trim() === key);
        return t ? t.TeamName : id;
      }

      function teamLogoFor(id) {
        if (!id || id === 'BYE') return '';

        const key = String(id).trim();
        const fromMap = teamsMap.value[key] || teamsMap.value[id];
        const team = fromMap || teams.value.find(t => String(t.TeamID).trim() === key);
        if (!team) return '';

        if (team.logoUrl) return team.logoUrl;
        if (team.LogoURL) return team.LogoURL;
        if (team.LogoUrl) return team.LogoUrl;

        const schoolId = team.SchoolID;
        if (!schoolId) return '';
        const schoolKey = String(schoolId).trim();
        const school = schoolsMap.value[schoolKey] || schools.value.find(s => String(s.SchoolID).trim() === schoolKey);
        if (!school) return '';
        return school.LogoURL || school.LogoUrl || school.logoUrl || '';
      }

      /* ── Tournament handlers ────────────────────────────── */
      async function onTournamentChange() {
        currentView.value = 'overview';
        if (selectedTournamentId.value) {
          await loadTournamentData();
          overviewPhase.value = latestOverviewPhase.value;
        } else {
          overviewPhase.value = '';
          teams.value = []; games.value = []; standings.value = [];
        }
      }

      function onToggleView() {
        viewMode.value = viewMode.value === 'admin' ? 'public' : 'admin';
        selectedTournamentId.value = '';
        loadData();
      }

      async function onCreate() {
        if (!newT.name.trim()) { showAlert('Tournament name is required', 'error'); return; }
        try {
          const created = API.createTournament({
            TournamentName: newT.name.trim(), Sport: newT.sport,
            SeasonYear:     Number(newT.year), Level: newT.level,
            Format:         newT.format, PublicVisible: newT.public, Notes: newT.notes
          });
          selectedTournamentId.value = String(created.TournamentID);
          showCreateForm.value = false;
          Object.assign(newT, { name: '', sport: '', year: new Date().getFullYear(), level: 'Elementary', format: 'ROUND_ROBIN', public: false, notes: '' });
          await loadData();
          showAlert('Tournament created!', 'success');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      /* ── Auth handlers ──────────────────────────────────── */
      function openLoginModal() {
        loginForm.username = ''; loginForm.password = '';
        loginForm.error = ''; loginForm.showPw = false;
        showLoginModal.value = true;
      }

      function onLoginSubmit() {
        loginForm.error = '';
        const result = AUTH.login(loginForm.username, loginForm.password);
        if (!result.ok) {
          loginForm.error = result.message;
          loginForm.password = '';
          return;
        }
        showLoginModal.value = false;
        if (result.role === 'scorer') {
          isScorer.value = true;
          viewMode.value = 'public';
          loadData().then(() =>
            showAlert('Welcome, ' + result.display + '! You are in Scorer mode.', 'success')
          );
        } else {
          isAdmin.value  = true;
          viewMode.value = 'admin';
          loadData().then(() =>
            showAlert('Welcome, ' + result.display + '! You are now in Admin mode.', 'success')
          );
        }
      }

      function onLogout() {
        AUTH.logout();
        isAdmin.value = false; isScorer.value = false; viewMode.value = 'public';
        selectedTournamentId.value = '';
        teams.value = []; games.value = []; standings.value = [];
        loadData().then(() => showAlert('Signed out successfully.', 'info'));
      }

      /* ── Teams tab handlers ─────────────────────────────── */
      function onAddTeamRow() {
        tournamentTeams.value.push({ TeamID: '', SchoolID: '', TeamName: '', TeamLabel: '', CoachName: '' });
      }

      function onRemoveTeamRow(idx) { tournamentTeams.value.splice(idx, 1); }

      async function onAddAllSchools() {
        if (!selectedTournamentId.value) return;
        try {
          const res = API.addAllSchoolsByLevel(selectedTournamentId.value);
          await loadTournamentData();
          showAlert('Added ' + res.added + ' schools. Total: ' + res.total, 'success');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      async function onSaveTeams() {
        if (!selectedTournamentId.value) return;
        try {
          API.setParticipants(selectedTournamentId.value, tournamentTeams.value);
          await loadTournamentData();
          showAlert('Teams saved!', 'success');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      /* ── Match builder helpers ──────────────────────────── */
      function isTeamInRound(teamId, roundNumber, excludeMatchup) {
        const round = matchBuilderRounds.value.find(r => r.roundNumber === roundNumber);
        if (!round) return false;
        return round.matchups.some(mu => {
          if (mu === excludeMatchup) return false;
          return mu.TeamA_ID === teamId || mu.TeamB_ID === teamId;
        });
      }

      function isDuplicateMatchup(teamA, teamB, roundNumber, excludeMatchup) {
        if (!teamA || !teamB) return false;
        const sortedNew = [teamA, teamB].sort().join('-');
        return matchBuilderRounds.value.some(round =>
          round.matchups.some(mu => {
            if (mu === excludeMatchup) return false;
            if (round.roundNumber === roundNumber) return false; // same-round dupe handled separately
            const sorted = [mu.TeamA_ID, mu.TeamB_ID].sort().join('-');
            return sorted === sortedNew;
          })
        );
      }

      function getMatchupErrors(matchup, roundNumber) {
        const errors = [];
        const { TeamA_ID: a, TeamB_ID: b } = matchup;
        if (!a || !b) return errors;
        if (a === b) { errors.push('Cannot match a team against itself'); return errors; }
        if (isTeamInRound(a, roundNumber, matchup)) {
          const t = teamsMap.value[a];
          errors.push((t ? t.TeamName : a) + ' is already in Round ' + roundNumber);
        }
        if (isTeamInRound(b, roundNumber, matchup)) {
          const t = teamsMap.value[b];
          errors.push((t ? t.TeamName : b) + ' is already in Round ' + roundNumber);
        }
        if (isDuplicateMatchup(a, b, roundNumber, matchup)) {
          errors.push('This matchup already exists in another round');
        }
        return errors;
      }

      function openMatchBuilder() {
        if (!availableTeams.value.length) { showAlert('Please add teams first', 'error'); return; }
        const t = selectedTournament.value;
        const numRounds = t && t.Format === 'ELEMENTARY_GROUP_BRACKET' ? 3 : 1;
        matchBuilderRounds.value = [];
        for (let i = 1; i <= numRounds; i++) {
          matchBuilderRounds.value.push({ roundNumber: i, matchups: [] });
        }
        showMatchBuilder.value = true;
      }

      function addMatchupSlot(round) {
        round.matchups.push({ TeamA_ID: '', TeamB_ID: '' });
      }

      function removeMatchup(round, index) {
        round.matchups.splice(index, 1);
      }

      async function saveCustomSchedule(autoGenerate) {
        const customMatchups = [];
        matchBuilderRounds.value.forEach(round => {
          round.matchups.forEach(mu => {
            if (mu.TeamA_ID && mu.TeamB_ID) {
              customMatchups.push({
                RoundNumber: round.roundNumber,
                TeamA_ID: mu.TeamA_ID,
                TeamB_ID: mu.TeamB_ID
              });
            }
          });
        });
        try {
          const res = API.createCustomSchedule(selectedTournamentId.value, customMatchups, autoGenerate);
          await loadTournamentData();
          showMatchBuilder.value = false;
          showAlert('Schedule saved — ' + res.createdGames + ' games (' + res.stage + ')', 'success');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      /* ── Schedule handler ───────────────────────────────── */
      async function onGenerateSchedule() {
        if (!selectedTournamentId.value) { showAlert('Select a tournament first', 'error'); return; }
        try {
          const res = API.generateSchedule(selectedTournamentId.value);
          await loadTournamentData();
          showAlert('Generated ' + res.createdGames + ' games (' + res.stage + ')', 'success');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      /* ── Generate bracket ───────────────────────────────── */
      async function onGenerateBracket(force) {
        if (!selectedTournamentId.value) return;
        try {
          const res = API.generateBracket(selectedTournamentId.value, !!force);
          await loadTournamentData();
          showAlert('Bracket generated — ' + res.createdGames + ' games created', 'success');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      /* ── Actions tab handlers ───────────────────────────── */
      async function onSetStatus(status) {
        if (!selectedTournamentId.value) return;
        try {
          API.setTournamentStatus(selectedTournamentId.value, status);
          await loadData();
          showAlert('Status set to ' + status, 'success');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      async function onTogglePublic() {
        if (!selectedTournamentId.value) return;
        try {
          const t = API.toggleTournamentPublic(selectedTournamentId.value);
          await loadData();
          showAlert('Tournament is now ' + (t.PublicVisible ? 'public' : 'private'), 'info');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      async function onRebuildStandings() {
        if (!selectedTournamentId.value) return;
        try {
          API.rebuildStandings(selectedTournamentId.value);
          await loadTournamentData();
          showAlert('Standings rebuilt', 'success');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      function onDownloadDb() {
        DB.download();
        showAlert('Downloading app.db — replace the file on disk to persist data across sessions', 'info');
      }

      async function onDeleteTournament() {
        if (!selectedTournamentId.value) return;
        if (!confirm('Delete this tournament and all its data? This cannot be undone.')) return;
        try {
          API.deleteTournament(selectedTournamentId.value);
          selectedTournamentId.value = '';
          teams.value = []; games.value = []; standings.value = [];
          await loadData();
          showAlert('Tournament deleted', 'info');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      /* ── Scoring handlers ───────────────────────────────── */
      async function onSaveScore(game) {
        const edit = scoreEdits[game.GameID];
        if (!edit) return;
        try {
          API.saveScore(game.GameID, edit.a, edit.b);
          await loadTournamentData();
          showAlert('Score saved', 'success');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      async function onSaveAllScores() {
        const groupGames = games.value.filter(g => g.Stage === 'GROUP' || g.Stage === 'ROUND_ROBIN');
        let saved = 0, ties = 0;
        const errors = [];
        for (const game of groupGames) {
          const edit = scoreEdits[game.GameID];
          if (!edit) continue;
          const aVal = String(edit.a).trim();
          const bVal = String(edit.b).trim();
          if (aVal === '' || bVal === '') continue;
          if (Number(aVal) === Number(bVal)) { ties++; continue; }
          try {
            API.saveScore(game.GameID, edit.a, edit.b);
            saved++;
          } catch (e) { errors.push(e.message || String(e)); }
        }
        if (saved > 0) {
          await loadTournamentData();
          showAlert(`Saved ${saved} score${saved !== 1 ? 's' : ''}`, 'success');
        } else if (!errors.length && !ties) {
          showAlert('No new scores to save', 'info');
        }
        if (ties) showAlert(`${ties} tied game${ties !== 1 ? 's' : ''} skipped — ties not allowed`, 'error');
        if (errors.length) showAlert(errors[0], 'error');
      }

      /* ── Edit game modal ────────────────────────────────── */
      function openEditGameModal(game) {
        editModal.show = true; editModal.gameId = game.GameID;
        editModal.teamA = game.TeamA_ID; editModal.teamB = game.TeamB_ID;
        editModal.location = game.Location || '';
      }

      async function onSaveGameTeams() {
        try {
          API.updateGameTeams(editModal.gameId, editModal.teamA, editModal.teamB, editModal.location);
          editModal.show = false;
          await loadTournamentData();
          showAlert('Game updated', 'success');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      /* ── Schools tab handlers ───────────────────────────── */
      function onGoToSchoolsTab() {
        if (showAppSettings.value && appTab.value === 'schools') {
          showAppSettings.value = false;
          return;
        }
        showAppSettings.value = true;
        appTab.value = 'schools';
        reloadSchools();
      }

      function startEditSchool(s) {
        schoolsEditingId.value = s.SchoolID;
        editSchool.name  = s.SchoolName;
        editSchool.short = s.SchoolShortName || '';
        editSchool.level = s.Level;
        editSchool.logo  = s.LogoURL || '';
      }

      function onCancelSchoolEdit() { schoolsEditingId.value = ''; }

      function onSaveSchoolEdit(s) {
        try {
          API.updateSchool(s.SchoolID, {
            SchoolName: editSchool.name, SchoolShortName: editSchool.short,
            Level: editSchool.level,     LogoURL: editSchool.logo
          });
          schoolsEditingId.value = '';
          reloadSchools();
          showAlert('School updated', 'success');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      function onToggleSchoolActive(s) {
        try {
          API.updateSchool(s.SchoolID, { IsActive: s.IsActive ? 0 : 1 });
          reloadSchools();
          showAlert(s.IsActive ? 'School deactivated' : 'School reactivated', 'info');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      function onAddSchool() {
        if (!newSchool.name.trim()) { showAlert('School name is required', 'error'); return; }
        try {
          API.createSchool({
            SchoolName: newSchool.name, SchoolShortName: newSchool.short,
            Level: newSchool.level, LogoURL: newSchool.logo
          });
          Object.assign(newSchool, { name: '', short: '', level: 'Elementary', logo: '' });
          reloadSchools();
          showAlert('School added', 'success');
        } catch (e) { showAlert(e.message || String(e), 'error'); }
      }

      /* ── Sports handlers ─────────────────────────────── */
      function loadSports() { sports.value = API.listSports(); }

      function onAddSport() {
        const name = newSportName.value.trim();
        if (!name) { showAlert('Enter a sport name', 'error'); return; }
        if (sports.value.includes(name)) { showAlert('Already in the list', 'error'); return; }
        const updated = [...sports.value, name];
        API.saveSports(updated);
        sports.value = updated;
        newSportName.value = '';
        showAlert('Sport added', 'success');
      }

      function onRemoveSport(idx) {
        const updated = sports.value.filter((_, i) => i !== idx);
        API.saveSports(updated);
        sports.value = updated;
      }

      /* ── Admin users handlers ────────────────────────── */
      function loadAdminUsers() { adminUsers.value = AUTH.listUsers(); }

      function onAddAdminUser() {
        const res = AUTH.addUser(newAdminUser.username, newAdminUser.password, newAdminUser.display, newAdminUser.role);
        if (!res.ok) { showAlert(res.message, 'error'); return; }
        Object.assign(newAdminUser, { username: '', password: '', display: '', role: 'admin' });
        loadAdminUsers();
        showAlert('User added', 'success');
      }

      function onRemoveAdminUser(username) {
        if (!confirm(`Remove admin user "${username}"?`)) return;
        const res = AUTH.removeUser(username);
        if (!res.ok) { showAlert(res.message, 'error'); return; }
        loadAdminUsers();
        showAlert('User removed', 'info');
      }

      /* ── Location visibility ───────────────────────────── */
      function onToggleShowLocation() {
        if (!selectedTournamentId.value) return;
        const current = API.getShowLocation(selectedTournamentId.value);
        API.setShowLocation(selectedTournamentId.value, !current);
        // force reactivity by reloading tournament data
        loadTournamentData();
      }

      /* ── Bracket seeding ────────────────────────────── */
      async function onSaveBracketSeeding() {
        let saved = 0;
        for (const game of bracketGames.value) {
          const edit = bracketEdits[game.GameID];
          if (!edit) continue;
          if (edit.teamA === game.TeamA_ID && edit.teamB === game.TeamB_ID) continue;
          try {
            API.updateGameTeams(game.GameID, edit.teamA, edit.teamB);
            saved++;
          } catch (e) { showAlert(e.message || String(e), 'error'); return; }
        }
        if (saved > 0) { await loadTournamentData(); showAlert('Bracket seeding saved', 'success'); }
        else showAlert('No changes to save', 'info');
      }

      /* ── Lifecycle ────────────────────────────────────── */
      onMounted(async () => {
        await DB.init();
        API.seedSampleData();
        loadSports();
        loadAdminUsers();
        const session = AUTH.getSession();
        if (session && session.role === 'admin') {
          isAdmin.value = true;
          viewMode.value = 'admin';
        } else if (session && session.role === 'scorer') {
          isScorer.value = true;
        }
        await loadData();
      });

      /* ── Expose to template ─────────────────────────────── */
      return {
        /* config */
        adminTabs, viewTabs,
        /* state */
        loading, toasts, isAdmin, isScorer, viewMode,
        selectedTournamentId, tournaments, teams, games, standings, schools,
        tournamentTeams, currentView, adminTab, appTab, showAppSettings,
        showCreateForm, bulkMode, showLoginModal, schoolsEditingId,
        editModal, newT, loginForm, newSchool, editSchool, schoolFilter, scoreEdits,
        sports, newSportName, bracketEdits,
        adminUsers, newAdminUser, overviewPhase, viewingTeamId,
        /* computed */
        isAdminView, canScoreGames, teamsMap, schoolsMap, selectedTournament, filteredSchools, hasData,
        activePage,
        authDisplayName, recentRounds, allRounds,
        bracketGames, hasBracket, bracketTree,
        overviewPhases, overviewPhaseLabel, overviewStageGames, overviewRounds, latestOverviewPhase, showLocation,
        availableTeams, validationWarnings,
        schoolPageTeam, schoolPageRecord, schoolPageGames, schoolPageGameSections,
        /* match builder */
        showMatchBuilder, matchBuilderRounds,
        openMatchBuilder, addMatchupSlot, removeMatchup,
        getMatchupErrors, saveCustomSchedule,
        /* methods */
        onTournamentChange, onToggleView, onCreate,
        openLoginModal, onLoginSubmit, onLogout,
        onAddTeamRow, onRemoveTeamRow, onAddAllSchools, onSaveTeams,
        onGenerateSchedule, onGenerateBracket,
        onSetStatus, onTogglePublic, onRebuildStandings, onDeleteTournament, onDownloadDb,
        onSaveScore, onSaveAllScores, openEditGameModal, onSaveGameTeams,
        onGoToSchoolsTab, startEditSchool, onCancelSchoolEdit, onSaveSchoolEdit,
        onToggleSchoolActive, onAddSchool,
        onAddSport, onRemoveSport, onSaveBracketSeeding,
        onAddAdminUser, onRemoveAdminUser, onToggleShowLocation,
        teamNameFor, teamLogoFor, formatLabel, statusClass,
        openSchoolPage, closeSchoolPage
      };
    }
  });

  app.component('game-row', GameRow);
  app.mount('#app');

})();
