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
DB: dict[str, dict[str, Any]] = {"plans": {}, "planSnapshots": {}, "jobs": {}, "situations": {}, "snapshots": {}, "sops": {}, "runs": {}, "tasks": {}, "journals": {}}
# Snapshot version counter per plan (UNE-PLAN-007 version_no = max+1).
PLAN_SNAPSHOT_SEQ: dict[str, int] = {}
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
    if plan_id not in DB["plans"]: raise HTTPException(404,"Plan not found")
    jid=str(uuid4()); job={"jobId":jid,"jobType":"TOC","status":"COMPLETED","progress":100,"result":{"title":DB["plans"][plan_id]["title"],"sections":[{"name":"1. 개요","children":[{"name":"1.1. 목적","children":[]}]}]}}
    DB["jobs"][jid]=job; return JSONResponse(envelope(job),status_code=202)

@app.get("/api/v1/plan-jobs/{job_id}/events")
def job_events(job_id: str):
    if job_id not in DB["jobs"]: raise HTTPException(404,"Job not found")
    def gen():
        yield f"event: status\ndata: {{\"jobId\":\"{job_id}\",\"status\":\"RUNNING\",\"progress\":50}}\n\n"
        yield f"event: completed\ndata: {{\"jobId\":\"{job_id}\",\"status\":\"COMPLETED\"}}\n\n"
    return StreamingResponse(gen(),media_type="text/event-stream")

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
