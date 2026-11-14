// Smoke test k6 do fluxo principal (POST /readings).
// Uso:  k6 run k6/smoke.js
//       k6 run -e BASE_URL=http://localhost:3000 k6/smoke.js
//
// Simula sensores enviando leituras: ~90% normais, ~8% atenção, ~2% alarme.
// O threshold reflete o SLO: p95 de POST /readings < 200 ms e < 1% de erros.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    'http_req_duration{endpoint:readings}': ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function randomPpm() {
  const r = Math.random();
  if (r < 0.02) return 10000 + Math.random() * 10000; // alarme
  if (r < 0.10) return 4000 + Math.random() * 5999; // atenção
  return Math.random() * 3000; // normal
}

export default function () {
  // 50 sensores distribuídos entre os usuários virtuais.
  const sensorId = `SMOKE-${String((__VU * 7 + __ITER) % 50).padStart(3, '0')}`;
  const res = http.post(
    `${BASE_URL}/readings`,
    JSON.stringify({ sensorId, ppm: Math.round(randomPpm() * 100) / 100 }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'readings' } },
  );
  check(res, {
    'status 201': (r) => r.status === 201,
    'tem alertAction': (r) => r.json('alertAction') !== undefined,
  });
  sleep(0.1);
}
