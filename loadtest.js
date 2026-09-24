import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

export const wins = new Counter('won_true_count');
export const losses = new Counter('won_false_count');

export const options = {
  scenarios: {
    tatkal_rush: {
      executor: 'per-vu-iterations',
      vus: 2000,
      iterations: 1,
      maxDuration: '30s',
    },
  },
};

export default function () {
  const url = 'http://localhost:3000/api/book';
  const payload = JSON.stringify({
    userId: `user_${__VU}`,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post(url, payload, params);

  try {
    const data = JSON.parse(res.body);
    if (data.won === true) {
      wins.add(1);
    } else if (data.won === false) {
      losses.add(1);
    }
  } catch (err) {
    console.error(`VU ${__VU} error: ${err}`);
  }

  check(res, {
    'status is 200': (r) => r.status === 200,
  });
}
