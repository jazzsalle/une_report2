from __future__ import annotations
import hashlib
import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

app = FastAPI(title="UNE Platform Mock", version="1.0.0")
DB: dict[str, dict[str, Any]] = {"plans": {}, "planSnapshots": {}, "tocVersions": {}, "jobs": {}, "blocks": {}, "situations": {}, "snapshots": {}, "sops": {}, "runs": {}, "tasks": {}, "journals": {}}
# Snapshot version counter per plan (UNE-PLAN-007 version_no = max+1).
PLAN_SNAPSHOT_SEQ: dict[str, int] = {}
# TOC version counter per plan (UNE-PLAN-014 version_no = max+1).
PLAN_TOC_SEQ: dict[str, int] = {}
# Poll counter per job: the mock completes a job from the second status read on.
JOB_READS: dict[str, int] = {}
# CONTENT job request payload (tocVersionId/targetNodeKeys/protectedBlockIds).
# Kept out of the job resource so the mock response stays contract shaped.
JOB_INPUT: dict[str, dict[str, Any]] = {}
# Fixed non-secret demo identifiers so tenantId/ownerId stay stable across calls.
MOCK_TENANT_ID = "00000000-0000-4000-8000-000000000001"
MOCK_USER_ID = "00000000-0000-4000-8000-000000000002"

# CC-110 contract vocabulary (une-platform-api-v1.yaml PlanHazardType /
# PlanManagementPhase / PlanStartMode).
HAZARD_TYPES = ["폭염", "태풍/호우", "지진", "황사", "산불", "감염병", "가축질병", "다중밀집건축물붕괴대형사고", "정부주요시설", "학교시설"]
MANAGEMENT_PHASES = ["예방", "대비"]
START_MODES = ["BLANK", "UPLOAD_HWPX", "RECENT"]

def now(): return datetime.now(timezone.utc).isoformat()
def envelope(data: Any, correlation_id: str | None = None):
    return {"success": True, "data": data, "meta": {"requestId": f"req_{uuid4().hex[:12]}", "correlationId": correlation_id or f"corr_{uuid4().hex[:12]}", "timestamp": now(), "schemaVersion": "1.0"}}

def require_idempotency(key: str | None):
    if not key: raise HTTPException(status_code=400, detail="Idempotency-Key required")

def content_hash(payload: Any) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()

# CC-120 contract vocabulary (JobStatus / GenerationJobResource / TocVersionResource).
JOB_OPEN_STATUSES = ("QUEUED", "RUNNING")
JOB_TERMINAL_STATUSES = ("COMPLETED", "FAILED", "CANCELLED")
# PLAN-409-002 is job-type agnostic (UNE-PLAN-009/016): any active generation job
# on the plan blocks a new one. Mirrors ACTIVE_JOB_STATUSES in the API repository.
JOB_ACTIVE_STATUSES = JOB_OPEN_STATUSES + ("CANCEL_REQUESTED",)
# CC-130 (ADR-27): a CONTENT job starts from a confirmed outline; EDITING allows
# regeneration rounds. Success lands back in EDITING.
CONTENT_JOB_STARTABLE = ("OUTLINE_CONFIRMED", "EDITING")

def get_plan_or_404(plan_id: str) -> dict[str, Any]:
    if plan_id not in DB["plans"]: raise HTTPException(404,"PLAN-4003: Plan not found")
    return DB["plans"][plan_id]

def get_job_or_404(job_id: str) -> dict[str, Any]:
    if job_id not in DB["jobs"]: raise HTTPException(404,"JOB-404-001: Job not found")
    return DB["jobs"][job_id]

def assert_no_active_generation_job(plan_id: str) -> None:
    if any(j["aggregateId"]==plan_id and j["status"] in JOB_ACTIVE_STATUSES for j in DB["jobs"].values()):
        raise HTTPException(409,"PLAN-409-002: a generation job is already active for this plan")

def flatten_nodes(nodes: list[dict[str, Any]], level: int = 1) -> list[tuple[dict[str, Any], int]]:
    """TocNodeResource tree -> [(node, level)] in document order."""
    flat: list[tuple[dict[str, Any], int]] = []
    for node in nodes:
        flat.append((node, level))
        flat.extend(flatten_nodes(node.get("children") or [], level + 1))
    return flat

def current_blocks(plan_id: str) -> dict[str, dict[str, Any]]:
    """nodeKey -> current (not superseded) generated_block of the plan."""
    return {b["nodeKey"]: b for b in DB["blocks"].values() if b["planId"]==plan_id and b["supersededAt"] is None}

def assert_no_current_blocks(plan_id: str, action: str) -> None:
    """UNE-PLAN-009 / 014 (ADR-27 D9): 본문 블록은 목차 nodeKey에 앵커되어 있으므로,
    목차 변경 영향 Diff 흐름(CC-170)이 생기기 전까지 목차 재생성·변경을 막는다."""
    if current_blocks(plan_id):
        raise HTTPException(412,f"PLAN-412-002: cannot {action} while generated content blocks exist (CC-170)")

def build_nodes(tree: list[dict[str, Any]], level: int = 1, path: tuple[int, ...] = (), ai: bool = False) -> list[dict[str, Any]]:
    """TocTreeNodeInput[] -> TocNodeResource[].

    nodeKey: AI 목차는 경로 기반(n-1, n-1-2 ...), 사용자 신규 노드는 u-<8hex>.
    입력이 nodeKey를 실으면 기존 키를 그대로 승계한다.
    """
    # 마이그레이션 0015 ck_toc_node_level: 목차 계층은 1~6단계.
    if level > 6: raise HTTPException(422,"PLAN-422-002: tocTree depth must not exceed 6 levels")
    nodes = []
    for order, raw in enumerate(tree):
        if not isinstance(raw, dict) or not str(raw.get("title") or "").strip():
            raise HTTPException(422,"PLAN-422-002: every tocTree node requires a non-empty title")
        node_path = path + (order + 1,)
        default_key = "n-" + "-".join(str(i) for i in node_path) if ai else f"u-{uuid4().hex[:8]}"
        nodes.append({
            "nodeKey": raw.get("nodeKey") or default_key,
            "title": raw["title"],
            "level": level,
            "sortOrder": order,
            "generationPolicy": raw.get("generationPolicy") or {"mode": "GENERATE"},
            "children": build_nodes(raw.get("children") or [], level + 1, node_path, ai),
        })
    return nodes

def save_toc_version(plan: dict[str, Any], nodes: list[dict[str, Any]], source_type: str, status: str) -> dict[str, Any]:
    vno = PLAN_TOC_SEQ.get(plan["planId"], 0) + 1; PLAN_TOC_SEQ[plan["planId"]] = vno
    version = {
        "tocVersionId": str(uuid4()), "planId": plan["planId"], "versionNo": vno,
        "sourceType": source_type, "baseSnapshotId": plan["currentContextSnapshotId"],
        "status": status, "contentHash": content_hash(nodes), "createdBy": MOCK_USER_ID,
        "createdAt": now(), "nodes": nodes,
    }
    DB["tocVersions"][version["tocVersionId"]] = version
    plan["currentTocVersionId"] = version["tocVersionId"]; plan["updatedAt"] = version["createdAt"]
    return version

class PlanCreate(BaseModel):
    # Fields stay optional at parse time so every violation answers 400
    # PLAN-4001 (contract x-error-codes) instead of FastAPI's default 422.
    title: str | None = None
    startMode: str | None = None
    hazardType: str | None = None
    managementPhase: str | None = None
    templateFileId: str | None = None

class SituationCreate(BaseModel):
    mode: str
    title: str
    hazardType: str
    occurredAt: str | None = None
    location: str | None = None

@app.get("/health")
def health(): return {"status":"UP","time":now()}

@app.post("/api/v1/auth/sso/exchange")
def sso(body: dict[str,Any]):
    return envelope({"accessToken":"mock-access-token","refreshToken":"mock-refresh-token","expiresIn":3600,"userContext":{"userId":str(uuid4()),"tenantId":str(uuid4()),"roles":["SYSTEM_ADMIN"]}})

@app.post("/api/v1/plans")
def create_plan(body: PlanCreate, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    require_idempotency(idempotency_key)
    if not body.title or len(body.title) > 300: raise HTTPException(400,"PLAN-4001: title is required (1..300)")
    if body.startMode not in START_MODES: raise HTTPException(400,f"PLAN-4001: startMode must be one of {START_MODES}")
    if body.hazardType not in HAZARD_TYPES: raise HTTPException(400,"PLAN-4001: hazardType must be one of the 10 contract values")
    if body.managementPhase not in MANAGEMENT_PHASES: raise HTTPException(400,f"PLAN-4001: managementPhase must be one of {MANAGEMENT_PHASES}")
    # ADR-23 D3: template upload is CC-140 scope; a value is rejected until then.
    if body.templateFileId is not None: raise HTTPException(400,"PLAN-4001: templateFileId is deferred to CC-140")
    pid=str(uuid4()); ts=now()
    item={"planId":pid,"tenantId":MOCK_TENANT_ID,"title":body.title,"hazardType":body.hazardType,"managementPhase":body.managementPhase,"status":"DRAFT","documentId":None,"currentContextSnapshotId":None,"currentTocVersionId":None,"startMode":body.startMode,"ownerId":MOCK_USER_ID,"versionNo":1,"deletedAt":None,"createdAt":ts,"updatedAt":ts}
    DB["plans"][pid]=item
    return JSONResponse(envelope(item), status_code=201)

@app.get("/api/v1/plans/{plan_id}")
def get_plan(plan_id: str):
    if plan_id not in DB["plans"]: raise HTTPException(404,"PLAN-4003: Plan not found")
    plan=DB["plans"][plan_id]
    detail={**plan,"currentContextSnapshot":DB["planSnapshots"].get(plan["currentContextSnapshotId"])}
    return JSONResponse(envelope(detail),headers={"ETag":str(plan["versionNo"])})

@app.post("/api/v1/plans/{plan_id}/context-snapshots")
def context_snapshot(plan_id: str, body: dict[str,Any], idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    require_idempotency(idempotency_key)
    if plan_id not in DB["plans"]: raise HTTPException(404,"PLAN-4003: Plan not found")
    plan=DB["plans"][plan_id]
    if plan["deletedAt"] is not None: raise HTTPException(412,"PLAN-412-002: plan is in trash")
    sid=str(uuid4()); ts=now(); vno=PLAN_SNAPSHOT_SEQ.get(plan_id,0)+1; PLAN_SNAPSHOT_SEQ[plan_id]=vno
    snap={"contextSnapshotId":sid,"planId":plan_id,"versionNo":vno,"contextJson":body,"contentHash":content_hash(body),"supersedesId":plan["currentContextSnapshotId"],"confirmedBy":MOCK_USER_ID,"confirmedAt":ts}
    DB["planSnapshots"][sid]=snap
    # 설계 09 §4: DRAFT -> CONTEXT_READY (CONTEXT_CONFIRMED is not a plan state).
    if plan["status"]=="DRAFT": plan["status"]="CONTEXT_READY"
    plan["currentContextSnapshotId"]=sid; plan["versionNo"]+=1; plan["updatedAt"]=ts
    return JSONResponse(envelope(snap),status_code=201)

@app.post("/api/v1/plans/{plan_id}/toc-jobs")
def toc_job(plan_id: str, body: dict[str,Any], idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    require_idempotency(idempotency_key)
    plan=get_plan_or_404(plan_id)
    if plan["deletedAt"] is not None: raise HTTPException(412,"PLAN-412-002: plan is in trash")
    # PLAN-412-001 keeps its 설계 8.3 meaning: no confirmed PlanContextSnapshot yet.
    if not plan["currentContextSnapshotId"]: raise HTTPException(412,"PLAN-412-001: confirm a PlanContextSnapshot first")
    if body.get("contextSnapshotId") != plan["currentContextSnapshotId"]:
        raise HTTPException(400,"PLAN-4001: contextSnapshotId must be the current snapshot of the plan")
    option=body.get("generationOption") or {}
    if not isinstance(option,dict) or set(option) - {"additionalInstruction","notes"}:
        raise HTTPException(400,"PLAN-4001: generationOption allows additionalInstruction and notes only")
    assert_no_active_generation_job(plan_id)
    # ADR-27 D9: 본문 블록이 있으면 목차 재생성이 nodeKey 앵커를 끊는다.
    # 목차 변경 영향 Diff 흐름(CC-170)이 생길 때까지 막는다.
    assert_no_current_blocks(plan_id,"regenerate the outline")
    jid=str(uuid4()); ts=now()
    job={"jobId":jid,"jobType":"TOC","aggregateType":"PLAN","aggregateId":plan_id,"providerCode":"T3Q",
         "status":"QUEUED","progressPct":0,"attemptNo":0,"correlationId":f"corr_{uuid4().hex[:12]}",
         "startedAt":None,"finishedAt":None,"error":None,"result":None,"createdAt":ts}
    DB["jobs"][jid]=job; JOB_READS[jid]=0
    plan["status"]="OUTLINE_GENERATING"; plan["updatedAt"]=ts
    return JSONResponse(envelope(job),status_code=202)

@app.post("/api/v1/plans/{plan_id}/content-jobs")
def content_job(plan_id: str, body: dict[str,Any], idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    """UNE-PLAN-016 T3Q RPT-002 본문 생성 Job (계약 상세화 CC-130)."""
    require_idempotency(idempotency_key)
    plan=get_plan_or_404(plan_id)
    if plan["deletedAt"] is not None: raise HTTPException(412,"PLAN-412-002: plan is in trash")
    if not plan["currentContextSnapshotId"]: raise HTTPException(412,"PLAN-412-001: confirm a PlanContextSnapshot first")
    if body.get("contextSnapshotId") != plan["currentContextSnapshotId"]:
        raise HTTPException(400,"PLAN-4001: contextSnapshotId must be the current snapshot of the plan")
    version=DB["tocVersions"].get(body.get("tocVersionId"))
    if not version or version["planId"]!=plan_id: raise HTTPException(404,"TOC-404-001: TOC version not found for this plan")
    if version["status"]!="CONFIRMED": raise HTTPException(412,"PLAN-412-002: confirm the TOC version before generating content")
    targets=body.get("targetNodeKeys")
    # 전체 생성은 필드 생략으로 표현한다. 빈 배열/중복은 400 PLAN-4001.
    if targets is not None and (not isinstance(targets,list) or not targets or len(targets)>100
                                or any(not isinstance(k,str) for k in targets) or len(set(targets))!=len(targets)):
        raise HTTPException(400,"PLAN-4001: targetNodeKeys must be 1..100 unique node keys (omit it for the full outline)")
    targets=targets or []
    known={node["nodeKey"] for node,_ in flatten_nodes(version["nodes"])}
    if [k for k in targets if k not in known]: raise HTTPException(422,"PLAN-422-002: targetNodeKeys contains keys outside the TOC version")
    protected_ids=body.get("protectedBlockIds") or []
    if not isinstance(protected_ids,list) or any(not isinstance(b,str) for b in protected_ids):
        raise HTTPException(400,"PLAN-4001: protectedBlockIds must be an array of block ids")
    live={b["blockId"] for b in current_blocks(plan_id).values()}
    if [b for b in protected_ids if b not in live]: raise HTTPException(422,"PLAN-422-002: protectedBlockIds contains unknown or superseded block ids")
    # 409를 상태 전제조건보다 먼저 본다: CONTENT_GENERATING은 활성 job이 있다는 뜻이라
    # 412가 아니라 409 PLAN-409-002로 답해야 한다 (ADR-27 D9 주석과 동일 규칙).
    assert_no_active_generation_job(plan_id)
    if plan["status"] not in CONTENT_JOB_STARTABLE:
        raise HTTPException(412,f"PLAN-412-002: content generation starts from {CONTENT_JOB_STARTABLE}")
    jid=str(uuid4()); ts=now()
    job={"jobId":jid,"jobType":"CONTENT","aggregateType":"PLAN","aggregateId":plan_id,"providerCode":"T3Q",
         "status":"QUEUED","progressPct":0,"attemptNo":0,"correlationId":f"corr_{uuid4().hex[:12]}",
         "startedAt":None,"finishedAt":None,"error":None,"result":None,"createdAt":ts}
    DB["jobs"][jid]=job; JOB_READS[jid]=0
    JOB_INPUT[jid]={"tocVersionId":version["tocVersionId"],"targetNodeKeys":targets,"protectedBlockIds":protected_ids}
    plan["status"]="CONTENT_GENERATING"; plan["updatedAt"]=ts
    return JSONResponse(envelope(job),status_code=202)

def complete_content_job(job: dict[str, Any]) -> None:
    """워커 대역: 대상 노드만 재생성하고 보호 블록은 유지한다.

    범위 밖 노드는 이번 job의 대상이 아니므로 손대지 않고, content.block 프레임도
    contentSummary 집계도 발생하지 않는다 (계약 UNE-PLAN-011/016). preserved는
    보호(USER_LOCKED/SYSTEM_LOCKED)로 유지된 블록만 센다.
    """
    plan=DB["plans"][job["aggregateId"]]; job_input=JOB_INPUT.get(job["jobId"],{})
    version=DB["tocVersions"][job_input["tocVersionId"]]
    existing=current_blocks(plan["planId"])
    # protectedBlockIds는 USER_LOCKED로 영속 기록되어 이후 재생성에서도 보호된다.
    for block_id in job_input.get("protectedBlockIds") or []:
        DB["blocks"][block_id]["protectionState"]="USER_LOCKED"
    targets=job_input.get("targetNodeKeys") or []
    # 범위 지정은 subtree 단위다. AI nodeKey가 경로 기반(n-1, n-1-2)이라 접두어 비교로 충분하다.
    in_scope=lambda key: not targets or any(key==t or key.startswith(t+"-") for t in targets)
    summary={"generated":0,"preserved":0,"failed":0,"blocksWithoutEvidence":0,"tocVersionId":version["tocVersionId"]}
    for order,(node,level) in enumerate(flatten_nodes(version["nodes"]),start=1):
        key=node["nodeKey"]; prior=existing.get(key)
        # 범위 밖 노드는 대상이 아니다: 집계도 이벤트 발행도 하지 않는다.
        if not in_scope(key): continue
        if prior and prior["protectionState"] in ("USER_LOCKED","SYSTEM_LOCKED"):
            summary["preserved"]+=1; continue
        if prior: prior["supersededAt"]=now()
        text=f"{node['title']} 본문(mock)"
        # 첫 노드만 근거를 붙여 blocksWithoutEvidence 지표가 0이 아닌 상태를 재현한다.
        citation_count=2 if order==1 else 0
        block={"blockId":str(uuid4()),"planId":plan["planId"],"tocVersionId":version["tocVersionId"],
               "nodeKey":key,"outlineLevel":level,"sortOrder":order,"status":"GENERATED",
               "protectionState":"NONE","contentHash":content_hash(text),"citationCount":citation_count,
               "supersededAt":None,"createdAt":now()}
        DB["blocks"][block["blockId"]]=block
        summary["generated"]+=1
        if citation_count==0: summary["blocksWithoutEvidence"]+=1
    job.update(status="COMPLETED",progressPct=100,finishedAt=now(),
               result={"tocVersionId":version["tocVersionId"],"contentSummary":summary})
    plan["status"]="EDITING"; plan["updatedAt"]=job["finishedAt"]

@app.get("/api/v1/plan-jobs/{job_id}")
def get_job(job_id: str):
    job=get_job_or_404(job_id)
    JOB_READS[job_id]=JOB_READS.get(job_id,0)+1
    if job["status"] in JOB_OPEN_STATUSES:
        if JOB_READS[job_id]==1:
            # ADR-25 D9: attempt_no counts worker preemptions; the first read stands in
            # for the worker picking the job up.
            job["status"]="RUNNING"; job["progressPct"]=50; job["attemptNo"]+=1; job["startedAt"]=job["startedAt"] or now()
        elif job["jobType"]=="CONTENT":
            complete_content_job(job)
        else:
            plan=DB["plans"].get(job["aggregateId"])
            version=save_toc_version(plan,build_nodes([
                {"title":"1. 추진 배경","children":[{"title":"1.1. 목적"}]},
                {"title":"2. 세부 추진계획"},
            ],ai=True),"AI","DRAFT")
            job.update(status="COMPLETED",progressPct=100,finishedAt=now(),
                       result={"tocVersionId":version["tocVersionId"],"tocVersionNo":version["versionNo"]})
            plan["status"]="OUTLINE_REVIEW"
    return envelope(job)

@app.get("/api/v1/plan-jobs/{job_id}/events")
def job_events(job_id: str, last_event_id: str | None = Header(default=None, alias="Last-Event-ID")):
    job=get_job_or_404(job_id)
    # Contract event vocabulary (UNE-PLAN-011). Frames carry id = job_event.sequence_no;
    # the stream ends after the terminal event.
    if job["jobType"]=="CONTENT":
        # CC-130: content.block은 노드 1건당 1프레임(GENERATED/PRESERVED/FAILED)이고
        # job.progress는 {completed,total,pct} 스로틀 프레임이다 (블록 10개/10%p).
        frames=[("job.queued",{"progressPct":0}),("job.started",{"progressPct":10}),
                ("content.block",{"nodeKey":"n-1","blockId":"00000000-0000-4000-8000-0000000000b1","outcome":"GENERATED",
                                  "sortOrder":1,"outlineLevel":1,"contentHash":"a"*64,"citationCount":2}),
                ("content.block",{"nodeKey":"n-1-1","blockId":"00000000-0000-4000-8000-0000000000b2","outcome":"GENERATED",
                                  "sortOrder":2,"outlineLevel":2,"contentHash":"b"*64,"citationCount":0}),
                ("job.progress",{"completed":2,"total":3,"pct":67}),
                # 보호 블록은 새 행을 만들지 않고 기존 블록 id/해시를 그대로 싣는다.
                ("content.block",{"nodeKey":"n-2","blockId":"00000000-0000-4000-8000-0000000000b3","outcome":"PRESERVED",
                                  "sortOrder":3,"outlineLevel":1,"contentHash":"c"*64,"citationCount":1,"reason":"USER_LOCKED"}),
                ("job.progress",{"completed":3,"total":3,"pct":100}),
                ("job.completed",{"progressPct":100})]
    else:
        frames=[("job.queued",{"progressPct":0}),("job.started",{"progressPct":10}),
                ("job.progress",{"progressPct":50}),("toc.section",{"nodeKey":"n-1","title":"1. 추진 배경"}),
                ("job.completed",{"progressPct":100})]
    start=int(last_event_id) if last_event_id and last_event_id.isdigit() else 0
    def gen():
        for seq,(event,payload) in enumerate(frames,start=1):
            if seq<=start: continue
            data=json.dumps({"jobId":job["jobId"],"type":event,"payload":payload,"sequenceNo":seq},ensure_ascii=False)
            yield f"id: {seq}\nevent: {event}\ndata: {data}\n\n"
    return StreamingResponse(gen(),media_type="text/event-stream")

@app.post("/api/v1/plan-jobs/{job_id}/cancel")
def cancel_job(job_id: str, body: dict[str,Any] | None = None, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    require_idempotency(idempotency_key)
    job=get_job_or_404(job_id)
    if job["status"] in JOB_TERMINAL_STATUSES: raise HTTPException(409,"JOB-409-001: job already finished")
    # QUEUED is cancelled outright; a running job only records the request.
    job["status"]="CANCELLED" if job["status"]=="QUEUED" else "CANCEL_REQUESTED"
    if job["status"]=="CANCELLED": job["finishedAt"]=now()
    return JSONResponse(envelope(job),status_code=202)

@app.post("/api/v1/plan-jobs/{job_id}/retry")
def retry_job(job_id: str, body: dict[str,Any] | None = None, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    require_idempotency(idempotency_key)
    job=get_job_or_404(job_id)
    # TOC/CONTENT 모두 전체 단위 재시도다. 블록 단위 provider 재시도는 target-v2
    # partialRetry(CC-135), 범위 지정 재생성은 UNE-PLAN-016 targetNodeKeys 소관.
    if (body or {}).get("blockIds"): raise HTTPException(400,"PLAN-4001: blockIds is not supported; use UNE-PLAN-016 targetNodeKeys")
    if job["status"]!="FAILED": raise HTTPException(409,"JOB-409-002: only failed jobs can be retried")
    # ADR-25 D9: a user retry restarts the attempt budget.
    job.update(status="QUEUED",progressPct=0,attemptNo=0,startedAt=None,finishedAt=None,error=None,result=None)
    JOB_READS[job_id]=0
    return JSONResponse(envelope(job),status_code=202)

@app.post("/api/v1/plans/{plan_id}/toc-versions")
def save_toc(plan_id: str, body: dict[str,Any], idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    require_idempotency(idempotency_key)
    plan=get_plan_or_404(plan_id)
    if plan["deletedAt"] is not None: raise HTTPException(412,"PLAN-412-002: plan is in trash")
    tree=body.get("tocTree")
    if not body.get("baseVersionId") or not isinstance(tree,list) or not tree:
        raise HTTPException(422,"PLAN-422-002: baseVersionId and a non-empty tocTree are required")
    # ADR-27 D9: 저장/확정 모두 본문 블록이 있으면 412 (목차 변경 차단, CC-170).
    assert_no_current_blocks(plan_id,"change the outline")
    if body["baseVersionId"]!=plan["currentTocVersionId"]:
        raise HTTPException(409,"TOC-409-001: baseVersionId is not the current TOC version")
    version=save_toc_version(plan,build_nodes(tree),"USER","CONFIRMED" if body.get("confirm") else "DRAFT")
    if version["status"]=="CONFIRMED": plan["status"]="OUTLINE_CONFIRMED"
    return JSONResponse(envelope(version),status_code=201)

@app.get("/api/v1/plans/{plan_id}/toc-versions/{toc_version_id}")
def get_toc(plan_id: str, toc_version_id: str):
    get_plan_or_404(plan_id)
    version=DB["tocVersions"].get(toc_version_id)
    if not version or version["planId"]!=plan_id: raise HTTPException(404,"TOC-404-001: TOC version not found")
    return envelope(version)

@app.post("/api/v1/situations")
def create_situation(body: SituationCreate, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    require_idempotency(idempotency_key)
    sid=str(uuid4()); item={"situationId":sid,**body.model_dump(),"status":"REGISTERED","versionNo":1,"createdAt":now()}; DB["situations"][sid]=item
    return JSONResponse(envelope(item),status_code=201)

@app.post("/api/v1/situations/{situation_id}/snapshots")
def create_situation_snapshot(situation_id: str, body: dict[str,Any], idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    require_idempotency(idempotency_key)
    if situation_id not in DB["situations"]: raise HTTPException(404,"Situation not found")
    sid=str(uuid4()); snap={"snapshotId":sid,"situationId":situation_id,"versionNo":1,"factIds":body.get("factIds",[]),"effectiveAt":body.get("effectiveAt",now()),"contentHash":"1"*64,"confirmedAt":now()}; DB["snapshots"][sid]=snap; DB["situations"][situation_id]["status"]="SNAPSHOT_CONFIRMED"
    return JSONResponse(envelope(snap),status_code=201)

@app.post("/api/v1/sops")
def create_sop(body: dict[str,Any], idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    require_idempotency(idempotency_key)
    sid=str(uuid4()); sop={"sopId":sid,"title":body.get("title","Mock SOP"),"hazardType":body.get("hazardType","태풍/호우"),"status":"DRAFT","versionNo":1}; DB["sops"][sid]=sop
    return JSONResponse(envelope(sop),status_code=201)

@app.post("/api/v1/sops/{sop_id}/runs")
def run_sop(sop_id: str, body: dict[str,Any], idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    require_idempotency(idempotency_key)
    if sop_id not in DB["sops"]: raise HTTPException(404,"SOP not found")
    rid=str(uuid4()); tid=str(uuid4()); run={"runId":rid,"sopId":sop_id,"status":"RUNNING","mode":body.get("mode","DRY_RUN"),"startedAt":now(),"taskIds":[tid]}; task={"taskId":tid,"runId":rid,"title":"상황전파 및 초기조치","status":"DISPATCHED"}; DB["runs"][rid]=run; DB["tasks"][tid]=task
    return JSONResponse(envelope(run),status_code=202)

@app.post("/api/v1/tasks/{task_id}/acknowledge")
def ack(task_id: str, body: dict[str,Any] | None = None, idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    require_idempotency(idempotency_key)
    if task_id not in DB["tasks"]: raise HTTPException(404,"Task not found")
    DB["tasks"][task_id]["status"]="ACKNOWLEDGED"; return envelope(DB["tasks"][task_id])

@app.post("/api/v1/tasks/{task_id}/complete")
def complete(task_id: str, body: dict[str,Any], idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    require_idempotency(idempotency_key)
    if task_id not in DB["tasks"]: raise HTTPException(404,"Task not found")
    DB["tasks"][task_id]["status"]="COMPLETION_REPORTED"; DB["tasks"][task_id]["result"]=body; return envelope(DB["tasks"][task_id])

@app.post("/api/v1/situations/{situation_id}/journal-projections")
def journal(situation_id: str, body: dict[str,Any], idempotency_key: str | None = Header(default=None, alias="Idempotency-Key")):
    require_idempotency(idempotency_key)
    if situation_id not in DB["situations"]: raise HTTPException(404,"Situation not found")
    jid=str(uuid4()); item={"journalId":jid,"situationId":situation_id,"snapshotId":body.get("snapshotId"),"status":"DRAFT","sections":[{"title":"시간대별 주요 조치","lockedFacts":[],"narrative":"Mock projection"}],"projectionHash":"2"*64}; DB["journals"][jid]=item
    return JSONResponse(envelope(item),status_code=201)

@app.api_route("/api/v1/{path:path}", methods=["GET","POST","PUT","PATCH","DELETE"])
async def fallback(path: str, request: Request):
    return envelope({"mock":True,"path":"/api/v1/"+path,"method":request.method,"note":"Generic fallback. Implement domain behavior as development advances."})
