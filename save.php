<?php
/**
 * save.php — SQLite write-back endpoint
 *
 * Accepts a raw POST of SQLite bytes from db.js and writes them to app.db.
 * This is what makes the tournament data persistent across devices.
 *
 * Security:
 *   - Requires an Authorization: Bearer <token> header matching SAVE_TOKEN below.
 *   - Validates that the body starts with the SQLite magic bytes.
 *   - Rejects empty or suspiciously large payloads.
 *
 * IMPORTANT: Change SAVE_TOKEN to something unique for your deployment,
 * and set the same value in js/db.js → SAVE_TOKEN.
 */

define('SAVE_TOKEN', 'ases-elop-2026-secure');
define('DB_PATH',    __DIR__ . '/app.db');
define('MAX_SIZE',   10 * 1024 * 1024); // 10 MB hard cap
define('SQLITE_MAGIC', "SQLite format 3\000");

// ── CORS (allow same-origin requests from the browser) ───────────
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ── Only accept POST ─────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit(json_encode(['ok' => false, 'error' => 'Method not allowed']));
}

// ── Auth check ───────────────────────────────────────────────────
$auth = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '';
// Some servers pass it differently
if (!$auth && function_exists('getallheaders')) {
    $headers = getallheaders();
    $auth = isset($headers['Authorization']) ? $headers['Authorization'] : '';
}
$expected = 'Bearer ' . SAVE_TOKEN;
if ($auth !== $expected) {
    http_response_code(401);
    exit(json_encode(['ok' => false, 'error' => 'Unauthorized']));
}

// ── Read body ────────────────────────────────────────────────────
$body = file_get_contents('php://input');
$size = strlen($body);

if ($size === 0) {
    http_response_code(400);
    exit(json_encode(['ok' => false, 'error' => 'Empty body']));
}

if ($size > MAX_SIZE) {
    http_response_code(413);
    exit(json_encode(['ok' => false, 'error' => 'Payload too large']));
}

// ── Validate SQLite magic bytes ──────────────────────────────────
if (substr($body, 0, 16) !== SQLITE_MAGIC) {
    http_response_code(400);
    exit(json_encode(['ok' => false, 'error' => 'Not a valid SQLite file']));
}

// ── Write atomically via a temp file ────────────────────────────
$tmp = DB_PATH . '.tmp';
$written = file_put_contents($tmp, $body, LOCK_EX);

if ($written === false) {
    http_response_code(500);
    exit(json_encode(['ok' => false, 'error' => 'Write failed']));
}

if (!rename($tmp, DB_PATH)) {
    @unlink($tmp);
    http_response_code(500);
    exit(json_encode(['ok' => false, 'error' => 'Rename failed']));
}

header('Content-Type: application/json');
echo json_encode(['ok' => true, 'bytes' => $written]);
