"""Run with:  pytest      (from the classcast-backend folder)"""


def booking(day, room="nlt-2", start="10:00", end="12:00", **changes):
    return {"classroom_id": room, "course_id": "csc-301", "reservation_date": day, "start_time": start,
            "end_time": end, "purpose": "Make-up lecture", "expected_attendance": 90, **changes}


# ---------- availability ----------
def test_search_marks_rooms_free_or_in_use(client, monday):
    rooms = client.login("rep-1").get("/api/rooms/search", params={"date": monday, "start": "08:00", "end": "10:00"}).json()
    assert len(rooms) == 94
    by_id = {r["id"]: r for r in rooms}
    assert by_id["nlt-1"]["is_free"] is False                       # CSC 301 is there on Mondays 8–10
    assert by_id["nlt-1"]["hint"] == "In use: CSC 301 · Operating Systems. Free from 10:00"
    assert by_id["nlt-2"]["is_free"] is True
    assert rooms[-1]["id"] == "nlt-1"                               # rooms in use are listed last
    assert by_id["nlt-2"]["building"]["name"] == "New Lecture Theatre"


def test_search_filters_by_building_and_capacity(client, monday):
    c = client.login("rep-1")
    slot = {"date": monday, "start": "08:00", "end": "10:00"}
    assert len(c.get("/api/rooms/search", params={**slot, "building": "calc"}).json()) == 11
    assert len(c.get("/api/rooms/search", params={**slot, "min_capacity": 150}).json()) == 19 + 11
    assert c.get("/api/rooms/search", params={**slot, "start": "12:00"}).status_code == 400


def test_room_schedule_lists_the_days_classes(client, monday):
    blocks = client.login("student-1").get("/api/rooms/nlt-1/schedule", params={"date": monday}).json()["blocks"]
    assert [(b["start"], b["end"]) for b in blocks] == [("08:00", "10:00"), ("14:00", "16:00")]


def test_cancelled_class_frees_the_room(client, db, monday):
    db.add("session_overrides", {"timetable_entry_id": "class-01", "session_date": monday, "type": "cancelled"})
    clashes = client.login("rep-1").get("/api/reservations/check-clash",
                                        params={"classroom_id": "nlt-1", "date": monday, "start": "08:00", "end": "10:00"}).json()
    assert clashes == []


def test_moved_class_occupies_the_new_room(client, db, monday):
    db.add("session_overrides", {"timetable_entry_id": "class-01", "session_date": monday, "type": "moved", "new_classroom_id": "lt-5"})
    c = client.login("rep-1")
    slot = {"date": monday, "start": "08:00", "end": "10:00"}
    assert c.get("/api/reservations/check-clash", params={**slot, "classroom_id": "nlt-1"}).json() == []
    assert len(c.get("/api/reservations/check-clash", params={**slot, "classroom_id": "lt-5"}).json()) == 1


# ---------- booking ----------
def test_rep_can_book_a_free_room(client, db, monday):
    response = client.login("rep-1").post("/api/reservations", json=booking(monday))
    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "pending" and body["classroom"]["name"] == "NLT 2" and body["requester"] == "Kofi Boateng"
    assert len(db.all("reservations")) == 1 and len(db.all("activity_logs")) == 1


def test_booking_over_a_class_is_refused(client, db, monday):
    response = client.login("rep-1").post("/api/reservations", json=booking(monday, room="nlt-1", start="09:00", end="11:00"))
    assert response.status_code == 409 and "CSC 301" in response.json()["detail"]
    assert db.all("reservations") == [] and db.all("activity_logs") == []     # nothing was saved


def test_second_booking_for_the_same_slot_is_refused(client, db, monday):
    c = client.login("rep-1")
    assert c.post("/api/reservations", json=booking(monday)).status_code == 201
    assert c.post("/api/reservations", json=booking(monday, start="11:00", end="13:00")).status_code == 409   # overlaps
    assert c.post("/api/reservations", json=booking(monday, start="12:00", end="14:00")).status_code == 201   # starts as the first ends
    assert len(db.all("reservations")) == 2


def test_booking_rules(client, monday):
    c = client.login("rep-1")
    assert c.post("/api/reservations", json=booking(monday, expected_attendance=500)).status_code == 400      # room too small
    assert c.post("/api/reservations", json=booking("2020-01-06")).status_code == 400                         # in the past
    assert c.post("/api/reservations", json=booking(monday, start="12:00", end="10:00")).status_code == 400   # ends before it starts
    assert c.post("/api/reservations", json=booking(monday, course_id="mat-204")).status_code == 403          # not this rep's course
    assert c.post("/api/reservations", json=booking(monday, room="nowhere-1")).status_code == 404
    assert c.post("/api/reservations", json=booking(monday, start="25:00")).status_code == 422                # not a real time
    assert c.post("/api/reservations", json=booking(monday, purpose="   ")).status_code == 400


def test_only_course_reps_can_book(client, monday):
    assert client.login("student-1").post("/api/reservations", json=booking(monday)).status_code == 403
    assert client.login("admin-1").post("/api/reservations", json=booking(monday)).status_code == 403


def test_rep_sees_only_their_own_reservations_and_can_cancel(client, db, monday):
    mine = client.login("rep-1").post("/api/reservations", json=booking(monday)).json()
    client.login("rep-2").post("/api/reservations", json=booking(monday, room="lt-4", course_id="mat-204"))

    assert [r["id"] for r in client.login("rep-1").get("/api/reservations/mine").json()] == [mine["id"]]
    assert client.login("rep-2").patch(f'/api/reservations/{mine["id"]}/cancel').status_code == 404          # not theirs
    assert client.login("rep-1").patch(f'/api/reservations/{mine["id"]}/cancel').json()["status"] == "cancelled"
    assert client.login("rep-1").patch(f'/api/reservations/{mine["id"]}/cancel').status_code == 400          # already cancelled
    # the slot is free again
    assert client.login("rep-2").post("/api/reservations", json=booking(monday, course_id="mat-204")).status_code == 201


# ---------- admin approval ----------
def test_admin_approves_and_the_rep_is_told(client, db, monday):
    r = client.login("rep-1").post("/api/reservations", json=booking(monday)).json()
    admin = client.login("admin-1")
    pending = admin.get("/api/admin/reservations", params={"status": "pending"}).json()
    assert len(pending) == 1 and pending[0]["clashes"] == []

    approved = admin.patch(f'/api/admin/reservations/{r["id"]}', json={"decision": "approved"}).json()
    assert approved["status"] == "approved" and approved["reviewed_by"] == "admin-1"
    alerts = db.where("notifications", user_id="rep-1")
    assert len(alerts) == 1 and alerts[0]["title"] == "Reservation approved" and alerts[0]["is_read"] is False
    assert admin.patch(f'/api/admin/reservations/{r["id"]}', json={"decision": "rejected", "reason": "x"}).status_code == 400   # already handled


def test_rejecting_needs_a_reason_and_frees_the_slot(client, db, monday):
    r = client.login("rep-1").post("/api/reservations", json=booking(monday)).json()
    admin = client.login("admin-1")
    assert admin.patch(f'/api/admin/reservations/{r["id"]}', json={"decision": "rejected"}).status_code == 400
    rejected = admin.patch(f'/api/admin/reservations/{r["id"]}', json={"decision": "rejected", "reason": "Exams that week"}).json()
    assert rejected["status"] == "rejected" and rejected["rejection_reason"] == "Exams that week"
    assert "Exams that week" in db.where("notifications", user_id="rep-1")[0]["message"]
    assert client.login("rep-1").post("/api/reservations", json=booking(monday)).status_code == 201


def test_cannot_approve_when_a_class_has_since_taken_the_slot(client, db, monday):
    r = client.login("rep-1").post("/api/reservations", json=booking(monday)).json()
    db.add("timetable", {"course_id": "phy-202", "classroom_id": "nlt-2", "day_of_week": 1, "start_time": "11:00", "end_time": "13:00"})
    admin = client.login("admin-1")
    assert len(admin.get("/api/admin/reservations").json()[0]["clashes"]) == 1
    response = admin.patch(f'/api/admin/reservations/{r["id"]}', json={"decision": "approved"})
    assert response.status_code == 409 and "PHY 202" in response.json()["detail"]
    assert db.get("reservations", r["id"])["status"] == "pending" and db.all("notifications") == []


def test_admin_pages_are_closed_to_reps(client):
    assert client.login("rep-1").get("/api/admin/reservations").status_code == 403


# ---------- me and login ----------
def test_me_returns_role_and_courses(client):
    me = client.login("rep-1").get("/api/me").json()
    assert me["role"] == "course_rep" and [c["code"] for c in me["courses"]] == ["CSC 301", "CSC 305"]


def test_requests_without_a_login_are_refused(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/health").json() == {"status": "ok"}


def test_mark_all_alerts_read(client, db):
    db.add("notifications", {"user_id": "rep-1", "title": "a", "message": "b", "is_read": False})
    db.add("notifications", {"user_id": "rep-2", "title": "a", "message": "b", "is_read": False})
    assert client.login("rep-1").patch("/api/notifications/read-all").json() == {"marked": 1}
    assert [n["is_read"] for n in db.where("notifications", user_id="rep-2")] == [False]
