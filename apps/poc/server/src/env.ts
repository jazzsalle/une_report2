/** .env 로더 — 다른 모듈보다 먼저 import되어야 한다 (모듈 상수가 process.env를 로드 시점에 읽는다). */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../../infrastructure/.env')]) {
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}
