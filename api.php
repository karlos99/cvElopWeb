<?php
/**
 * api.php — PHP backend API for ASES Tournament Manager
 *
 * Replaces the browser-side db.js + api.js with server-side SQLite via PDO.
 * All application logic lives here; the Vue frontend calls this endpoint.
 *
 * Routing:  GET/POST ?action=<actionName>
 * Auth:     Bearer token required for all write operations.
 *           Read operations (list*, get*) are public.
 *
 * Response format: { "ok": true, "data": <result> }
 *              or  { "ok": false, "error": "<message>" }
 *
 * ── TOKEN CONFIG ───────────────────────────────────────────────────────────
 *   Change SAVE_TOKEN to a unique string and set the same in js/api.js.
 * ──────────────────────────────────────────────────────────────────────────
 */

define('SAVE_TOKEN', 'ases-elop-2026-secure');
define('DB_PATH',    __DIR__ . '/app.db');

/* ── CORS ────────────────────────────────────────────────────────── */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204); exit;
}

/* ── helpers ─────────────────────────────────────────────────────── */
function ok($data)  { echo json_encode(['ok' => true,  'data'  => $data]);  exit; }
function err($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg]);
    exit;
}
function now_iso() { return (new DateTime('now', new DateTimeZone('UTC')))->format('Y-m-d\TH:i:s.v\Z'); }
function new_id($prefix) {
    $hex = bin2hex(random_bytes(6));
    return $prefix . '_' . $hex;
}

/* ── auth check for writes ───────────────────────────────────────── */
function get_token() {
    $h = '';
    foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $k) {
        if (!empty($_SERVER[$k])) { $h = $_SERVER[$k]; break; }
    }
    if (!$h && function_exists('getallheaders')) {
        $hdrs = array_change_key_case(getallheaders(), CASE_LOWER);
        $h = $hdrs['authorization'] ?? '';
    }
    if ($h && strncasecmp($h, 'Bearer ', 7) === 0) return substr($h, 7);
    return $_GET['token'] ?? ($_POST['token'] ?? '');
}
function require_auth() {
    if (get_token() !== SAVE_TOKEN) err('Unauthorized', 401);
}

/* ── database connection ─────────────────────────────────────────── */
function pdo(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO('sqlite:' . DB_PATH);
    $pdo->setAttribute(PDO::ATTR_ERRMODE,            PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA journal_mode=WAL;');
    init_schema($pdo);
    return $pdo;
}

function init_schema(PDO $db): void {
    $db->exec("
        CREATE TABLE IF NOT EXISTS Schools (
            SchoolID        TEXT PRIMARY KEY,
            SchoolName      TEXT NOT NULL,
            SchoolShortName TEXT DEFAULT '',
            Level           TEXT DEFAULT 'Elementary',
            LogoURL         TEXT DEFAULT '',
            IsActive        INTEGER DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS Tournaments (
            TournamentID   TEXT PRIMARY KEY,
            TournamentName TEXT NOT NULL,
            Sport          TEXT DEFAULT '',
            Level          TEXT DEFAULT 'Elementary',
            Format         TEXT DEFAULT 'ROUND_ROBIN',
            SeasonYear     INTEGER DEFAULT 2026,
            Status         TEXT DEFAULT 'DRAFT',
            PublicVisible  INTEGER DEFAULT 0,
            Notes          TEXT DEFAULT '',
            CreatedAt      TEXT,
            UpdatedAt      TEXT
        );
        CREATE TABLE IF NOT EXISTS TournamentTeams (
            TeamID         TEXT PRIMARY KEY,
            TournamentID   TEXT NOT NULL,
            SchoolID       TEXT DEFAULT '',
            TeamName       TEXT DEFAULT '',
            TeamLabel      TEXT DEFAULT '',
            CoachName      TEXT DEFAULT '',
            CoachEmail     TEXT DEFAULT '',
            IsActive       INTEGER DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS Games (
            GameID         TEXT PRIMARY KEY,
            TournamentID   TEXT NOT NULL,
            Stage          TEXT DEFAULT 'ROUND_ROBIN',
            RoundNumber    INTEGER DEFAULT 1,
            GameLabel      TEXT DEFAULT '',
            TeamA_ID       TEXT DEFAULT '',
            TeamB_ID       TEXT DEFAULT '',
            ScoreA         TEXT DEFAULT '',
            ScoreB         TEXT DEFAULT '',
            WinnerTeamID   TEXT DEFAULT '',
            Location       TEXT DEFAULT '',
            GameTimeLabel  TEXT DEFAULT '',
            IsComplete     INTEGER DEFAULT 0,
            CreatedAt      TEXT,
            UpdatedAt      TEXT
        );
        CREATE TABLE IF NOT EXISTS Standings (
            TournamentID   TEXT NOT NULL,
            TeamID         TEXT NOT NULL,
            Wins           INTEGER DEFAULT 0,
            Losses         INTEGER DEFAULT 0,
            PointsFor      INTEGER DEFAULT 0,
            PointsAgainst  INTEGER DEFAULT 0,
            PointDiff      INTEGER DEFAULT 0,
            Rank           INTEGER DEFAULT 0,
            LastUpdatedAt  TEXT,
            PRIMARY KEY (TournamentID, TeamID)
        );
        CREATE TABLE IF NOT EXISTS Settings (
            Key   TEXT PRIMARY KEY,
            Value TEXT
        );
    ");
    seed_schools_if_empty($db);
}

function seed_schools_if_empty(PDO $db): void {
    $row = $db->query("SELECT COUNT(*) AS c FROM Schools")->fetch();
    if ($row['c'] > 0) return;
    $schools = [
        ['Cesar Chavez',            'CC',  'Elementary', 'https://files.smartsites.parentsquare.com/9154/CC_logo@3x_1749069437.png'],
        ['Coral Mountain',          'CMA', 'Elementary', 'https://files.smartsites.parentsquare.com/9154/CMA_logo@3x_1749069438.png'],
        ['John Kelley',             'JK',  'Elementary', 'https://files.smartsites.parentsquare.com/9154/JK_logo@3x_1749069439.png'],
        ['Las Palmitas',            'LP',  'Elementary', 'https://files.smartsites.parentsquare.com/9154/canva_93356.png'],
        ['Mecca',                   'MA',  'Elementary', 'https://files.smartsites.parentsquare.com/9154/M_logo@3x_1749069440.png'],
        ['Mountain Vista',          'MV',  'Elementary', 'https://files.smartsites.parentsquare.com/9154/MV_logo@3x_1749069206.png'],
        ['Oasis',                   'OA',  'Elementary', 'https://files.smartsites.parentsquare.com/9154/O_logo@3x_1749069440.png'],
        ['Palm View',               'PV',  'Elementary', 'https://files.smartsites.parentsquare.com/9154/PV_logo@2x_1749069441.png'],
        ['Peter Pendleton',         'PP',  'Elementary', 'https://files.smartsites.parentsquare.com/9154/PP_logo@2x_1749069441.png'],
        ['Saul Martinez',           'SM',  'Elementary', 'https://files.smartsites.parentsquare.com/9154/SM_logo@2x_1749069441.png'],
        ['Sea View',                'SV',  'Elementary', 'https://files.smartsites.parentsquare.com/9154/SV_logo@3x_1749069441.png'],
        ['Valle del Sol',           'VDS', 'Elementary', 'https://files.smartsites.parentsquare.com/9154/VDS_logo@3x_1749069448.png'],
        ['Valley View',             'VV',  'Elementary', 'https://files.smartsites.parentsquare.com/9154/VV_logoSq4_1749069208.png'],
        ['Westside',                'WS',  'Elementary', 'https://files.smartsites.parentsquare.com/9154/W_logo@3x_1749069208.png'],
        ['Bobby Duke',              'BD',  'Middle',     'https://files.smartsites.parentsquare.com/9154/BB_logo@3x_1749069437.png'],
        ['Cahuilla Desert Academy', 'CDA', 'Middle',     'https://files.smartsites.parentsquare.com/9154/CDA_logo@3x_1749069203.png'],
        ['Toro Canyon',             'TC',  'Middle',     'https://files.smartsites.parentsquare.com/9154/TC_logo@3x_1749069442.png'],
        ['West Shores',             'WSH', 'Middle',     ''],
    ];
    $stmt = $db->prepare("INSERT INTO Schools (SchoolID,SchoolName,SchoolShortName,Level,LogoURL,IsActive) VALUES (?,?,?,?,?,1)");
    foreach ($schools as $s) $stmt->execute([new_id('SCH'), $s[0], $s[1], $s[2], $s[3]]);
}

/* ── query helpers ───────────────────────────────────────────────── */
function q(string $sql, array $p = []): array {
    $st = pdo()->prepare($sql); $st->execute($p); return $st->fetchAll();
}
function q1(string $sql, array $p = []): ?array {
    $rows = q($sql, $p); return $rows ? $rows[0] : null;
}
function run(string $sql, array $p = []): void {
    pdo()->prepare($sql)->execute($p);
}

/* ══════════════════════════════════════════════════════════════════
   SCHEDULE GENERATORS  (ported 1-to-1 from api.js private helpers)
   ══════════════════════════════════════════════════════════════════ */

/** Berger circle rotation for round-robin. */
function generate_round_robin(array $teams, string $tid, string $stage): array {
    $list = $teams;
    $n    = count($list);
    if ($n % 2 !== 0) { $list[] = ['TeamID' => 'BYE']; $n++; }
    $rounds = $n - 1;
    $games  = [];
    $gnum   = 1;
    for ($r = 1; $r <= $rounds; $r++) {
        for ($i = 0; $i < $n / 2; $i++) {
            $a = $list[$i]; $b = $list[$n - 1 - $i];
            $games[] = ['GameID' => new_id('G'), 'TournamentID' => $tid,
                'Stage' => $stage, 'RoundNumber' => $r,
                'GameLabel' => $stage . ' R' . $r . ' G' . $gnum++,
                'TeamA_ID' => $a['TeamID'], 'TeamB_ID' => $b['TeamID']];
        }
        if ($r < $rounds) {
            $last = array_pop($list);
            array_splice($list, 1, 0, [$last]);
        }
    }
    return $games;
}

/** Elementary 3-round group schedule. */
function generate_elementary_schedule(array $teams, string $tid): array {
    $list     = $teams;
    $n        = count($list);
    $maxR     = 3;
    if ($n % 2 !== 0) { $list[] = ['TeamID' => 'BYE']; $n++; }
    $total    = $n - 1;
    $rounds   = min($maxR, $total);
    $games    = [];
    for ($r = 1; $r <= $rounds; $r++) {
        for ($i = 0; $i < $n / 2; $i++) {
            $a = $list[$i]; $b = $list[$n - 1 - $i];
            $games[] = ['GameID' => new_id('G'), 'TournamentID' => $tid,
                'Stage' => 'GROUP', 'RoundNumber' => $r,
                'GameLabel' => 'GROUP R' . $r . ' G' . (count($games) + 1),
                'TeamA_ID' => $a['TeamID'], 'TeamB_ID' => $b['TeamID']];
        }
        if ($r < $rounds) { $last = array_pop($list); array_splice($list, 1, 0, [$last]); }
    }
    return $games;
}

/** Backtracking: find round pairings with no repeated pairs. */
function find_round_pairs(array $ids, array $used): ?array {
    if (!$ids) return [];
    $pivot = $ids[0];
    for ($p = 1; $p < count($ids); $p++) {
        $partner = $ids[$p];
        $key = implode('-', array_unique(array_map('strval', [$pivot, $partner])));
        $sorted = [$pivot, $partner]; sort($sorted);
        $key = implode('-', $sorted);
        if (!empty($used[$key])) continue;
        $rem = array_values(array_filter($ids, fn($v, $k) => $k !== 0 && $k !== $p, ARRAY_FILTER_USE_BOTH));
        $sub = find_round_pairs($rem, $used);
        if ($sub !== null) { array_unshift($sub, [$pivot, $partner]); return $sub; }
    }
    return null;
}

function pair_key(string $a, string $b): string { $s = [$a, $b]; sort($s); return implode('-', $s); }

/** Auto-fill remaining games for elementary group bracket. */
function auto_generate_remaining(array $teams, string $tid, array $custom, array $usedTeams, int $startNum): array {
    $list = $teams; $n = count($list); $maxR = 3;
    if ($n % 2 !== 0) { $list[] = ['TeamID' => 'BYE']; $n++; }

    $usedPairs = [];
    foreach ($custom as $mu) {
        if (!empty($mu['TeamA_ID']) && !empty($mu['TeamB_ID']))
            $usedPairs[pair_key($mu['TeamA_ID'], $mu['TeamB_ID'])] = true;
    }

    $roundUsed = [];
    foreach ($usedTeams as $rk => $ids) {
        $rn = (int)$rk;
        foreach ($ids as $tid2 => $_) $roundUsed[$rn][$tid2] = true;
    }

    $games = [];
    for ($r = 1; $r <= $maxR; $r++) {
        $roundUsed[$r] = $roundUsed[$r] ?? [];
        $avail = array_values(array_filter(array_column($list, 'TeamID'),
            fn($id) => empty($roundUsed[$r][$id])));
        $pairs = find_round_pairs($avail, $usedPairs);
        if ($pairs === null) {
            // greedy fallback
            $pairs = []; $a2 = $avail;
            while (count($a2) >= 2) {
                $aId = $a2[0]; $pi2 = -1;
                for ($gi = 1; $gi < count($a2); $gi++) {
                    if (empty($usedPairs[pair_key($aId, $a2[$gi])])) { $pi2 = $gi; break; }
                }
                if ($pi2 === -1) { array_shift($a2); continue; }
                $bId = $a2[$pi2]; $pairs[] = [$aId, $bId];
                $a2 = array_values(array_filter($a2, fn($id) => $id !== $aId && $id !== $bId));
            }
        }
        foreach ($pairs as $pair) {
            $key = pair_key($pair[0], $pair[1]);
            if (!empty($usedPairs[$key])) continue;
            $games[] = ['GameID' => new_id('G'), 'TournamentID' => $tid,
                'Stage' => 'GROUP', 'RoundNumber' => $r,
                'GameLabel' => 'GROUP R' . $r . ' G' . ($startNum + count($games) + 1),
                'TeamA_ID' => $pair[0], 'TeamB_ID' => $pair[1]];
            $usedPairs[$key] = true;
            $roundUsed[$r][$pair[0]] = true;
            $roundUsed[$r][$pair[1]] = true;
        }
    }
    return $games;
}

/** Auto-fill for round-robin tournaments. */
function auto_generate_round_robin(array $teams, string $tid, string $stage, array $custom, array $usedTeams, int $startNum): array {
    $list = $teams; $n = count($list);
    $hasOdd = $n % 2 !== 0;
    $usedPairs = [];
    foreach ($custom as $mu) {
        if (!empty($mu['TeamA_ID']) && !empty($mu['TeamB_ID']))
            $usedPairs[pair_key($mu['TeamA_ID'], $mu['TeamB_ID'])] = true;
    }
    if ($hasOdd) { $list[] = ['TeamID' => 'BYE']; $n++; }
    $totalR = $n - 1; $perR = $n / 2;

    // build template
    $tpl = $list; $tplGames = [];
    for ($tr = 1; $tr <= $totalR; $tr++) {
        for ($i = 0; $i < $n / 2; $i++) {
            $a = $tpl[$i]; $b = $tpl[$n - 1 - $i];
            $tplGames[] = ['RoundNumber' => $tr, 'TeamA_ID' => $a['TeamID'], 'TeamB_ID' => $b['TeamID'],
                'PairKey' => pair_key($a['TeamID'], $b['TeamID'])];
        }
        if ($tr < $totalR) { $last = array_pop($tpl); array_splice($tpl, 1, 0, [$last]); }
    }

    $roundUsed = []; $roundCount = [];
    for ($r = 1; $r <= $totalR; $r++) { $roundUsed[$r] = []; $roundCount[$r] = 0; }
    foreach ($usedTeams as $ek => $ids) {
        $ern = (int)$ek;
        foreach (array_keys($ids) as $id) if ($id !== 'BYE') $roundUsed[$ern][$id] = true;
    }
    foreach ($custom as $cm) {
        $cr = (int)($cm['RoundNumber'] ?? 1);
        $roundCount[$cr] = ($roundCount[$cr] ?? 0) + 1;
    }

    $pending = array_filter($tplGames, fn($g) => empty($usedPairs[$g['PairKey']]));
    $games = [];

    foreach ($pending as $gtp) {
        $candidates = [$gtp['RoundNumber']];
        for ($rr = 1; $rr <= $totalR; $rr++) if ($rr !== $gtp['RoundNumber']) $candidates[] = $rr;
        $placed = false;
        foreach ($candidates as $tr2) {
            $roundUsed[$tr2] = $roundUsed[$tr2] ?? []; $roundCount[$tr2] = $roundCount[$tr2] ?? 0;
            $aId = $gtp['TeamA_ID']; $bId = $gtp['TeamB_ID'];
            if (($aId !== 'BYE' && !empty($roundUsed[$tr2][$aId])) ||
                ($bId !== 'BYE' && !empty($roundUsed[$tr2][$bId])) ||
                ($roundCount[$tr2] >= $perR)) continue;
            $games[] = ['GameID' => new_id('G'), 'TournamentID' => $tid, 'Stage' => $stage,
                'RoundNumber' => $tr2,
                'GameLabel' => $stage . ' R' . $tr2 . ' G' . ($startNum + count($games) + 1),
                'TeamA_ID' => $aId, 'TeamB_ID' => $bId];
            $usedPairs[$gtp['PairKey']] = true;
            if ($aId !== 'BYE') $roundUsed[$tr2][$aId] = true;
            if ($bId !== 'BYE') $roundUsed[$tr2][$bId] = true;
            $roundCount[$tr2]++;
            $placed = true; break;
        }
        if (!$placed) {
            $xr = $totalR + 1;
            for (;;) {
                $roundUsed[$xr] = $roundUsed[$xr] ?? []; $roundCount[$xr] = $roundCount[$xr] ?? 0;
                $xA = $gtp['TeamA_ID']; $xB = $gtp['TeamB_ID'];
                if (($xA === 'BYE' || empty($roundUsed[$xr][$xA])) &&
                    ($xB === 'BYE' || empty($roundUsed[$xr][$xB]))) {
                    $games[] = ['GameID' => new_id('G'), 'TournamentID' => $tid, 'Stage' => $stage,
                        'RoundNumber' => $xr,
                        'GameLabel' => $stage . ' R' . $xr . ' G' . ($startNum + count($games) + 1),
                        'TeamA_ID' => $xA, 'TeamB_ID' => $xB];
                    $usedPairs[$gtp['PairKey']] = true;
                    if ($xA !== 'BYE') $roundUsed[$xr][$xA] = true;
                    if ($xB !== 'BYE') $roundUsed[$xr][$xB] = true;
                    $roundCount[$xr]++; break;
                }
                $xr++;
            }
        }
    }
    return $games;
}

function mark_bye_games_complete(string $tid): void {
    $ts = now_iso();
    run("UPDATE Games SET IsComplete=1,WinnerTeamID=TeamA_ID,ScoreA='0',ScoreB='0',UpdatedAt=? WHERE TournamentID=? AND TeamB_ID='BYE' AND IsComplete=0", [$ts, $tid]);
    run("UPDATE Games SET IsComplete=1,WinnerTeamID=TeamB_ID,ScoreA='0',ScoreB='0',UpdatedAt=? WHERE TournamentID=? AND TeamA_ID='BYE' AND IsComplete=0", [$ts, $tid]);
}

function advance_bracket_winners(string $tid): void {
    $bGames = q("SELECT * FROM Games WHERE TournamentID=? AND Stage IN ('QF','SF','FINAL')", [$tid]);
    $byLabel = fn($lbl) => current(array_filter($bGames, fn($g) => $g['GameLabel'] === $lbl)) ?: null;
    $sfs = array_values(array_filter($bGames, fn($g) => $g['Stage'] === 'SF'));
    usort($sfs, fn($a, $b) => strcmp($a['GameLabel'], $b['GameLabel']));
    $fin = current(array_filter($bGames, fn($g) => $g['Stage'] === 'FINAL')) ?: null;
    $sf1 = $sfs[0] ?? null; $sf2 = $sfs[1] ?? null;
    $qf1 = $byLabel('QF 1'); $qf2 = $byLabel('QF 2');
    $qf3 = $byLabel('QF 3'); $qf4 = $byLabel('QF 4');
    if ($qf1 && $qf2 && $sf1 && $qf1['IsComplete'] && $qf2['IsComplete'] && $qf1['WinnerTeamID'] && $qf2['WinnerTeamID'])
        run('UPDATE Games SET TeamA_ID=?,TeamB_ID=?,UpdatedAt=? WHERE GameID=?', [$qf1['WinnerTeamID'], $qf2['WinnerTeamID'], now_iso(), $sf1['GameID']]);
    if ($qf3 && $qf4 && $sf2 && $qf3['IsComplete'] && $qf4['IsComplete'] && $qf3['WinnerTeamID'] && $qf4['WinnerTeamID'])
        run('UPDATE Games SET TeamA_ID=?,TeamB_ID=?,UpdatedAt=? WHERE GameID=?', [$qf3['WinnerTeamID'], $qf4['WinnerTeamID'], now_iso(), $sf2['GameID']]);
    if ($sf1 && $sf2 && $fin) {
        $sf1f = q1('SELECT * FROM Games WHERE GameID=?', [$sf1['GameID']]);
        $sf2f = q1('SELECT * FROM Games WHERE GameID=?', [$sf2['GameID']]);
        if ($sf1f && $sf2f && $sf1f['IsComplete'] && $sf2f['IsComplete'] && $sf1f['WinnerTeamID'] && $sf2f['WinnerTeamID'])
            run('UPDATE Games SET TeamA_ID=?,TeamB_ID=?,UpdatedAt=? WHERE GameID=?', [$sf1f['WinnerTeamID'], $sf2f['WinnerTeamID'], now_iso(), $fin['GameID']]);
    }
}

function rebuild_standings(string $tid): array {
    $teams = q('SELECT * FROM TournamentTeams WHERE TournamentID=? AND IsActive=1', [$tid]);
    $stats = []; $n = now_iso();
    foreach ($teams as $t) {
        $stats[$t['TeamID']] = ['TournamentID' => $tid, 'TeamID' => $t['TeamID'],
            'Wins' => 0, 'Losses' => 0, 'PointsFor' => 0, 'PointsAgainst' => 0,
            'PointDiff' => 0, 'Rank' => 0, 'LastUpdatedAt' => $n];
    }
    $cg = q("SELECT * FROM Games WHERE TournamentID=? AND IsComplete=1 AND (Stage='GROUP' OR Stage='ROUND_ROBIN')", [$tid]);
    foreach ($cg as $g) {
        if (!isset($stats[$g['TeamA_ID']]) || !isset($stats[$g['TeamB_ID']])) continue;
        $a = (int)($g['ScoreA'] ?? 0); $b = (int)($g['ScoreB'] ?? 0);
        $stats[$g['TeamA_ID']]['PointsFor']     += $a; $stats[$g['TeamA_ID']]['PointsAgainst'] += $b;
        $stats[$g['TeamB_ID']]['PointsFor']     += $b; $stats[$g['TeamB_ID']]['PointsAgainst'] += $a;
        if ($a > $b) { $stats[$g['TeamA_ID']]['Wins']++; $stats[$g['TeamB_ID']]['Losses']++; }
        elseif ($b > $a) { $stats[$g['TeamB_ID']]['Wins']++; $stats[$g['TeamA_ID']]['Losses']++; }
    }
    $rows = array_values($stats);
    foreach ($rows as &$r) $r['PointDiff'] = $r['PointsFor'] - $r['PointsAgainst'];
    usort($rows, function ($a, $b) {
        if ($b['Wins'] !== $a['Wins']) return $b['Wins'] - $a['Wins'];
        if ($b['PointDiff'] !== $a['PointDiff']) return $b['PointDiff'] - $a['PointDiff'];
        return $b['PointsFor'] - $a['PointsFor'];
    });
    foreach ($rows as $i => &$r) $r['Rank'] = $i + 1;
    run('DELETE FROM Standings WHERE TournamentID=?', [$tid]);
    $st = pdo()->prepare('INSERT INTO Standings (TournamentID,TeamID,Wins,Losses,PointsFor,PointsAgainst,PointDiff,Rank,LastUpdatedAt) VALUES (?,?,?,?,?,?,?,?,?)');
    foreach ($rows as $r) $st->execute([$r['TournamentID'],$r['TeamID'],$r['Wins'],$r['Losses'],$r['PointsFor'],$r['PointsAgainst'],$r['PointDiff'],$r['Rank'],$r['LastUpdatedAt']]);
    return q('SELECT * FROM Standings WHERE TournamentID=? ORDER BY Rank', [$tid]);
}

function insert_games(array $games): void {
    $st = pdo()->prepare('INSERT INTO Games (GameID,TournamentID,Stage,RoundNumber,GameLabel,TeamA_ID,TeamB_ID,ScoreA,ScoreB,WinnerTeamID,Location,GameTimeLabel,IsComplete,CreatedAt,UpdatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    $ts = now_iso();
    foreach ($games as $g) $st->execute([$g['GameID'],$g['TournamentID'],$g['Stage'],$g['RoundNumber'],$g['GameLabel'],$g['TeamA_ID'],$g['TeamB_ID'],'','','','','',0,$ts,$ts]);
}

/* ══════════════════════════════════════════════════════════════════
   REQUEST ROUTING
   ══════════════════════════════════════════════════════════════════ */
$action = $_GET['action'] ?? $_POST['action'] ?? '';
$body   = json_decode(file_get_contents('php://input'), true) ?? [];

try {
switch ($action) {

/* ─── SCHOOLS ────────────────────────────────────────────── */
case 'listSchools': {
    $activeOnly = ($_GET['activeOnly'] ?? '1') !== '0';
    if ($activeOnly)
        ok(q('SELECT * FROM Schools WHERE IsActive=1 ORDER BY Level,SchoolName'));
    ok(q('SELECT * FROM Schools ORDER BY Level,SchoolName'));
}
case 'createSchool': {
    require_auth();
    if (empty($body['SchoolName'])) err('School name is required');
    $id = new_id('SCH');
    run('INSERT INTO Schools (SchoolID,SchoolName,SchoolShortName,Level,LogoURL,IsActive) VALUES (?,?,?,?,?,1)',
        [$id, trim($body['SchoolName']), $body['SchoolShortName']??'', $body['Level']??'Elementary', $body['LogoURL']??'']);
    ok(q1('SELECT * FROM Schools WHERE SchoolID=?', [$id]));
}
case 'updateSchool': {
    require_auth();
    $id = $body['SchoolID'] ?? $body['id'] ?? ''; if (!$id) err('School ID required');
    $sets = []; $vals = [];
    foreach (['SchoolName','SchoolShortName','Level','LogoURL'] as $f)
        if (array_key_exists($f, $body)) { $sets[] = "$f=?"; $vals[] = trim((string)$body[$f]); }
    if (array_key_exists('IsActive', $body)) { $sets[] = 'IsActive=?'; $vals[] = $body['IsActive'] ? 1 : 0; }
    if (!$sets) ok(q1('SELECT * FROM Schools WHERE SchoolID=?', [$id]));
    $vals[] = $id;
    run('UPDATE Schools SET ' . implode(',', $sets) . ' WHERE SchoolID=?', $vals);
    ok(q1('SELECT * FROM Schools WHERE SchoolID=?', [$id]));
}

/* ─── TOURNAMENTS ────────────────────────────────────────── */
case 'listTournaments': {
    $all = ($_GET['includeAll'] ?? '0') === '1';
    if ($all)
        ok(q('SELECT * FROM Tournaments ORDER BY SeasonYear DESC,TournamentName'));
    ok(q("SELECT * FROM Tournaments WHERE Status='ACTIVE' AND PublicVisible=1 ORDER BY SeasonYear DESC,TournamentName"));
}
case 'getTournament': {
    $id = $_GET['id'] ?? ''; if (!$id) err('id required');
    ok(q1('SELECT * FROM Tournaments WHERE TournamentID=?', [$id]));
}
case 'createTournament': {
    require_auth();
    if (empty($body['TournamentName'])) err('Tournament name is required');
    $id = new_id('T'); $ts = now_iso();
    run('INSERT INTO Tournaments (TournamentID,TournamentName,Sport,Level,Format,SeasonYear,Status,PublicVisible,Notes,CreatedAt,UpdatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [$id, trim($body['TournamentName']), $body['Sport']??'', $body['Level']??'Elementary',
         $body['Format']??'ROUND_ROBIN', $body['SeasonYear']??2026,
         $body['Status']??'DRAFT', ($body['PublicVisible']??false) ? 1 : 0, $body['Notes']??'', $ts, $ts]);
    ok(q1('SELECT * FROM Tournaments WHERE TournamentID=?', [$id]));
}
case 'setTournamentStatus': {
    require_auth();
    $id = $body['id'] ?? ''; $status = $body['status'] ?? ''; if (!$id || !$status) err('id and status required');
    run('UPDATE Tournaments SET Status=?,UpdatedAt=? WHERE TournamentID=?', [$status, now_iso(), $id]);
    ok(q1('SELECT * FROM Tournaments WHERE TournamentID=?', [$id]));
}
case 'toggleTournamentPublic': {
    require_auth();
    $id = $body['id'] ?? ''; if (!$id) err('id required');
    $t = q1('SELECT PublicVisible FROM Tournaments WHERE TournamentID=?', [$id]);
    if (!$t) err('Tournament not found');
    $next = $t['PublicVisible'] ? 0 : 1;
    run('UPDATE Tournaments SET PublicVisible=?,UpdatedAt=? WHERE TournamentID=?', [$next, now_iso(), $id]);
    ok(q1('SELECT * FROM Tournaments WHERE TournamentID=?', [$id]));
}
case 'deleteTournament': {
    require_auth();
    $id = $body['id'] ?? ''; if (!$id) err('id required');
    run('DELETE FROM TournamentTeams WHERE TournamentID=?', [$id]);
    run('DELETE FROM Games WHERE TournamentID=?', [$id]);
    run('DELETE FROM Standings WHERE TournamentID=?', [$id]);
    run('DELETE FROM Tournaments WHERE TournamentID=?', [$id]);
    ok(['deleted' => true]);
}

/* ─── TEAMS ───────────────────────────────────────────────── */
case 'listTeams': {
    $tid = $_GET['tournamentId'] ?? ''; if (!$tid) err('tournamentId required');
    ok(q('SELECT * FROM TournamentTeams WHERE TournamentID=? AND IsActive=1 ORDER BY TeamName', [$tid]));
}
case 'setParticipants': {
    require_auth();
    $tid   = $body['tournamentId'] ?? ''; if (!$tid) err('tournamentId required');
    $teams = $body['teams'] ?? [];
    run('DELETE FROM TournamentTeams WHERE TournamentID=?', [$tid]);
    $st = pdo()->prepare('INSERT OR REPLACE INTO TournamentTeams (TeamID,TournamentID,SchoolID,TeamName,TeamLabel,CoachName,CoachEmail,IsActive) VALUES (?,?,?,?,?,?,?,1)');
    foreach ($teams as $team) {
        $teamId = !empty($team['TeamID']) ? $team['TeamID'] : new_id('TEAM');
        $st->execute([$teamId, $tid, $team['SchoolID']??'', $team['TeamName']??'', $team['TeamLabel']??'', $team['CoachName']??'', $team['CoachEmail']??'']);
    }
    ok(rebuild_standings($tid));
}
case 'addAllSchoolsByLevel': {
    require_auth();
    $tid = $body['tournamentId'] ?? ''; if (!$tid) err('tournamentId required');
    $t   = q1('SELECT * FROM Tournaments WHERE TournamentID=?', [$tid]);
    if (!$t) err('Tournament not found');
    $schools  = q('SELECT * FROM Schools WHERE Level=? AND IsActive=1', [$t['Level']]);
    $existing = q('SELECT SchoolID FROM TournamentTeams WHERE TournamentID=? AND IsActive=1', [$tid]);
    $existIds = array_column($existing, 'SchoolID');
    $added = 0;
    $st = pdo()->prepare('INSERT INTO TournamentTeams (TeamID,TournamentID,SchoolID,TeamName,TeamLabel,CoachName,CoachEmail,IsActive) VALUES (?,?,?,?,?,?,?,1)');
    foreach ($schools as $s) {
        if (in_array($s['SchoolID'], $existIds)) continue;
        $st->execute([new_id('TEAM'), $tid, $s['SchoolID'], $s['SchoolName'], '', '', '']);
        $added++;
    }
    rebuild_standings($tid);
    ok(['added' => $added, 'total' => count($existing) + $added]);
}

/* ─── GAMES ───────────────────────────────────────────────── */
case 'listGames': {
    $tid = $_GET['tournamentId'] ?? ''; if (!$tid) err('tournamentId required');
    ok(q("SELECT * FROM Games WHERE TournamentID=? ORDER BY CASE Stage WHEN 'GROUP' THEN 1 WHEN 'ROUND_ROBIN' THEN 2 WHEN 'QF' THEN 3 WHEN 'SF' THEN 4 WHEN 'FINAL' THEN 5 ELSE 9 END, RoundNumber, GameLabel", [$tid]));
}
case 'saveScore': {
    require_auth();
    $gid = $body['gameId'] ?? ''; if (!$gid) err('gameId required');
    $g   = q1('SELECT * FROM Games WHERE GameID=?', [$gid]); if (!$g) err('Game not found');
    $a = (int)($body['scoreA'] ?? 0); $b = (int)($body['scoreB'] ?? 0);
    if ($a === $b) err('Ties are not allowed');
    $winner = $a > $b ? $g['TeamA_ID'] : $g['TeamB_ID'];
    run('UPDATE Games SET ScoreA=?,ScoreB=?,WinnerTeamID=?,IsComplete=1,UpdatedAt=? WHERE GameID=?',
        [(string)$a, (string)$b, $winner, now_iso(), $gid]);
    rebuild_standings($g['TournamentID']);
    if (in_array($g['Stage'], ['QF','SF','FINAL'])) advance_bracket_winners($g['TournamentID']);
    ok(q1('SELECT * FROM Games WHERE GameID=?', [$gid]));
}
case 'updateGameTeams': {
    require_auth();
    $gid = $body['gameId'] ?? ''; if (!$gid) err('gameId required');
    run('UPDATE Games SET TeamA_ID=?,TeamB_ID=?,Location=?,UpdatedAt=? WHERE GameID=?',
        [$body['teamA']??'', $body['teamB']??'', trim($body['location']??''), now_iso(), $gid]);
    $g = q1('SELECT * FROM Games WHERE GameID=?', [$gid]);
    if ($g) rebuild_standings($g['TournamentID']);
    ok($g);
}

/* ─── SCHEDULE ────────────────────────────────────────────── */
case 'generateSchedule': {
    require_auth();
    $tid = $body['tournamentId'] ?? ''; if (!$tid) err('tournamentId required');
    $t   = q1('SELECT * FROM Tournaments WHERE TournamentID=?', [$tid]); if (!$t) err('Tournament not found');
    $teams = q('SELECT * FROM TournamentTeams WHERE TournamentID=? AND IsActive=1', [$tid]);
    if (count($teams) < 2) err('At least 2 active teams are required');
    run("DELETE FROM Games WHERE TournamentID=? AND (Stage='ROUND_ROBIN' OR Stage='GROUP')", [$tid]);
    $stage = $t['Format'] === 'ELEMENTARY_GROUP_BRACKET' ? 'GROUP' : 'ROUND_ROBIN';
    $games = $t['Format'] === 'ELEMENTARY_GROUP_BRACKET'
        ? generate_elementary_schedule($teams, $tid)
        : generate_round_robin($teams, $tid, $stage);
    insert_games($games);
    rebuild_standings($tid);
    ok(['createdGames' => count($games), 'stage' => $stage]);
}
case 'createCustomSchedule': {
    require_auth();
    $tid    = $body['tournamentId'] ?? ''; if (!$tid) err('tournamentId required');
    $t      = q1('SELECT * FROM Tournaments WHERE TournamentID=?', [$tid]); if (!$t) err('Tournament not found');
    $teams  = q('SELECT * FROM TournamentTeams WHERE TournamentID=? AND IsActive=1', [$tid]);
    if (count($teams) < 2) err('At least 2 active teams are required');
    $stage  = $t['Format'] === 'ELEMENTARY_GROUP_BRACKET' ? 'GROUP' : 'ROUND_ROBIN';
    $custom = $body['customMatchups'] ?? [];
    $auto   = !empty($body['autoGenerate']);
    $games  = []; $usedTeams = [];
    foreach ($custom as $i => $mu) {
        if (empty($mu['TeamA_ID']) || empty($mu['TeamB_ID']) || $mu['TeamA_ID'] === $mu['TeamB_ID']) continue;
        $rk = (int)($mu['RoundNumber'] ?? 1);
        $games[] = ['GameID' => new_id('G'), 'TournamentID' => $tid, 'Stage' => $stage,
            'RoundNumber' => $rk,
            'GameLabel' => $stage . ' R' . $rk . ' G' . ($i + 1),
            'TeamA_ID' => $mu['TeamA_ID'], 'TeamB_ID' => $mu['TeamB_ID']];
        $usedTeams[$rk][$mu['TeamA_ID']] = true;
        $usedTeams[$rk][$mu['TeamB_ID']] = true;
    }
    if ($auto) {
        $extra = $t['Format'] === 'ELEMENTARY_GROUP_BRACKET'
            ? auto_generate_remaining($teams, $tid, $custom, $usedTeams, count($games))
            : auto_generate_round_robin($teams, $tid, $stage, $custom, $usedTeams, count($games));
        $games = array_merge($games, $extra);
    }
    run("DELETE FROM Games WHERE TournamentID=? AND (Stage='ROUND_ROBIN' OR Stage='GROUP')", [$tid]);
    insert_games($games);
    rebuild_standings($tid);
    ok(['createdGames' => count($games), 'stage' => $stage]);
}
case 'generateBracket': {
    require_auth();
    $tid   = $body['tournamentId'] ?? ''; if (!$tid) err('tournamentId required');
    $t     = q1('SELECT * FROM Tournaments WHERE TournamentID=?', [$tid]); if (!$t) err('Tournament not found');
    if ($t['Format'] !== 'ELEMENTARY_GROUP_BRACKET') err('Bracket generation only for ELEMENTARY_GROUP_BRACKET');
    $force = !empty($body['force']);
    if (!$force) {
        mark_bye_games_complete($tid);
        $incomplete = q("SELECT * FROM Games WHERE TournamentID=? AND Stage='GROUP' AND IsComplete=0 AND TeamA_ID!='BYE' AND TeamB_ID!='BYE'", [$tid]);
        if ($incomplete) err('All group-stage games must be complete (' . count($incomplete) . ' remaining)');
    }
    $stg = rebuild_standings($tid);
    if (count($stg) < 4) err('Need at least 4 teams for the bracket');
    $games = [];
    if (count($stg) >= 8) {
        $games = [
            ['GameID'=>new_id('G'),'TournamentID'=>$tid,'Stage'=>'QF','RoundNumber'=>1,'GameLabel'=>'QF 1','TeamA_ID'=>$stg[0]['TeamID'],'TeamB_ID'=>$stg[7]['TeamID']],
            ['GameID'=>new_id('G'),'TournamentID'=>$tid,'Stage'=>'QF','RoundNumber'=>1,'GameLabel'=>'QF 2','TeamA_ID'=>$stg[3]['TeamID'],'TeamB_ID'=>$stg[4]['TeamID']],
            ['GameID'=>new_id('G'),'TournamentID'=>$tid,'Stage'=>'QF','RoundNumber'=>1,'GameLabel'=>'QF 3','TeamA_ID'=>$stg[1]['TeamID'],'TeamB_ID'=>$stg[6]['TeamID']],
            ['GameID'=>new_id('G'),'TournamentID'=>$tid,'Stage'=>'QF','RoundNumber'=>1,'GameLabel'=>'QF 4','TeamA_ID'=>$stg[2]['TeamID'],'TeamB_ID'=>$stg[5]['TeamID']],
            ['GameID'=>new_id('G'),'TournamentID'=>$tid,'Stage'=>'SF','RoundNumber'=>2,'GameLabel'=>'SF 1 (W-QF1 vs W-QF2)','TeamA_ID'=>'','TeamB_ID'=>''],
            ['GameID'=>new_id('G'),'TournamentID'=>$tid,'Stage'=>'SF','RoundNumber'=>2,'GameLabel'=>'SF 2 (W-QF3 vs W-QF4)','TeamA_ID'=>'','TeamB_ID'=>''],
            ['GameID'=>new_id('G'),'TournamentID'=>$tid,'Stage'=>'FINAL','RoundNumber'=>3,'GameLabel'=>'Final','TeamA_ID'=>'','TeamB_ID'=>''],
        ];
    } else {
        $games = [
            ['GameID'=>new_id('G'),'TournamentID'=>$tid,'Stage'=>'SF','RoundNumber'=>1,'GameLabel'=>'SF 1','TeamA_ID'=>$stg[0]['TeamID'],'TeamB_ID'=>$stg[3]['TeamID']??''],
            ['GameID'=>new_id('G'),'TournamentID'=>$tid,'Stage'=>'SF','RoundNumber'=>1,'GameLabel'=>'SF 2','TeamA_ID'=>$stg[1]['TeamID'],'TeamB_ID'=>$stg[2]['TeamID']??''],
            ['GameID'=>new_id('G'),'TournamentID'=>$tid,'Stage'=>'FINAL','RoundNumber'=>2,'GameLabel'=>'Final','TeamA_ID'=>'','TeamB_ID'=>''],
        ];
    }
    run("DELETE FROM Games WHERE TournamentID=? AND Stage IN ('QF','SF','FINAL')", [$tid]);
    insert_games($games);
    ok(['createdGames' => count($games), 'hasQF' => count($stg) >= 8]);
}

/* ─── STANDINGS ───────────────────────────────────────────── */
case 'getStandings': {
    $tid = $_GET['tournamentId'] ?? ''; if (!$tid) err('tournamentId required');
    $rows = q('SELECT * FROM Standings WHERE TournamentID=? ORDER BY Rank', [$tid]);
    ok($rows ?: rebuild_standings($tid));
}
case 'rebuildStandings': {
    require_auth();
    $tid = $body['tournamentId'] ?? ''; if (!$tid) err('tournamentId required');
    ok(rebuild_standings($tid));
}
case 'markByeGamesComplete': {
    require_auth();
    $tid = $body['tournamentId'] ?? ''; if (!$tid) err('tournamentId required');
    mark_bye_games_complete($tid);
    ok(true);
}

/* ─── SPORTS ──────────────────────────────────────────────── */
case 'listSports': {
    $row = q1("SELECT Value FROM Settings WHERE Key='sports'");
    $defaults = ['Basketball','Volleyball','Soccer','Baseball','Softball','Badminton','Table Tennis','Flag Football'];
    ok($row ? json_decode($row['Value'], true) : $defaults);
}
case 'saveSports': {
    require_auth();
    $arr = $body['sports'] ?? []; if (!is_array($arr)) err('sports must be array');
    $json = json_encode($arr);
    run("INSERT INTO Settings (Key,Value) VALUES ('sports',?) ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value", [$json]);
    ok(true);
}

/* ─── SETTINGS (show-location per tournament) ─────────────── */
case 'getShowLocation': {
    $tid = $_GET['tournamentId'] ?? ''; if (!$tid) err('tournamentId required');
    $row = q1("SELECT Value FROM Settings WHERE Key=?", ['showloc_' . $tid]);
    ok($row && $row['Value'] === '1');
}
case 'setShowLocation': {
    require_auth();
    $tid = $body['tournamentId'] ?? ''; if (!$tid) err('tournamentId required');
    $val = !empty($body['val']) ? '1' : '0';
    run("INSERT INTO Settings (Key,Value) VALUES (?,?) ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value", ['showloc_' . $tid, $val]);
    ok(true);
}

/* ─── UPDATE BRACKET SEEDING ──────────────────────────────── */
case 'updateBracketGame': {
    require_auth();
    $gid = $body['gameId'] ?? ''; if (!$gid) err('gameId required');
    run('UPDATE Games SET TeamA_ID=?,TeamB_ID=?,UpdatedAt=? WHERE GameID=?',
        [$body['teamA']??'', $body['teamB']??'', now_iso(), $gid]);
    ok(q1('SELECT * FROM Games WHERE GameID=?', [$gid]));
}

default:
    err('Unknown action: ' . htmlspecialchars($action), 404);
}
} catch (PDOException $e) {
    err('Database error: ' . $e->getMessage(), 500);
} catch (Exception $e) {
    err($e->getMessage(), 400);
}
