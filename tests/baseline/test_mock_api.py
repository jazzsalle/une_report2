import json

from fastapi.testclient import TestClient
from app import DB, app

client = TestClient(app)
HEADERS={"Idempotency-Key":"test-001"}

def data(resp):
    assert resp.status_code in (200,201,202), resp.text
    body=resp.json(); assert body["success"] is True
    return body["data"]

def create_plan(idem, title="태풍 대비계획"):
    # CC-110: hazardType/managementPhase are required by the contract.
    return data(client.post("/api/v1/plans",json={"title":title,"startMode":"BLANK","hazardType":"태풍/호우","managementPhase":"대비"},headers={"Idempotency-Key":idem}))

def test_plan_flow():
    p=create_plan("test-001")
    snap=data(client.post(f"/api/v1/plans/{p['planId']}/context-snapshots",json={"subject":"태풍 대비계획"},headers={"Idempotency-Key":"test-002"}))
    # CC-120: the TOC job is accepted asynchronously and polled until it completes.
    job=data(client.post(f"/api/v1/plans/{p['planId']}/toc-jobs",json={"contextSnapshotId":snap['contextSnapshotId']},headers={"Idempotency-Key":"test-003"}))
    # ADR-25 D9: attempt_no counts worker preemptions, so a fresh job is at 0.
    assert job["status"]=="QUEUED" and job["jobType"]=="TOC" and job["attemptNo"]==0
    running=data(client.get(f"/api/v1/plan-jobs/{job['jobId']}"))
    assert running["status"]=="RUNNING" and running["attemptNo"]==1
    done=data(client.get(f"/api/v1/plan-jobs/{job['jobId']}"))
    assert done["status"]=="COMPLETED" and done["progressPct"]==100
    toc_version_id=done["result"]["tocVersionId"]
    ai_version=data(client.get(f"/api/v1/plans/{p['planId']}/toc-versions/{toc_version_id}"))
    assert ai_version["sourceType"]=="AI" and ai_version["nodes"][0]["level"]==1
    # AI nodeKey is path based; user nodes get u-<hex> unless they carry an existing key.
    assert ai_version["nodes"][0]["nodeKey"]=="n-1" and ai_version["nodes"][0]["children"][0]["nodeKey"]=="n-1-1"
    assert ai_version["nodes"][1]["nodeKey"]=="n-2"
    edited=data(client.post(f"/api/v1/plans/{p['planId']}/toc-versions",
                            json={"baseVersionId":toc_version_id,"tocTree":[{"nodeKey":"n-1","title":"1. 추진 배경","children":[{"title":"1.2. 범위"}]}],"confirm":True},
                            headers={"Idempotency-Key":"test-004"}))
    assert edited["sourceType"]=="USER" and edited["status"]=="CONFIRMED" and edited["versionNo"]==ai_version["versionNo"]+1
    assert edited["nodes"][0]["nodeKey"]=="n-1"
    assert edited["nodes"][0]["children"][0]["nodeKey"].startswith("u-")

def test_toc_job_cancel_and_retry():
    p=create_plan("test-020")
    snap=data(client.post(f"/api/v1/plans/{p['planId']}/context-snapshots",json={"subject":"취소 테스트"},headers={"Idempotency-Key":"test-021"}))
    job=data(client.post(f"/api/v1/plans/{p['planId']}/toc-jobs",json={"contextSnapshotId":snap['contextSnapshotId']},headers={"Idempotency-Key":"test-022"}))
    cancelled=data(client.post(f"/api/v1/plan-jobs/{job['jobId']}/cancel",json={"reason":"사용자 중지"},headers={"Idempotency-Key":"test-023"}))
    assert cancelled["status"]=="CANCELLED"
    assert client.post(f"/api/v1/plan-jobs/{job['jobId']}/cancel",json={},headers={"Idempotency-Key":"test-024"}).status_code==409
    # Retry is limited to FAILED jobs; a cancelled job is a terminal user decision.
    assert client.post(f"/api/v1/plan-jobs/{job['jobId']}/retry",json={"reason":"재시도"},headers={"Idempotency-Key":"test-025"}).status_code==409
    # TOC jobs retry as a whole; blockIds belongs to the CC-130 content job.
    assert client.post(f"/api/v1/plan-jobs/{job['jobId']}/retry",json={"blockIds":["00000000-0000-4000-8000-000000000009"]},headers={"Idempotency-Key":"test-026"}).status_code==400

def test_toc_job_requires_confirmed_snapshot():
    p=create_plan("test-030")
    r=client.post(f"/api/v1/plans/{p['planId']}/toc-jobs",json={"contextSnapshotId":"00000000-0000-4000-8000-000000000003"},headers={"Idempotency-Key":"test-031"})
    assert r.status_code==412, r.text

def test_job_events_stream_uses_contract_vocabulary():
    p=create_plan("test-040")
    snap=data(client.post(f"/api/v1/plans/{p['planId']}/context-snapshots",json={"subject":"SSE"},headers={"Idempotency-Key":"test-041"}))
    job=data(client.post(f"/api/v1/plans/{p['planId']}/toc-jobs",json={"contextSnapshotId":snap['contextSnapshotId']},headers={"Idempotency-Key":"test-042"}))
    body=client.get(f"/api/v1/plan-jobs/{job['jobId']}/events").text
    assert "event: job.queued" in body and "event: toc.section" in body and "event: job.completed" in body
    # data frame shape: {jobId, type, payload, sequenceNo}
    first=json.loads([l[len("data: "):] for l in body.splitlines() if l.startswith("data: ")][0])
    assert first["jobId"]==job["jobId"] and first["type"]=="job.queued" and first["sequenceNo"]==1
    assert first["payload"]=={"progressPct":0}
    # Last-Event-ID resumes after the given sequence_no.
    resumed=client.get(f"/api/v1/plan-jobs/{job['jobId']}/events",headers={"Last-Event-ID":"4"}).text
    assert "event: job.queued" not in resumed and "event: job.completed" in resumed

def current_node_keys(plan_id):
    """계획서의 현재(supersede되지 않은) generated_block nodeKey 목록."""
    return [b["nodeKey"] for b in DB["blocks"].values() if b["planId"]==plan_id and b["supersededAt"] is None]

def confirmed_outline(prefix):
    """계획서 생성 -> 스냅샷 확정 -> TOC job 완료 -> 목차 확정까지 진행한다."""
    p=create_plan(f"{prefix}-0")
    snap=data(client.post(f"/api/v1/plans/{p['planId']}/context-snapshots",json={"subject":"본문 생성"},headers={"Idempotency-Key":f"{prefix}-1"}))
    job=data(client.post(f"/api/v1/plans/{p['planId']}/toc-jobs",json={"contextSnapshotId":snap['contextSnapshotId']},headers={"Idempotency-Key":f"{prefix}-2"}))
    client.get(f"/api/v1/plan-jobs/{job['jobId']}")
    done=data(client.get(f"/api/v1/plan-jobs/{job['jobId']}"))
    confirmed=data(client.post(f"/api/v1/plans/{p['planId']}/toc-versions",
                               json={"baseVersionId":done["result"]["tocVersionId"],
                                     "tocTree":[{"nodeKey":"n-1","title":"1. 추진 배경","children":[{"nodeKey":"n-1-1","title":"1.1. 목적"}]},
                                                {"nodeKey":"n-2","title":"2. 세부 추진계획"}],
                                     "confirm":True},
                               headers={"Idempotency-Key":f"{prefix}-3"}))
    assert confirmed["status"]=="CONFIRMED"
    return p,snap,confirmed

def test_content_job_flow():
    # CC-130 UNE-PLAN-016: 확정 스냅샷 + 확정 목차로 CONTENT job을 큐잉한다.
    p,snap,toc=confirmed_outline("test-050")
    body={"contextSnapshotId":snap["contextSnapshotId"],"tocVersionId":toc["tocVersionId"]}
    job=data(client.post(f"/api/v1/plans/{p['planId']}/content-jobs",json=body,headers={"Idempotency-Key":"test-051"}))
    assert job["jobType"]=="CONTENT" and job["status"]=="QUEUED" and job["attemptNo"]==0
    assert data(client.get(f"/api/v1/plans/{p['planId']}"))["status"]=="CONTENT_GENERATING"
    # 같은 계획서에 활성 생성 Job이 있으면 job 타입과 무관하게 409 PLAN-409-002.
    assert client.post(f"/api/v1/plans/{p['planId']}/content-jobs",json=body,headers={"Idempotency-Key":"test-052"}).status_code==409
    # SSE 어휘: content.block(GENERATED/PRESERVED) + job.progress{completed,total,pct}
    stream=client.get(f"/api/v1/plan-jobs/{job['jobId']}/events").text
    assert "event: content.block" in stream and "event: job.progress" in stream
    payloads=[json.loads(l[len("data: "):])["payload"] for l in stream.splitlines() if l.startswith("data: ")]
    blocks=[pl for pl in payloads if "outcome" in pl]
    assert [b["outcome"] for b in blocks]==["GENERATED","GENERATED","PRESERVED"]
    assert blocks[0]["nodeKey"]=="n-1" and blocks[0]["citationCount"]==2
    assert blocks[2]["reason"]=="USER_LOCKED" and blocks[2]["blockId"] is not None
    progress=[pl for pl in payloads if set(pl)=={"completed","total","pct"}]
    assert progress[-1]=={"completed":3,"total":3,"pct":100}
    client.get(f"/api/v1/plan-jobs/{job['jobId']}")
    done=data(client.get(f"/api/v1/plan-jobs/{job['jobId']}"))
    assert done["status"]=="COMPLETED" and done["result"]["tocVersionId"]==toc["tocVersionId"]
    summary=done["result"]["contentSummary"]
    # 목차 노드 3개(n-1, n-1-1, n-2)가 모두 생성되고, 근거 없는 블록 수가 집계된다.
    assert summary["generated"]==3 and summary["preserved"]==0 and summary["failed"]==0
    assert summary["blocksWithoutEvidence"]==2 and summary["tocVersionId"]==toc["tocVersionId"]
    assert data(client.get(f"/api/v1/plans/{p['planId']}"))["status"]=="EDITING"

def test_content_job_scope_and_protection():
    p,snap,toc=confirmed_outline("test-060")
    base={"contextSnapshotId":snap["contextSnapshotId"],"tocVersionId":toc["tocVersionId"]}
    first=data(client.post(f"/api/v1/plans/{p['planId']}/content-jobs",json=base,headers={"Idempotency-Key":"test-061"}))
    client.get(f"/api/v1/plan-jobs/{first['jobId']}"); client.get(f"/api/v1/plan-jobs/{first['jobId']}")
    # 목차에 없는 nodeKey는 422 PLAN-422-002.
    assert client.post(f"/api/v1/plans/{p['planId']}/content-jobs",json={**base,"targetNodeKeys":["n-9"]},headers={"Idempotency-Key":"test-062"}).status_code==422
    # 알 수 없는 protectedBlockIds도 422 PLAN-422-002.
    assert client.post(f"/api/v1/plans/{p['planId']}/content-jobs",json={**base,"protectedBlockIds":["00000000-0000-4000-8000-0000000000ff"]},headers={"Idempotency-Key":"test-063"}).status_code==422
    protected=[b for b in DB["blocks"].values() if b["planId"]==p["planId"] and b["nodeKey"]=="n-1-1"][0]
    second=data(client.post(f"/api/v1/plans/{p['planId']}/content-jobs",
                            json={**base,"targetNodeKeys":["n-1"],"protectedBlockIds":[protected["blockId"]]},
                            headers={"Idempotency-Key":"test-064"}))
    client.get(f"/api/v1/plan-jobs/{second['jobId']}")
    done=data(client.get(f"/api/v1/plan-jobs/{second['jobId']}"))
    summary=done["result"]["contentSummary"]
    # 대상은 n-1 subtree(n-1, n-1-1)뿐이다: n-1은 재생성, USER_LOCKED인 n-1-1은 보존.
    # 범위 밖 n-2는 대상이 아니라 어느 항목에도 집계되지 않는다(계약 UNE-PLAN-016).
    assert summary["generated"]==1 and summary["preserved"]==1 and summary["failed"]==0
    assert protected["protectionState"]=="USER_LOCKED"
    # 범위 밖 블록은 손대지 않으므로 현재 블록으로 그대로 남는다.
    assert set(current_node_keys(p["planId"]))=={"n-1","n-1-1","n-2"}

def test_outline_change_blocked_once_content_blocks_exist():
    # ADR-27 D9: 본문 블록이 있으면 목차 재생성(UNE-PLAN-009)과 목차 저장/확정
    # (UNE-PLAN-014)이 모두 412 PLAN-412-002다 (영향 Diff 흐름은 CC-170).
    p,snap,toc=confirmed_outline("test-080")
    body={"contextSnapshotId":snap["contextSnapshotId"],"tocVersionId":toc["tocVersionId"]}
    job=data(client.post(f"/api/v1/plans/{p['planId']}/content-jobs",json=body,headers={"Idempotency-Key":"test-081"}))
    client.get(f"/api/v1/plan-jobs/{job['jobId']}")
    data(client.get(f"/api/v1/plan-jobs/{job['jobId']}"))
    assert client.post(f"/api/v1/plans/{p['planId']}/toc-jobs",
                       json={"contextSnapshotId":snap["contextSnapshotId"]},
                       headers={"Idempotency-Key":"test-082"}).status_code==412
    assert client.post(f"/api/v1/plans/{p['planId']}/toc-versions",
                       json={"baseVersionId":toc["tocVersionId"],"tocTree":[{"nodeKey":"n-1","title":"1. 추진 배경"}],"confirm":True},
                       headers={"Idempotency-Key":"test-083"}).status_code==412

def test_content_job_requires_confirmed_toc():
    p=create_plan("test-070")
    snap=data(client.post(f"/api/v1/plans/{p['planId']}/context-snapshots",json={"subject":"미확정 목차"},headers={"Idempotency-Key":"test-071"}))
    job=data(client.post(f"/api/v1/plans/{p['planId']}/toc-jobs",json={"contextSnapshotId":snap['contextSnapshotId']},headers={"Idempotency-Key":"test-072"}))
    client.get(f"/api/v1/plan-jobs/{job['jobId']}")
    done=data(client.get(f"/api/v1/plan-jobs/{job['jobId']}"))
    draft_toc=done["result"]["tocVersionId"]
    body={"contextSnapshotId":snap["contextSnapshotId"],"tocVersionId":draft_toc}
    # DRAFT 목차 버전으로는 본문 생성을 시작할 수 없다 (412 PLAN-412-002).
    assert client.post(f"/api/v1/plans/{p['planId']}/content-jobs",json=body,headers={"Idempotency-Key":"test-073"}).status_code==412
    # 다른 계획서의 목차 버전은 404 TOC-404-001.
    other_p,other_snap,_=confirmed_outline("test-074")
    assert client.post(f"/api/v1/plans/{other_p['planId']}/content-jobs",
                       json={"contextSnapshotId":other_snap["contextSnapshotId"],"tocVersionId":draft_toc},
                       headers={"Idempotency-Key":"test-075"}).status_code==404
    # Idempotency-Key 누락은 400 (mock)이며 계약상 428 COM-0428 자리다.
    assert client.post(f"/api/v1/plans/{p['planId']}/content-jobs",json=body).status_code==400

def test_situation_sop_task_journal_flow():
    s=data(client.post("/api/v1/situations",json={"mode":"EXERCISE","title":"안전한국훈련","hazardType":"태풍/호우"},headers={"Idempotency-Key":"test-010"}))
    snap=data(client.post(f"/api/v1/situations/{s['situationId']}/snapshots",json={"factIds":["00000000-0000-0000-0000-000000000001"]},headers={"Idempotency-Key":"test-011"}))
    sop=data(client.post("/api/v1/sops",json={"situationId":s['situationId'],"title":"태풍 대응 SOP","hazardType":"태풍/호우"},headers={"Idempotency-Key":"test-012"}))
    run=data(client.post(f"/api/v1/sops/{sop['sopId']}/runs",json={"snapshotId":snap['snapshotId'],"mode":"DRY_RUN"},headers={"Idempotency-Key":"test-013"}))
    task_id=run["taskIds"][0]
    task=data(client.post(f"/api/v1/tasks/{task_id}/acknowledge",json={},headers={"Idempotency-Key":"test-014"}))
    assert task["status"]=="ACKNOWLEDGED"
    task=data(client.post(f"/api/v1/tasks/{task_id}/complete",json={"resultText":"완료"},headers={"Idempotency-Key":"test-015"}))
    assert task["status"]=="COMPLETION_REPORTED"
    j=data(client.post(f"/api/v1/situations/{s['situationId']}/journal-projections",json={"snapshotId":snap['snapshotId'],"from":"2026-07-27T00:00:00+09:00","to":"2026-07-27T23:59:59+09:00"},headers={"Idempotency-Key":"test-016"}))
    assert j["status"]=="DRAFT"

def test_idempotency_header_required():
    r=client.post("/api/v1/plans",json={"title":"x","startMode":"BLANK"})
    assert r.status_code==400
