from fastapi.testclient import TestClient
from app import app

client = TestClient(app)
HEADERS={"Idempotency-Key":"test-001"}

def data(resp):
    assert resp.status_code in (200,201,202), resp.text
    body=resp.json(); assert body["success"] is True
    return body["data"]

def test_plan_flow():
    p=data(client.post("/api/v1/plans",json={"title":"태풍 대비계획","startMode":"BLANK"},headers=HEADERS))
    snap=data(client.post(f"/api/v1/plans/{p['planId']}/context-snapshots",json={"subject":"태풍 대비계획"},headers={"Idempotency-Key":"test-002"}))
    job=data(client.post(f"/api/v1/plans/{p['planId']}/toc-jobs",json={"contextSnapshotId":snap['contextSnapshotId']},headers={"Idempotency-Key":"test-003"}))
    assert job["status"]=="COMPLETED"

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
