"""Upload history for the timetable, and reading a timetable photo with Claude.
Claude is never really called: a fake HTTP transport answers instead, so the tests stay offline and free."""
import json

import anthropic
import httpx2
import pytest

from app import config
from app.services import timetable_reader

ROW = {"course_code": "MAT 204", "room": "NLT 3", "day": "Friday", "start": "14:00", "end": "16:00"}
IMAGE = {"media_type": "image/png", "data": "iVBORw0KGgo" + "A" * 200}


# ---------- upload history ----------
def test_each_upload_is_recorded_and_its_classes_are_tagged(client, db):
    admin = client.login("admin-1")
    out = admin.post("/api/admin/timetable/import", json={"rows": [ROW, {**ROW, "room": "Moon 1"}], "file_name": "level-300.csv"}).json()
    assert out["imported"] == 1 and out["import_id"]

    history = admin.get("/api/admin/timetable/imports").json()
    assert len(history) == 1
    h = history[0]
    assert (h["file_name"], h["source"], h["imported"], h["skipped"], h["classes_now"]) == ("level-300.csv", "csv", 1, 1, 1)
    assert h["uploaded_by_name"] == "Esi Asante"
    tagged = [t for t in admin.get("/api/admin/timetable").json() if t.get("import_id") == out["import_id"]]
    assert len(tagged) == 1 and tagged[0]["classroom"]["name"] == "NLT 3"


def test_an_upload_where_nothing_was_imported_is_not_recorded(client, db):
    admin = client.login("admin-1")
    out = admin.post("/api/admin/timetable/import", json={"rows": [{**ROW, "room": "Moon 1"}]}).json()
    assert out["imported"] == 0 and out["import_id"] is None
    assert admin.get("/api/admin/timetable/imports").json() == []


def test_removing_an_upload_takes_only_its_classes_off(client, db):
    admin = client.login("admin-1")
    first = admin.post("/api/admin/timetable/import", json={"rows": [ROW], "file_name": "a.csv"}).json()["import_id"]
    admin.post("/api/admin/timetable/import", json={"rows": [{**ROW, "room": "NLT 4"}], "file_name": "b.csv"})
    entry = db.where("timetable", import_id=first)[0]
    db.add("session_overrides", {"timetable_entry_id": entry["id"], "session_date": "2026-12-04", "type": "cancelled"})

    assert admin.delete(f"/api/admin/timetable/imports/{first}").status_code == 204
    assert db.where("timetable", import_id=first) == [] and db.all("session_overrides") == []
    assert len(db.all("timetable")) == 16                       # the 15 seed classes + b.csv's one
    assert [h["file_name"] for h in admin.get("/api/admin/timetable/imports").json()] == ["b.csv"]
    assert admin.delete(f"/api/admin/timetable/imports/{first}").status_code == 404


def test_photo_uploads_are_labelled_as_photos(client, db):
    admin = client.login("admin-1")
    admin.post("/api/admin/timetable/import", json={"rows": [ROW], "source": "image"})
    assert admin.get("/api/admin/timetable/imports").json()[0]["file_name"] == "Timetable photo"


# ---------- reading a photo ----------
def fake_claude(monkeypatch, answer: dict | None = None, stop_reason: str = "end_turn", status: int = 200):
    """Point the reader at a fake Claude. Returns the list the sent requests are collected in."""
    sent = []

    def handle(request: httpx2.Request) -> httpx2.Response:
        sent.append({"headers": dict(request.headers), "body": json.loads(request.content)})
        if status != 200:
            return httpx2.Response(status, json={"type": "error", "error": {"type": "api_error", "message": "boom"}})
        return httpx2.Response(200, json={
            "id": "msg_test", "type": "message", "role": "assistant", "model": timetable_reader.MODEL,
            "content": [{"type": "text", "text": json.dumps(answer or {"rows": [], "notes": ""})}],
            "stop_reason": stop_reason, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 10}})

    real = anthropic.Anthropic
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "sk-ant-test")
    monkeypatch.setattr(timetable_reader.anthropic, "Anthropic",
                        lambda **kw: real(**{**kw, "max_retries": 0, "http_client": httpx2.Client(transport=httpx2.MockTransport(handle))}))
    return sent


def test_reading_a_photo_returns_rows_to_check(client, monkeypatch):
    answer = {"rows": [
        {"course_code": "CSC 301", "course_title": "Operating Systems", "room": "NLT 1", "day": "Monday", "start": "08:00", "end": "10:00", "lecturer": "Dr. Mensah"},
        {"course_code": "", "course_title": "", "room": "", "day": "", "start": "", "end": "", "lecturer": ""},
    ], "notes": "The Friday column is blurred."}
    sent = fake_claude(monkeypatch, answer)

    out = client.login("admin-1").post("/api/admin/timetable/read-image", json=IMAGE)
    assert out.status_code == 200
    body = out.json()
    assert len(body["rows"]) == 1 and body["rows"][0]["room"] == "NLT 1"          # the empty row is dropped
    assert body["notes"] == "The Friday column is blurred."

    request = sent[0]["body"]
    assert request["model"] == "claude-opus-5-5" and request["fallbacks"] == "default"
    assert "server-side-fallback-2026-07-01" in sent[0]["headers"]["anthropic-beta"]
    image, text = request["messages"][0]["content"]
    assert image["source"] == {"type": "base64", "media_type": "image/png", "data": IMAGE["data"]}
    assert "NLT 1" in text["text"] and "G Block 25" in text["text"]               # the hall names are offered
    assert request["output_config"]["format"]["type"] == "json_schema"


def test_reading_saves_nothing(client, db, monkeypatch):
    fake_claude(monkeypatch, {"rows": [{**ROW, "course_title": "", "lecturer": ""}], "notes": ""})
    client.login("admin-1").post("/api/admin/timetable/read-image", json=IMAGE)
    assert len(db.all("timetable")) == 15 and db.all("timetable_imports") == []


@pytest.mark.parametrize("stop_reason, status, code", [("refusal", 200, 422), ("max_tokens", 200, 422), ("end_turn", 529, 502)])
def test_reading_problems_are_explained(client, monkeypatch, stop_reason, status, code):
    fake_claude(monkeypatch, stop_reason=stop_reason, status=status)
    out = client.login("admin-1").post("/api/admin/timetable/read-image", json=IMAGE)
    assert out.status_code == code and out.json()["detail"]


def test_reading_needs_an_api_key(client, monkeypatch):
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "")
    out = client.login("admin-1").post("/api/admin/timetable/read-image", json=IMAGE)
    assert out.status_code == 503 and "ANTHROPIC_API_KEY" in out.json()["detail"]


def test_timetable_uploads_are_admin_only(client):
    rep = client.login("rep-1")
    assert rep.get("/api/admin/timetable/imports").status_code == 403
    assert rep.delete("/api/admin/timetable/imports/x").status_code == 403
    assert rep.post("/api/admin/timetable/read-image", json=IMAGE).status_code == 403
