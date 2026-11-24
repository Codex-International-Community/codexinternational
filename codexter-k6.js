import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { SharedArray } from 'k6/data';
import { Rate, Trend } from 'k6/metrics';

// ============================================================================
// KONFIGURASI â€” SESUAIKAN ENDPOINT DENGAN REPO GITHUB KAMU
// ============================================================================
const CONFIG = {
  baseUrl: __ENV.BASE_URL || 'https://app.codexinternational.web.id',
  // Ganti path di bawah sesuai route asli di backend/frontend kamu
  endpoints: {
    home: '/',
    profile: '/api/v1/auth/me',
    feed: '/api/v1/channels/01a1f8f9-2c79-70c4-997a-d0ffe4570fde/messages',
    presign: '/api/v1/media/presign',
    channelId: __ENV.CHANNEL_ID || '01a1f8f9-2c79-70c4-997a-d0ffe4570fde',
  },
  // Jika auth pakai Cookie bukan Bearer header, ubah ke true
  useCookieAuth: false,
  cookieName: 'token',
};

// ============================================================================
// LOAD 2.000 TOKEN DARI CSV (HEMAT RAM DENGAN SharedArray)
// ============================================================================
const users = new SharedArray('loadtest_tokens', function () {
  const raw = open('./loadtest_tokens.csv').trim().split('\n');
  raw.shift(); // buang header: id,username,email,token
  return raw
    .map((line) => {
      const [id, sid, username, email, token] = line.trim().split(',');
      return { id, sid, username, email, token };
    })
    .filter((u) => u.token);
});

// Load media dummy (codexter.jpg) untuk simulasi upload
const mediaBytes = open('./codexter.jpg', 'b');

// Custom Metrics
const errorRate = new Rate('app_errors');
const apiDuration = new Trend('api_duration_ms');

// ============================================================================
// PILIHAN SKENARIO (Jalankan via -e MODE=smoke|breakpoint|extreme)
// ============================================================================
const MODE = __ENV.MODE || 'breakpoint';
const MEDIA_RATIO = parseFloat(__ENV.MEDIA_RATIO || '0.3'); // porsi iterasi yang mengirim media

const SCENARIOS = {
  // 1. Cek dulu semua endpoint & token jalan normal (200 OK)
  smoke: {
    executor: 'constant-vus',
    vus: 10,
    duration: '30s',
  },

  // 2. Cari batas maksimal CU secara bertahap (50 -> 2.000 CU)
  breakpoint: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '10s', target: 500 },   // Lonjakan langsung ke 500 VU
      { duration: '40s',  target: 500 },   // Tahan 500 VU penuh, tanpa jeda panjang
      { duration: '10s', target: 0 },     // Cool-down
    ],
    gracefulRampDown: '15s',
  },

  // 3. Loadtest Ekstrem (Spike brutal langsung ke 1.000 -> 2.000 CU)
  extreme: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '15s', target: 500 },
      { duration: '30s', target: 1500 },
      { duration: '2m',  target: 2000 },  // Tahan 2.000 CU penuh selama 2 menit
      { duration: '15s', target: 0 },
    ],
    gracefulRampDown: '10s',
  },
};

export const options = {
  scenarios: {
    default: SCENARIOS[MODE] || SCENARIOS.breakpoint,
  },
  // Stop otomatis hanya pada mode 'breakpoint' jika error > 15% agar titik patah terlihat jelas
  thresholds: {
    http_req_failed:
      MODE === 'breakpoint'
        ? [{ threshold: 'rate<0.50', abortOnFail: true, delayAbortEval: '30s' }]
        : ['rate<0.10'],
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    app_errors: ['rate<0.10'],
  },
  // Optimasi k6 untuk ribuan VU
  discardResponseBodies: true, // Hemat RAM di sisi penguji
  noConnectionReuse: false,    // Pakai HTTP Keep-Alive seperti browser asli
};

// ============================================================================
// ALUR EKSEKUSI PER VIRTUAL USER
// ============================================================================
export default function () {
  // Setiap VU mengambil user unik dari 2.000 token
  const user = users[(__VU - 1) % users.length];

  const headers = {
    Accept: 'application/json',
    'User-Agent': 'k6-codex-loadtest/1.0',
  };

  if (CONFIG.useCookieAuth) {
    headers.Cookie = `${CONFIG.cookieName}=${user.token}`;
  } else {
    headers.Authorization = `Bearer ${user.token}`;
  }

  const params = { headers, timeout: '15s' };

  // Request 1: Landing / Health
  group('01_Home', () => {
    const res = http.get(`${CONFIG.baseUrl}${CONFIG.endpoints.home}`, {
      timeout: '15s',
      tags: { name: 'GET_Home' },
    });
    const ok = check(res, { 'home status 200': (r) => r.status === 200 });
    errorRate.add(!ok);
  });

  // Request 2: Authenticated Profile (verifikasi JWT + session)
  group('02_Profile', () => {
    const res = http.get(`${CONFIG.baseUrl}${CONFIG.endpoints.profile}`, {
      ...params,
      tags: { name: 'GET_Profile' },
    });
    apiDuration.add(res.timings.duration);
    const ok = check(res, {
      'profile status 200': (r) => r.status === 200,
      'not rate-limited (429)': (r) => r.status !== 429,
    });
    errorRate.add(!ok);
  });

  // Request 3: Data / DB Read
  group('03_Feed', () => {
    const res = http.get(`${CONFIG.baseUrl}${CONFIG.endpoints.feed}`, {
      ...params,
      tags: { name: 'GET_Feed' },
    });
    apiDuration.add(res.timings.duration);
    const ok = check(res, { 'feed status 200': (r) => r.status === 200 });
    errorRate.add(!ok);
  });

  // Request 4: Aktivitas chat campuran (default 30% media, 70% teks)
  group('04_Chat', () => {
    const jsonHeaders = { ...headers, 'Content-Type': 'application/json' };
    const msgUrl = `${CONFIG.baseUrl}/api/v1/channels/${CONFIG.endpoints.channelId}/messages`;
    const clientMsgId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
    const isAccepted = (r) => r.status === 200 || r.status === 201 || r.status === 202;

    if (Math.random() < MEDIA_RATIO) {
      // --- Alur media: presign -> PUT ke R2 -> complete -> kirim pesan dengan media_id ---
      const presignRes = http.post(
        `${CONFIG.baseUrl}${CONFIG.endpoints.presign}`,
        JSON.stringify({
          fileName: 'codexter.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: mediaBytes.byteLength,
          channelId: CONFIG.endpoints.channelId,
        }),
        { headers: jsonHeaders, timeout: '15s', responseType: 'text', tags: { name: 'POST_MediaPresign' } }
      );
      apiDuration.add(presignRes.timings.duration);
      const okPresign = check(presignRes, { 'presign 200': (r) => r.status === 200 });
      errorRate.add(!okPresign);
      if (!okPresign) return;

      let presign;
      try { presign = JSON.parse(presignRes.body); } catch (_) { errorRate.add(true); return; }

      const putRes = http.put(presign.uploadUrl, mediaBytes, {
        headers: { 'Content-Type': 'image/jpeg' },
        timeout: '30s',
        tags: { name: 'PUT_MediaUpload' },
      });
      const okPut = check(putRes, { 'upload R2 2xx': (r) => r.status >= 200 && r.status < 300 });
      errorRate.add(!okPut);
      if (!okPut) return;

      const completeRes = http.post(
        `${CONFIG.baseUrl}/api/v1/media/${presign.mediaId}/complete`,
        '{}',
        { headers: jsonHeaders, timeout: '15s', tags: { name: 'POST_MediaComplete' } }
      );
      apiDuration.add(completeRes.timings.duration);
      const okComplete = check(completeRes, { 'media complete 200': (r) => r.status === 200 });
      errorRate.add(!okComplete);
      if (!okComplete) return;

      const msgRes = http.post(
        msgUrl,
        JSON.stringify({
          client_msg_id: clientMsgId,
          content: `Loadtest media from ${user.username}`,
          media_id: presign.mediaId,
        }),
        { headers: jsonHeaders, timeout: '15s', tags: { name: 'POST_SendMessageMedia' } }
      );
      apiDuration.add(msgRes.timings.duration);
      const okMsg = check(msgRes, { 'send media message accepted': isAccepted });
      errorRate.add(!okMsg);
    } else {
      // --- Alur teks ---
      const msgRes = http.post(
        msgUrl,
        JSON.stringify({
          client_msg_id: clientMsgId,
          content: `Loadtest message from ${user.username}`,
        }),
        { headers: jsonHeaders, timeout: '15s', tags: { name: 'POST_SendMessageText' } }
      );
      apiDuration.add(msgRes.timings.duration);
      const okMsg = check(msgRes, { 'send text message accepted': isAccepted });
      errorRate.add(!okMsg);
    }
  });

  // Think time: 1-3 detik di mode normal, 0.2-0.5 detik di mode extreme
  if (MODE === 'extreme' || MODE === 'breakpoint') {
    sleep(0.2 + Math.random() * 0.3);
  } else {
    sleep(1 + Math.random() * 2);
  }
}