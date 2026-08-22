/**
 * JSON 파일 저장소. 컬렉션 하나 = 파일 하나. 단일 PC POC라 동기 쓰기로 충분하다.
 * 개발팀이 DB로 옮길 때는 이 파일만 바꾸면 된다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';

export const DATA_DIR = join(process.cwd(), '..', 'data');
export const FILES_DIR = join(DATA_DIR, 'files');
for (const d of [DATA_DIR, FILES_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

export interface Row {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** 휴지통(소프트 삭제): 찍혀 있으면 목록에서 빠진다. main.ts의 /api/trash가 복원·완전 삭제 */
  deletedAt?: string;
  deletedBy?: string;
  [k: string]: unknown;
}

export class Collection<T extends Row = Row> {
  private rows: T[];
  private readonly path: string;
  constructor(readonly name: string) {
    this.path = join(DATA_DIR, `${name}.json`);
    this.rows = existsSync(this.path) ? (JSON.parse(readFileSync(this.path, 'utf8')) as T[]) : [];
  }
  private flush(): void {
    writeFileSync(this.path, JSON.stringify(this.rows, null, 1), 'utf8');
  }
  all(): T[] {
    return [...this.rows];
  }
  where(pred: (r: T) => boolean): T[] {
    return this.rows.filter(pred);
  }
  get(id: string): T | undefined {
    return this.rows.find((r) => r.id === id);
  }
  insert(data: Omit<T, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): T {
    const now = new Date().toISOString();
    const row = { ...data, id: data.id ?? nanoid(10), createdAt: now, updatedAt: now } as T;
    this.rows.push(row);
    this.flush();
    return row;
  }
  update(id: string, patch: Partial<T>): T | undefined {
    const row = this.get(id);
    if (!row) return undefined;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    this.flush();
    return row;
  }
  remove(id: string): boolean {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    if (this.rows.length !== before) this.flush();
    return this.rows.length !== before;
  }
}

/** 지연 초기화 — 컬렉션마다 파일 하나. */
const cache = new Map<string, Collection<Row>>();
export function col<T extends Row = Row>(name: string): Collection<T> {
  if (!cache.has(name)) cache.set(name, new Collection<Row>(name));
  return cache.get(name) as unknown as Collection<T>;
}
