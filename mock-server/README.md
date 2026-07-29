# UNE Platform Mock Server

```bash
cd 05_mock_server
python -m uvicorn app:app --host 127.0.0.1 --port 8080
```

- Swagger UI: `http://127.0.0.1:8080/docs`
- Health: `GET /health`
- Core stateful mock: auth, plan/context/TOC job, situation/snapshot, SOP/run/task, journal projection
- Remaining endpoints: generic fallback envelope
- All mutation examples require `Idempotency-Key`.
