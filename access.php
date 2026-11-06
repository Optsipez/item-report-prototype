<?php
// Who may sign in, and with what password: the admin's User Access screen
// (js/auth.js). Stores the switched-off IDs and any password the admin has
// changed (hashed, never readable) in a file outside the web folder, so a
// deploy never overwrites it and it can't be downloaded. Anyone without a
// changed password still signs in with the one in js/auth.js. Written for the
// server's PHP 5.6.
//   GET ?id=X  -> {"allowed": true|false}
//   GET        -> {"blocked": [ids], "changed": [ids with a changed password]}
//   POST {"action": "login", "id", "password"} -> {"allowed", "changed", "ok"}
//        (ok: the password matches the changed one; null when not changed)
//   POST {"password", "id", "allowed"}     -> switches one person, admin password only
//   POST {"password", "id", "newPassword"} -> sets one person's password, admin only;
//        "" puts them back on the password in js/auth.js
header('Content-Type: application/json');
header('Cache-Control: no-store');
$ADMIN_PASSWORD = 'Admin0306';   // same as the admin login in js/auth.js
$file = dirname(dirname(__DIR__)) . '/2xlpurchase-access.json';
$data = is_file($file) ? json_decode(file_get_contents($file), true) : array();
if (!is_array($data)) $data = array();
if (!isset($data['blocked'])) $data = array('blocked' => array_values($data), 'passwords' => array());   // the old file was just the blocked list
if (!isset($data['passwords']) || !is_array($data['passwords'])) $data['passwords'] = array();

function done($code, $body) { http_response_code($code); echo json_encode($body); exit; }
function norm($v) { return strtoupper(trim((string)$v)); }
function summary($data) { return array('blocked' => $data['blocked'], 'changed' => array_keys($data['passwords'])); }

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $in = json_decode(file_get_contents('php://input'), true);
  if (!is_array($in)) done(400, array('error' => 'Bad request'));
  $id = norm(isset($in['id']) ? $in['id'] : '');
  if (isset($in['action']) && $in['action'] === 'login') {
    $hash = isset($data['passwords'][$id]) ? $data['passwords'][$id] : null;
    done(200, array('allowed' => !in_array($id, $data['blocked'], true), 'changed' => $hash !== null,
      'ok' => $hash === null ? null : password_verify(isset($in['password']) ? (string)$in['password'] : '', $hash)));
  }
  if (!isset($in['password']) || !hash_equals($ADMIN_PASSWORD, (string)$in['password'])) done(403, array('error' => 'Wrong admin password'));
  if ($id === '' || $id === 'ADMIN') done(400, array('error' => 'The admin account cannot be changed here'));
  if (array_key_exists('newPassword', $in)) {
    $pw = (string)$in['newPassword'];
    if ($pw === '') unset($data['passwords'][$id]);
    elseif (strlen($pw) < 4) done(400, array('error' => 'Use at least 4 characters'));
    else $data['passwords'][$id] = password_hash($pw, PASSWORD_DEFAULT);
  } else {
    $data['blocked'] = array_values(array_diff($data['blocked'], array($id)));
    if (empty($in['allowed'])) $data['blocked'][] = $id;
  }
  if (file_put_contents($file, json_encode($data), LOCK_EX) === false) done(500, array('error' => 'Could not save on the server'));
  done(200, summary($data));
}
if (isset($_GET['id'])) done(200, array('allowed' => !in_array(norm($_GET['id']), $data['blocked'], true)));
done(200, summary($data));
