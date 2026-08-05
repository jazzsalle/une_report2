import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { analyzePackage } from '@une/hwpx-engine';
import {
  ObjectStorageError,
  sha256Of,
  uploadObjectKey,
  type ObjectStoragePort,
} from '@une/provider-adapters';
import { AuditRepository } from '../common/audit.repository';
import type { RequestMetaLike } from '../common/controller-utils';
import type { AuthContext } from '../common/request-context';
import { OBJECT_STORAGE } from '../common/storage.provider';
import { API_CONFIG, type ApiConfig } from '../config/api-config';
import { DatabaseService } from '../db/database.service';
import { fileErrors } from './file-errors';
import { FileRepository, type FileObjectRow } from './file.repository';
import { signUploadTicket, verifyUploadTicket } from './upload-ticket';

/**
 * UNE-DOC-001/002 — 3단 업로드 (설계 10 §2, CC-170).
 *
 * 바이트는 이 서비스를 지나가지 않는 것이 정상 경로다. presign이 가능한
 * 저장소에서는 클라이언트가 저장소로 직접 PUT하고, API는 자리를 예약하고
 * (`file_object` PENDING) 나중에 **저장된 바이트를 읽어** 검증한다.
 *
 * 검증 지점은 UNE-DOC-002 하나다. 전송 라우트는 저장만 하고 판단하지 않는다 —
 * 검사가 두 곳에 있으면 둘이 갈라지고, 갈라진 뒤에는 어느 쪽이 진실인지 알 수
 * 없다.
 */

/** 계약 FileObjectResource. `storageKey`는 나가지 않는다(테넌트 경로 = 내부 구조). */
export interface FileObjectResource {
  fileId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadState: FileObjectRow['uploadState'];
  scanStatus: string;
  verifiedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface FileUploadTicketResource {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
  maxSizeBytes: number;
  driver: 'PRESIGNED_S3' | 'API_DIRECT';
}

export interface FileRegistrationResource {
  file: FileObjectResource;
  upload: FileUploadTicketResource;
}

export interface FileRegisterInput {
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  sha256: string;
  purpose?: string;
}

/**
 * 허용 MIME. 확장자·헤더를 신뢰하지 않지만(`.claude/rules/security.md`), 선언
 * 단계에서 명백히 다른 종류를 걸러 두면 저장소에 올라갈 일 자체가 없어진다.
 * 최종 판정은 UNE-DOC-002의 내용 검사다.
 */
const HWPX_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/hwp+zip',
  'application/vnd.hancom.hwpx',
]);

/** CC-170이 실제로 처리하는 용도. 나머지는 각 항목에서 열린다. */
const IMPLEMENTED_PURPOSES: ReadonlySet<string> = new Set(['HWPX_IMPORT']);
const UPLOAD_PURPOSES: ReadonlySet<string> = new Set([
  'HWPX_IMPORT',
  'KNOWLEDGE_DOCUMENT',
  'ATTACHMENT',
]);

export function toFileResource(row: FileObjectRow): FileObjectResource {
  return {
    fileId: row.fileId,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    uploadState: row.uploadState,
    scanStatus: row.scanStatus,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class FileService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(FileRepository) private readonly files: FileRepository,
    @Inject(AuditRepository) private readonly audit: AuditRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  /** UNE-DOC-001 — 사전등록 + 업로드 티켓. */
  async register(
    auth: AuthContext,
    input: FileRegisterInput,
    meta: RequestMetaLike,
  ): Promise<FileRegistrationResource> {
    const purpose = input.purpose ?? 'HWPX_IMPORT';
    if (!UPLOAD_PURPOSES.has(purpose)) {
      throw fileErrors.invalidRequest([
        { field: 'purpose', reason: `${[...UPLOAD_PURPOSES].join('/')} 중 하나여야 합니다.` },
      ]);
    }
    if (!IMPLEMENTED_PURPOSES.has(purpose)) {
      throw fileErrors.registerRejected(`${purpose} 용도는 아직 지원하지 않습니다.`, [
        { field: 'purpose', reason: '현재 업로드 가능한 용도는 HWPX_IMPORT뿐입니다.' },
      ]);
    }
    if (!HWPX_MIME_TYPES.has(input.mimeType)) {
      throw fileErrors.registerRejected('HWPX 파일만 업로드할 수 있습니다.', [
        { field: 'mimeType', reason: `${[...HWPX_MIME_TYPES].join(' 또는 ')}여야 합니다.` },
      ]);
    }
    if (input.sizeBytes > this.config.uploadMaxBytes) {
      throw fileErrors.registerRejected('업로드 상한을 넘는 크기입니다.', [
        { field: 'sizeBytes', reason: `최대 ${this.config.uploadMaxBytes} 바이트입니다.` },
      ]);
    }

    // fileId를 여기서 만든다 — 저장 키에 들어가고, 키는 행과 함께 확정돼야 한다.
    const fileId = randomUUID();
    const storageKey = uploadObjectKey({
      tenantId: auth.tenantId,
      fileId,
      sha256: input.sha256,
      extension: 'hwpx',
    });

    const row = await this.db.withTenant(auth.tenantId, async (c) => {
      const inserted = await this.files.insert(c, {
        fileId,
        tenantId: auth.tenantId,
        storageKey,
        originalName: input.fileName.split(/[\\/]/).pop() ?? input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        createdBy: auth.userId,
      });
      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'FILE_REGISTERED',
        resourceType: 'FILE',
        resourceId: fileId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { purpose, sizeBytes: input.sizeBytes, sha256: input.sha256 },
      });
      return inserted;
    });

    return { file: toFileResource(row), upload: await this.issueTicket(row) };
  }

  /**
   * UNE-DOC-002 — 완료 확정.
   *
   * 저장소 읽기는 **트랜잭션 밖**이다(`.claude/rules/backend.md`). 그래서
   * 순서가 셋으로 갈린다: 상태 확인 → 바이트 검증 → 상태 확정. 마지막
   * 트랜잭션은 `upload_state = 'PENDING'`을 조건으로 옮기므로, 두 요청이
   * 동시에 검증을 통과해도 확정은 한 번만 일어난다.
   */
  async complete(
    auth: AuthContext,
    fileId: string,
    input: { etag?: string },
    meta: RequestMetaLike,
  ): Promise<FileObjectResource> {
    const row = await this.db.withTenant(auth.tenantId, (c) =>
      this.files.find(c, auth.tenantId, fileId),
    );
    if (!row) throw fileErrors.notFound();
    const settled = this.resolveSettled(row);
    if (settled) return settled;

    const violations = await this.verifyStoredBytes(row);
    if (violations.length > 0) {
      await this.db.withTenant(auth.tenantId, async (c) => {
        await this.files.markAborted(c, auth.tenantId, fileId);
        await this.audit.insertAudit(c, {
          tenantId: auth.tenantId,
          actorId: auth.userId,
          action: 'FILE_UPLOAD_REJECTED',
          resourceType: 'FILE',
          resourceId: fileId,
          correlationId: meta.correlationId,
          ip: meta.ip,
          userAgent: meta.userAgent,
          detail: { reasons: violations.map((v) => v.reason), etag: input.etag ?? null },
        });
      });
      throw fileErrors.verificationFailed(violations);
    }

    return this.db.withTenant(auth.tenantId, async (c) => {
      const verified = await this.files.markVerified(c, auth.tenantId, fileId);
      if (!verified) {
        // 그 사이 다른 요청이 옮겼다. 옮겨진 상태를 그대로 답한다.
        const current = await this.files.find(c, auth.tenantId, fileId);
        if (!current) throw fileErrors.notFound();
        const already = this.resolveSettled(current);
        if (already) return already;
        throw fileErrors.notUploaded();
      }
      await this.audit.insertAudit(c, {
        tenantId: auth.tenantId,
        actorId: auth.userId,
        action: 'FILE_UPLOAD_VERIFIED',
        resourceType: 'FILE',
        resourceId: fileId,
        correlationId: meta.correlationId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        // etag는 참고값이다(멀티파트에서는 MD5가 아니다). 근거는 재계산한 해시다.
        detail: {
          sha256: verified.sha256,
          sizeBytes: verified.sizeBytes,
          etag: input.etag ?? null,
        },
      });
      return toFileResource(verified);
    });
  }

  /**
   * 전송 라우트 — 티켓만으로 인가한다(Bearer 없음).
   *
   * 테넌트는 **티켓의 서명된 claim**에서 온다. 그 값으로 RLS 스코프를 열기
   * 때문에 조회 자체가 격리를 지킨다 — RLS를 우회하는 경로를 만들지 않는다.
   * 서명이 깨지거나 만료됐으면 여기까지 오지 못한다.
   */
  async storeByTicket(token: string, fileId: string, body: Uint8Array): Promise<void> {
    const claims = verifyUploadTicket(this.config.jwtSecret, token);
    if (!claims || claims.fileId !== fileId) throw fileErrors.ticketRejected();
    if (body.length > claims.sizeBytes) throw fileErrors.tooLarge();

    const row = await this.db.withTenant(claims.tenantId, (c) =>
      this.files.find(c, claims.tenantId, fileId),
    );
    if (!row) throw fileErrors.notFound();
    if (row.uploadState !== 'PENDING') throw fileErrors.alreadySettled(row.uploadState);

    try {
      await this.storage.put({
        key: row.storageKey,
        body,
        contentType: row.mimeType,
      });
    } catch (error) {
      throw this.storageError(error);
    }
  }

  /** 반입·다른 서비스가 쓰는 조회. VERIFIED 여부는 호출자가 판단한다. */
  async findFile(auth: AuthContext, fileId: string): Promise<FileObjectRow | null> {
    return this.db.withTenant(auth.tenantId, (c) => this.files.find(c, auth.tenantId, fileId));
  }

  /** 이미 확정된 상태인가. VERIFIED면 그 표현을, ABORTED면 422를 낸다. */
  private resolveSettled(row: FileObjectRow): FileObjectResource | null {
    if (row.uploadState === 'VERIFIED') return toFileResource(row);
    if (row.uploadState === 'ABORTED') {
      // 거절은 종단이다. 재확정으로 되살아나면 거절의 의미가 없다.
      throw fileErrors.verificationFailed([
        { field: 'fileId', reason: '이미 거절된 업로드입니다. 새로 등록하십시오.' },
      ]);
    }
    return null;
  }

  /**
   * 저장된 바이트를 사전등록 선언과 대조한다.
   *
   * 순서가 중요하다. 크기·해시가 어긋나면 그것으로 끝내고 HWPX 파서를 태우지
   * 않는다 — 신뢰할 수 없는 바이트를 굳이 더 깊이 읽을 이유가 없다.
   */
  private async verifyStoredBytes(
    row: FileObjectRow,
  ): Promise<{ field: string; reason: string }[]> {
    let bytes: Uint8Array;
    try {
      bytes = (await this.storage.get(row.storageKey)).body;
    } catch (error) {
      if (error instanceof ObjectStorageError && error.kind === 'NOT_FOUND') {
        throw fileErrors.notUploaded();
      }
      throw this.storageError(error);
    }

    const violations: { field: string; reason: string }[] = [];
    if (bytes.length !== row.sizeBytes) {
      violations.push({ field: 'sizeBytes', reason: '사전등록한 크기와 다릅니다.' });
    }
    if (sha256Of(bytes) !== row.sha256) {
      violations.push({ field: 'sha256', reason: '사전등록한 해시와 다릅니다.' });
    }
    if (violations.length > 0) return violations;

    // 내용 기반 형식 검증. 확장자·Content-Type이 아니라 ZIP 구조와 mimetype
    // 엔트리를 본다. 엔진의 패키지 분석을 재사용하는 이유는 "HWPX인가"의
    // 판정이 두 벌이 되지 않아야 하기 때문이다.
    try {
      const analysis = analyzePackage(bytes);
      if (analysis.mimetype !== 'application/hwp+zip') {
        violations.push({
          field: 'mimeType',
          reason: `HWPX 패키지가 아닙니다(mimetype=${analysis.mimetype ?? '없음'}).`,
        });
      }
      if (analysis.requiredParts.missing.length > 0) {
        violations.push({
          field: 'mimeType',
          reason: `HWPX 필수 Part가 없습니다: ${analysis.requiredParts.missing.join(', ')}`,
        });
      }
    } catch (error) {
      violations.push({
        field: 'mimeType',
        reason: `HWPX로 읽을 수 없습니다(${(error as Error).name}).`,
      });
    }
    return violations;
  }

  /**
   * 업로드 티켓 발급. presign이 되면 저장소로, 안 되면 API 전송 라우트로.
   *
   * 재발급이 자유롭다는 점이 중요하다 — 티켓은 만료되므로 멱등 재전송에
   * 원래 티켓을 그대로 재생하면 이미 쓸 수 없는 URL을 주게 된다.
   */
  private async issueTicket(row: FileObjectRow): Promise<FileUploadTicketResource> {
    const ttl = this.config.uploadTicketTtlSec;
    let presigned = null;
    try {
      presigned = await this.storage.presignPut({
        key: row.storageKey,
        contentType: row.mimeType,
        sha256: row.sha256,
        expiresInSeconds: ttl,
      });
    } catch (error) {
      throw this.storageError(error);
    }
    if (presigned) {
      return {
        url: presigned.url,
        method: 'PUT',
        headers: { ...presigned.headers },
        expiresAt: presigned.expiresAt,
        maxSizeBytes: this.config.uploadMaxBytes,
        driver: 'PRESIGNED_S3',
      };
    }

    const expiresAt = Math.floor(Date.now() / 1000) + ttl;
    const token = signUploadTicket(this.config.jwtSecret, {
      fileId: row.fileId,
      tenantId: row.tenantId,
      expiresAt,
      sizeBytes: row.sizeBytes,
    });
    return {
      url: `${this.config.publicBaseUrl}/api/v1/files/${row.fileId}/content?token=${encodeURIComponent(token)}`,
      method: 'PUT',
      headers: { 'Content-Type': row.mimeType },
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      maxSizeBytes: this.config.uploadMaxBytes,
      driver: 'API_DIRECT',
    };
  }

  private storageError(error: unknown): Error {
    if (error instanceof ObjectStorageError) return fileErrors.storageUnavailable();
    return error as Error;
  }
}
