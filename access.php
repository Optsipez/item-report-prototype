<?php
// Who may sign in: the admin's yes/no switches (User Access in js/auth.js).
// Stores the switched-off IDs in a file outside the web folder, so a deploy
// never overwrites it and it can't be downloaded. Written for the server's PHP 5.6.
//   GET ?id=X  -> {"allowed": true|false}
//   GET        -> {"blocked": [ids]}
//   POST {"password", "id", "allowed"} -> sets one person, admin password only
header('Content-Type: application/json');
header('Cache-Control: no-store');
$ADMIN_PASSWORD = 'Admin0306';   // same as the admin login in js/auth.js
$file = dirname(dirname(__DIR__)) . '/2xlpurchase-access.json';
$blocked = is_file($file) ? json_decode(file_get_contents($file), true) : array();
if (!is_array($blocked)) $blocked = array();

function done($code, $body) { http_response_code($code); echo json_encode($body); exit; }

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $in = json_decode(file_get_contents('php://input'), true);
  if (!is_array($in) || !isset($in['password']) || !hash_equals($ADMIN_PASSWORD, (string)$in['password'])) done(403, array('error' => 'Wrong admin password'));
  $id = strtoupper(trim(isset($in['id']) ? (string)$in['id'] : ''));
  if ($id === '' || $id === 'ADMIN') done(400, array('error' => 'The admin cannot be switched off'));
  $blocked = array_values(array_diff($blocked, array($id)));
  if (empty($in['allowed'])) $blocked[] = $id;
  if (file_put_contents($file, json_encode($blocked), LOCK_EX) === false) done(500, array('error' => 'Could not save the list on the server'));
  done(200, array('blocked' => $blocked));
}
if (isset($_GET['id'])) done(200, array('allowed' => !in_array(strtoupper(trim((string)$_GET['id'])), $blocked, true)));
done(200, array('blocked' => $blocked));
