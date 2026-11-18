<?php
// send-code.php
// Kirim OTP email via PHPMailer.
// Config dibaca dari frontend/php/.env — JANGAN hardcode di sini.

header('Content-Type: application/json; charset=utf-8');

// ── CORS (untuk dev; ganti origin di production) ──
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
// dev: izinkan localhost + IP LAN (HP/laptop lain di Wi-Fi yang sama)
$devPattern = '#^http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):(5173|4173)$#';
if ($origin !== '' && preg_match($devPattern, $origin)) {
    header("Access-Control-Allow-Origin: $origin");
    header('Access-Control-Allow-Credentials: true');
    header('Vary: Origin');
}
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// ── Load .env ──
function load_env(string $path): void {
    if (!is_file($path)) return;
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        if (!str_contains($line, '=')) continue;
        [$key, $val] = explode('=', $line, 2);
        $key = trim($key);
        $val = trim($val);
        // buang quote pembungkus kalau ada
        if (strlen($val) >= 2 &&
            (($val[0] === '"' && $val[-1] === '"') ||
             ($val[0] === "'" && $val[-1] === "'"))) {
            $val = substr($val, 1, -1);
        }
        if (getenv($key) === false) {
            putenv("$key=$val");
            $_ENV[$key] = $val;
        }
    }
}
load_env(__DIR__ . '/.env');

// ── Config ──
$SMTP_HOST = getenv('SMTP_HOST') ?: 'smtp.gmail.com';
$SMTP_PORT = (int) (getenv('SMTP_PORT') ?: 587);
$SMTP_USER = getenv('SMTP_USER') ?: '';
$SMTP_PASS = getenv('SMTP_PASS') ?: '';
$SMTP_FROM = getenv('SMTP_FROM') ?: $SMTP_USER;
$SMTP_NAME = getenv('SMTP_NAME') ?: 'Codex Internasional Community';

// ── Guard: config wajib diisi ──
$missing = [];
if ($SMTP_USER === '') $missing[] = 'SMTP_USER';
if ($SMTP_PASS === '') $missing[] = 'SMTP_PASS';
if ($SMTP_FROM === '') $missing[] = 'SMTP_FROM';

if ($missing) {
    http_response_code(500);
    echo json_encode([
        'error'   => 'SMTP config belum lengkap',
        'missing' => $missing,
        'hint'    => 'Isi frontend/php/.env (lihat .env.example)',
    ]);
    exit;
}

// ── PHPMailer ──
$autoload = __DIR__ . '/vendor/autoload.php';
if (!is_file($autoload)) {
    http_response_code(500);
    echo json_encode([
        'error' => 'PHPMailer belum terinstall',
        'hint'  => 'Jalankan: cd frontend/php && composer install',
    ]);
    exit;
}
require $autoload;

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

// ── Input ──
$raw  = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) {
    http_response_code(400);
    echo json_encode(['error' => 'Body harus JSON']);
    exit;
}

$to = trim($body['email'] ?? '');
if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(['error' => 'Email tidak valid']);
    exit;
}

// ── Generate OTP 6 digit ──
$code = sprintf('%06d', random_int(0, 999999));
$expiresIn = 600; // detik (10 menit)

// ── Kirim ──
$mail = new PHPMailer(true);
try {
    $mail->isSMTP();
    $mail->Host       = $SMTP_HOST;
    $mail->SMTPAuth   = true;
    $mail->Username   = $SMTP_USER;
    $mail->Password   = $SMTP_PASS;
    $mail->CharSet    = 'UTF-8';
    $mail->Timeout    = 20;

    // auto-detect: 465 → SMTPS (implicit TLS), selain itu → STARTTLS
    if ($SMTP_PORT === 465) {
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
    } else {
        $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
    }
    $mail->Port = $SMTP_PORT;

    // (opsional) debug SMTP ke log server — matikan di prod
    // $mail->SMTPDebug  = 2;
    // $mail->Debugoutput = function ($str) { error_log('[SMTP] ' . $str); };

    $mail->setFrom($SMTP_FROM, $SMTP_NAME);
    $mail->addAddress($to);
    $mail->addReplyTo($SMTP_FROM, $SMTP_NAME);

    $mail->isHTML(true);
    $mail->Subject = 'Your Codex sign-in code';
    $mail->Body = "
        <div style='font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#111;color:#eee;border-radius:12px;'>
            <h2 style='font-size:20px;margin:0 0 12px;font-weight:700;'>Your sign-in code</h2>
            <p style='color:#aaa;margin:0 0 20px;font-size:14px;'>Masukkan kode ini untuk masuk ke Codex Internasional Community:</p>
            <div style='font-size:32px;font-weight:700;letter-spacing:8px;padding:16px 0;text-align:center;background:#000;color:#8fbe45;border-radius:8px;border:1px solid #333;'>
                {$code}
            </div>
            <p style='color:#666;font-size:12px;margin:20px 0 0;'>Kode berlaku " . (int)($expiresIn / 60) . " menit. Abaikan email ini jika bukan kamu.</p>
        </div>
    ";
    $mail->AltBody = "Kode masuk Codex: {$code} (berlaku " . (int)($expiresIn / 60) . " menit)";

    $mail->send();

    // Response
    echo json_encode([
        'ok'        => true,
        'expiresIn' => $expiresIn,
        'dev_code'  => $code, // ⚠️ HAPUS di production. Lihat catatan di bawah.
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'error'     => 'Mail failed',
        'detail'    => $mail->ErrorInfo,
        'exception' => $e->getMessage(),
        'smtp'      => [
            'host' => $SMTP_HOST,
            'port' => $SMTP_PORT,
            'user' => $SMTP_USER,
            'from' => $SMTP_FROM,
        ],
        'hints' => [
            'Gmail: pastikan SMTP_PASS = App Password 16 karakter (BUKAN password akun).',
            'Aktifkan 2FA di akun Google, lalu buat App Password di https://myaccount.google.com/apppasswords',
            'Jika port 587 diblokir operator, coba SMTP_PORT=465 (SMTPS).',
            'Pastikan extension openssl aktif: php -m | grep openssl',
        ],
    ]);
}