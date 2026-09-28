import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

export const accepted202 = new Counter('accepted_202_count');
export const wins = new Counter('won_true_count');
export const losses = new Counter('won_false_count');
export const serverErrors = new Counter('server_error_count');
export const acceptanceRate = new Rate('acceptance_rate');

export const options = {
  scenarios: {
    tatkal_rush: {
      executor: 'shared-iterations',
      vus: 100,
      iterations: 2000,
      maxDuration: '15s',
    },
  },
};

export default function () {
  const url = 'http://localhost:3000/api/book';
  const payload = JSON.stringify({
    userId: `user_${__VU}_${__ITER}`,
  });

  const params = {
    headers: { 'Content-Type': 'application/json' },
  };

  // 1. Enter the Virtual Waiting Room
  const res = http.post(url, payload, params);

  const isAccepted = res.status === 202;
  acceptanceRate.add(isAccepted);

  if (isAccepted) {
    accepted202.add(1);
    const data = JSON.parse(res.body);
    const jobId = data.jobId;

    // 2. Poll for final confirmation (up to 5 attempts with 200ms delay)
    let completed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      sleep(0.2);
      const statusRes = http.get(`http://localhost:3000/api/book/status/${jobId}`);
      if (statusRes.status === 200) {
        const result = JSON.parse(statusRes.body);
        if (result.status === 'COMPLETED') {
          if (result.won === true) {
            wins.add(1);
          } else {
            losses.add(1);
          }
          completed = true;
          break;
        }
      }
    }
  } else {
    serverErrors.add(1);
  }

  check(res, {
    'status is 202 Accepted': (r) => r.status === 202,
  });
}
