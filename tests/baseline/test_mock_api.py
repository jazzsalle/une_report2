import json

from fastapi.testclient import TestClient
from app import app

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
