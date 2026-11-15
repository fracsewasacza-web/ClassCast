"""Change reports (course rep modules 5 and 6, admin module 6), alerts and lookups."""
from tests.conftest import next_weekday


def cancel(day, **changes):
    return {"type": "class_cancelled", "timetable_entry_id": "class-01", "affected_date": day, "details": "Lecturer away", **changes}


# ---------- lookups, rooms, my classes ----------
def test_lookups_give_every_drop_down(client, db):
    db.update("classrooms", "nlt-3", {"is_active": False})
    data = client.login("rep-1").get("/api/lookups").json()
    assert len(data["classrooms"]) == 93 and data["classrooms"][0]["name"] == "NLT 1"
    assert [b["code"] for b in data["buildings"]][:2] == ["NLT", "LT"]
    assert len(data["facilities"]) == 5 and len(data["courses"]) == 5


def test_one_room(client):
    c = client.login("student-1")
    assert c.get("/api/rooms/calc-2").json()["building"]["code"] == "CALC"
    assert c.get("/api/rooms/nowhere").status_code == 404


def test_rep_sees_only_their_classes(client):
    classes = client.login("rep-1").get("/api/timetable/mine").json()
    assert {c["course"]["code"] for c in classes} == {"CSC 301", "CSC 305"}
    assert classes[0]["day_of_week"] == 1 and classes[0]["classroom"]["name"] == "NLT 1"
    assert client.login("admin-1").get("/api/timetable/mine").status_code == 403


def test_notifications_list_and_count(client, db):
    db.add("notifications", {"user_id": "rep-1", "title": "old", "message": "", "is_read": True, "created_at": "2026-01-01T08:00:00+00:00"})
    db.add("notifications", {"user_id": "rep-1", "title": "new", "message": "", "is_read": False, "created_at": "2026-02-01T08:00:00+00:00"})
    db.add("notifications", {"user_id": "rep-2", "title": "other", "message": "", "is_read": False, "created_at": "2026-02-01T08:00:00+00:00"})
    c = client.login("rep-1")
    assert [n["title"] for n in c.get("/api/notifications").json()] == ["new", "old"]
    assert c.get("/api/notifications/unread-count").json() == {"count": 1}


# ---------- course rep: sending reports ----------
def test_rep_reports_a_cancelled_class(client, db, monday):
    response = client.login("rep-1").post("/api/change-reports", json=cancel(monday))
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "pending" and body["course"]["code"] == "CSC 301" and body["classroom"]["name"] == "NLT 1"
    mine = client.login("rep-1").get("/api/change-reports/mine").json()
    assert [r["id"] for r in mine] == [body["id"]] and mine[0]["reporter"] == "Kofi Boateng"
    assert client.login("rep-2").get("/api/change-reports/mine").json() == []


def test_class_report_rules(client, monday):
    c = client.login("rep-1")
    tuesday = next_weekday(2)
    assert c.post("/api/change-reports", json=cancel(tuesday)).status_code == 400                       # class meets on Mondays
    assert c.post("/api/change-reports", json=cancel("2020-01-06")).status_code == 400                  # in the past
    assert c.post("/api/change-reports", json=cancel(monday, timetable_entry_id="class-02")).status_code == 403   # MAT 204, not theirs
    assert c.post("/api/change-reports", json=cancel(monday, timetable_entry_id="nope")).status_code == 404
    moved = cancel(monday, type="venue_moved")
    assert c.post("/api/change-reports", json=moved).status_code == 400                                 # no new hall
    assert c.post("/api/change-reports", json={**moved, "proposed_classroom_id": "nlt-1"}).status_code == 400   # same hall
    assert c.post("/api/change-reports", json={**moved, "proposed_classroom_id": "lt-5"}).status_code == 201
    timed = cancel(monday, type="time_changed")
    assert c.post("/api/change-reports", json={**timed, "proposed_start_time": "11:00"}).status_code == 400
    assert c.post("/api/change-reports", json={**timed, "proposed_start_time": "11:00", "proposed_end_time": "10:00"}).status_code == 400
    assert c.post("/api/change-reports", json={**timed, "proposed_start_time": "11:00", "proposed_end_time": "13:00"}).status_code == 201


def test_hall_correction_needs_a_note(client, monday):
    c = client.login("rep-1")
    hall = {"type": "hall_in_use", "classroom_id": "lt-4", "affected_date": monday}
    assert c.post("/api/change-reports", json={**hall, "details": "  "}).status_code == 400
    body = c.post("/api/change-reports", json={**hall, "details": "Study group inside"}).json()
    assert body["classroom"]["name"] == "LT 4" and body["course"] is None


# ---------- admin: verifying ----------
def test_verifying_a_cancellation_frees_the_room_and_tells_the_course(client, db, monday):
    report = client.login("rep-1").post("/api/change-reports", json=cancel(monday)).json()
    admin = client.login("admin-1")
    assert [r["id"] for r in admin.get("/api/admin/change-reports", params={"status": "pending"}).json()] == [report["id"]]
    assert admin.get("/api/admin/pending-counts").json() == {"requests": 0, "reports": 1}

    verified = admin.patch(f'/api/admin/change-reports/{report["id"]}', json={"decision": "verified"}).json()
    assert verified["status"] == "verified" and verified["verified_by"] == "admin-1"
    free = admin.get("/api/reservations/check-clash", params={"classroom_id": "nlt-1", "date": monday, "start": "08:00", "end": "10:00"}).json()
    assert free == []
    assert [n["title"] for n in db.where("notifications", user_id="rep-1")] == ["Report verified"]
    assert [n["title"] for n in db.where("notifications", user_id="student-1")] == ["Class change"]   # on CSC 301
    assert db.where("notifications", user_id="rep-2") == []                                           # not on the course
    assert admin.patch(f'/api/admin/change-reports/{report["id"]}', json={"decision": "rejected"}).status_code == 400


def test_verifying_a_move_occupies_the_new_room(client, db, monday):
    report = client.login("rep-1").post("/api/change-reports",
                                        json=cancel(monday, type="venue_moved", proposed_classroom_id="lt-5")).json()
    client.login("admin-1").patch(f'/api/admin/change-reports/{report["id"]}', json={"decision": "verified"})
    rooms = {r["id"]: r for r in client.login("rep-1").get("/api/rooms/search", params={"date": monday, "start": "08:00", "end": "10:00"}).json()}
    assert rooms["nlt-1"]["is_free"] is True and rooms["lt-5"]["is_free"] is False


def test_cannot_verify_a_move_into_a_busy_room(client, db, monday):
    # SWLT 5 has STA 201 on Mondays 10–12; move PHY 202 (CALC 2, Mon 10–12) there
    db.update("users", "rep-2", {"course_ids": ["mat-204", "phy-202"]})
    report = client.login("rep-2").post("/api/change-reports", json=cancel(
        monday, type="venue_moved", timetable_entry_id="class-04", proposed_classroom_id="swlt-5")).json()
    response = client.login("admin-1").patch(f'/api/admin/change-reports/{report["id"]}', json={"decision": "verified"})
    assert response.status_code == 409 and "STA 201" in response.json()["detail"]
    assert db.get("change_reports", report["id"])["status"] == "pending" and db.all("session_overrides") == []


def test_verifying_a_new_time_reschedules_that_date_only(client, db, monday):
    report = client.login("rep-1").post("/api/change-reports", json=cancel(
        monday, type="time_changed", proposed_start_time="16:00", proposed_end_time="18:00")).json()
    client.login("admin-1").patch(f'/api/admin/change-reports/{report["id"]}', json={"decision": "verified"})
    blocks = client.login("rep-1").get("/api/rooms/nlt-1/schedule", params={"date": monday}).json()["blocks"]
    assert [(b["start"], b["end"]) for b in blocks] == [("14:00", "16:00"), ("16:00", "18:00")]
    assert db.get("timetable", "class-01")["start_time"] == "08:00"       # the weekly timetable is unchanged


def test_rejecting_only_tells_the_reporter(client, db, monday):
    report = client.login("rep-1").post("/api/change-reports", json=cancel(monday)).json()
    client.login("admin-1").patch(f'/api/admin/change-reports/{report["id"]}', json={"decision": "rejected"})
    assert db.all("session_overrides") == []
    assert [n["title"] for n in db.all("notifications")] == ["Report rejected"]


def test_reports_are_closed_to_the_wrong_roles(client, monday):
    assert client.login("student-1").post("/api/change-reports", json=cancel(monday)).status_code == 403
    assert client.login("rep-1").get("/api/admin/change-reports").status_code == 403
