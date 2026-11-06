<?php
// Who may sign in, with what password, and where they last signed in from:
// the admin's User Access screen (js/auth.js). Stores the switched-off IDs,
// any password the admin has changed (hashed, never readable), each person's
// last sign-in (time, country, emirate/state) and alerts for sign-ins from
// outside the UAE, in a file outside the web folder, so a deploy never
// overwrites it and it can't be downloaded. Anyone without a changed password
// still signs in with the one in js/auth.js. Written for the server's PHP 5.6.
//   GET ?id=X  -> {"allowed": true|false}
//   GET        -> {"blocked": [ids], "changed": [ids with a changed password], "last": {id: sign-in}}
//   GET ?alerts=N -> {"alerts": [sign-ins from outside the UAE numbered above N]}
//   POST {"action": "login", "id", "password"} -> {"allowed", "changed", "ok"}
//        (ok: the password matches the changed one; null when not changed)
//   POST {"action": "signedin", "id"}      -> records where this sign-in came from
//   POST {"password", "id", "allowed"}     -> switches one person, admin password only
//   POST {"password", "id", "newPassword"} -> sets one person's password, admin only;
//        "" puts them back on the password in js/auth.js
// Places come from DB-IP's free IP to City Lite (tools/geo_build.py), kept in
// /home/a2xlmec/2xlpurchase-geo/. IPv4 only; anything else records as unknown.
header('Content-Type: application/json');
header('Cache-Control: no-store');
$ADMIN_PASSWORD = 'Admin0306';   // same as the admin login in js/auth.js
$HOME = dirname(dirname(__DIR__));
$file = $HOME . '/2xlpurchase-access.json';
$data = is_file($file) ? json_decode(file_get_contents($file), true) : array();
if (!is_array($data)) $data = array();
if (!isset($data['blocked'])) $data = array('blocked' => array_values($data));   // the old file was just the blocked list
foreach (array('passwords', 'last', 'alerts') as $k) if (!isset($data[$k]) || !is_array($data[$k])) $data[$k] = array();

function done($code, $body) { http_response_code($code); echo json_encode($body); exit; }
function norm($v) { return strtoupper(trim((string)$v)); }
function summary($data) { return array('blocked' => $data['blocked'], 'changed' => array_map('strval', array_keys($data['passwords'])), 'last' => (object)$data['last']); }
function save($file, $data) { if (file_put_contents($file, json_encode($data), LOCK_EX) === false) done(500, array('error' => 'Could not save on the server')); }
// [country code, emirate/state] for an IPv4 address: binary search over 6-byte
// records (first address, place number), the last one starting at or below it
function geo($dir, $ip) {
  $n = ip2long($ip);
  $f = $n === false ? false : @fopen($dir . '/ipv4.bin', 'rb');
  if (!$f) return null;
  $lo = 0; $hi = (int)(filesize($dir . '/ipv4.bin') / 6) - 1; $n = $n & 0xFFFFFFFF;
  while ($lo < $hi) {
    $mid = (int)(($lo + $hi + 1) / 2);
    fseek($f, $mid * 6); $r = unpack('Nstart', fread($f, 4));
    if (($r['start'] & 0xFFFFFFFF) <= $n) $lo = $mid; else $hi = $mid - 1;
  }
  fseek($f, $lo * 6 + 4); $p = unpack('nplace', fread($f, 2)); fclose($f);
  $locs = json_decode(file_get_contents($dir . '/locs.json'), true);
  return isset($locs[$p['place']]) ? $locs[$p['place']] : null;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $in = json_decode(file_get_contents('php://input'), true);
  if (!is_array($in)) done(400, array('error' => 'Bad request'));
  $id = norm(isset($in['id']) ? $in['id'] : '');
  $action = isset($in['action']) ? $in['action'] : '';
  if ($action === 'login') {
    $hash = isset($data['passwords'][$id]) ? $data['passwords'][$id] : null;
    done(200, array('allowed' => !in_array($id, $data['blocked'], true), 'changed' => $hash !== null,
      'ok' => $hash === null ? null : password_verify(isset($in['password']) ? (string)$in['password'] : '', $hash)));
  }
  if ($action === 'signedin') {
    if ($id === '') done(400, array('error' => 'Bad request'));
    $g = geo($HOME . '/2xlpurchase-geo', $_SERVER['REMOTE_ADDR']);
    $c = $g && $g[0] !== 'ZZ' ? $g[0] : '';
    $last = array('t' => gmdate('c'), 'country' => $c, 'region' => $g ? $g[1] : '');
    $data['last'][$id] = $last;
    if ($c !== '' && $c !== 'AE') {   // outside the UAE: an alert for Javaid / admin, the latest 50 kept
      $n = $data['alerts'] ? $data['alerts'][count($data['alerts']) - 1]['n'] + 1 : 1;
      $data['alerts'][] = array_merge(array('n' => $n, 'id' => $id), $last);
      $data['alerts'] = array_slice($data['alerts'], -50);
    }
    save($file, $data);
    done(200, array('ok' => true));
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
  save($file, $data);
  done(200, summary($data));
}
if (isset($_GET['id'])) done(200, array('allowed' => !in_array(norm($_GET['id']), $data['blocked'], true)));
if (isset($_GET['alerts'])) {
  $since = (int)$_GET['alerts'];
  done(200, array('alerts' => array_values(array_filter($data['alerts'], function ($a) use ($since) { return $a['n'] > $since; }))));
}
done(200, summary($data));
