"""Administrator modules 1–4 and 7: accounts, rooms, buildings, facilities, timetable, overview."""


def account(**changes):
    return {"full_name": "Ama Owusu", "email": "ama@classcast.test", "role": "course_rep",
            "index_number": "CSC/23/0099", "course_ids": ["csc-301"], "password": "secret1", **changes}


# ---------- accounts ----------
def test_admin_creates_an_account_with_a_login(client, db, fake_logins):
    admin = client.login("admin-1")
    response = admin.post("/api/admin/users", json=account())
    assert response.status_code == 201
    created = response.json()
    assert created["courses"][0]["code"] == "CSC 301" and created["is_active"] is True
    assert fake_logins.accounts[created["id"]]["email"] == "ama@classcast.test"
    assert db.get("users", created["id"])["role"] == "course_rep"
    assert len(admin.get("/api/admin/users").json()) == 5


def test_account_rules(client):
    admin = client.login("admin-1")
    assert admin.post("/api/admin/users", json=account(password="")).status_code == 400          # needs a password
    assert admin.post("/api/admin/users", json=account(password="123")).status_code == 400       # too short
    assert admin.post("/api/admin/users", json=account(email="nope")).status_code == 400
    assert admin.post("/api/admin/users", json=account(full_name=" ")).status_code == 400
    assert admin.post("/api/admin/users", json=account(email="REP@classcast.test")).status_code == 409   # taken
    assert admin.post("/api/admin/users", json=account(course_ids=["xyz-999"])).status_code == 400
    assert admin.post("/api/admin/users", json=account(role="boss")).status_code == 422


def test_admin_edits_an_account_and_keeps_the_password(client, db, fake_logins):
    admin = client.login("admin-1")
    uid = admin.post("/api/admin/users", json=account()).json()["id"]
    edited = admin.put(f"/api/admin/users/{uid}", json=account(full_name="Ama K. Owusu", course_ids=["csc-305"], password="")).json()
    assert edited["full_name"] == "Ama K. Owusu" and [c["code"] for c in edited["courses"]] == ["CSC 305"]
    assert fake_logins.accounts[uid]["password"] == "secret1"
    admin_fields = account(role="admin", course_ids=["csc-301"], password=None)
    assert admin.put(f"/api/admin/users/{uid}", json=admin_fields).json()["course_ids"] == []   # admins have no courses


def test_admin_cannot_demote_disable_or_remove_themself(client):
    admin = client.login("admin-1")
    me = {"full_name": "Esi Asante", "email": "admin@classcast.test", "role": "course_rep", "course_ids": []}
    assert admin.put("/api/admin/users/admin-1", json=me).status_code == 400
    assert admin.patch("/api/admin/users/admin-1/active", json={"is_active": False}).status_code == 400
    assert admin.delete("/api/admin/users/admin-1").status_code == 400


def test_disabling_an_account_blocks_its_login(client, db, fake_logins):
    admin = client.login("admin-1")
    assert admin.patch("/api/admin/users/student-1/active", json={"is_active": False}).json()["is_active"] is False
    assert db.get("users", "student-1")["is_active"] is False and fake_logins.accounts["student-1"]["disabled"] is True


def test_removing_an_account(client, db, monday):
    client.login("rep-1").post("/api/reservations", json={
        "classroom_id": "nlt-2", "course_id": "csc-301", "reservation_date": monday, "start_time": "10:00",
        "end_time": "12:00", "purpose": "Revision", "expected_attendance": 50})
    admin = client.login("admin-1")
    assert admin.delete("/api/admin/users/rep-1").status_code == 400            # has a reservation on record
    assert admin.delete("/api/admin/users/student-1").status_code == 204
    assert db.get("users", "student-1") is None
    assert admin.delete("/api/admin/users/student-1").status_code == 404


# ---------- classrooms ----------
def test_admin_adds_edits_and_removes_a_room(client, db):
    admin = client.login("admin-1")
    room = {"name": "NLT 20", "building_id": "nlt", "capacity": 80, "facility_ids": ["projector", "ghost"], "is_active": True}
    created = admin.post("/api/admin/classrooms", json=room).json()
    assert created["id"] == "nlt-20" and created["facilities"] == ["Projector"] and created["building"]["code"] == "NLT"
    assert admin.post("/api/admin/classrooms", json={**room, "name": "nlt  20"}).status_code == 409   # same name
    assert admin.post("/api/admin/classrooms", json={**room, "name": "X", "building_id": "nowhere"}).status_code == 400

    admin.put("/api/admin/classrooms/nlt-20", json={**room, "capacity": 90, "is_active": False})
    assert db.get("classrooms", "nlt-20")["capacity"] == 90
    assert len(admin.get("/api/admin/classrooms").json()) == 95                        # admins see disabled rooms
    assert len(client.login("rep-1").get("/api/lookups").json()["classrooms"]) == 94  # reps do not
    admin = client.login("admin-1")
    assert admin.delete("/api/admin/classrooms/nlt-20").status_code == 204


def test_a_room_in_use_cannot_be_removed(client):
    response = client.login("admin-1").delete("/api/admin/classrooms/nlt-1")
    assert response.status_code == 400 and "timetable" in response.json()["detail"]


# ---------- buildings and facilities ----------
def test_buildings(client, db):
    admin = client.login("admin-1")
    listed = admin.get("/api/admin/buildings").json()
    assert listed[0]["code"] == "NLT" and listed[0]["rooms"] == 19
    created = admin.post("/api/admin/buildings", json={"name": "Science Complex", "code": "SC"}).json()
    assert created["id"] == "sc"
    assert admin.post("/api/admin/buildings", json={"name": "Other", "code": "nlt"}).status_code == 409
    assert admin.put("/api/admin/buildings/sc", json={"name": "Science Complex B", "code": "SCB"}).json()["code"] == "SCB"
    assert admin.delete("/api/admin/buildings/nlt").status_code == 400                 # still has rooms
    assert admin.delete("/api/admin/buildings/sc").status_code == 204


def test_removing_a_facility_takes_it_off_every_room(client, db):
    admin = client.login("admin-1")
    assert admin.post("/api/admin/facilities", json={"name": "Smart board"}).json()["id"] == "smart-board"
    assert admin.post("/api/admin/facilities", json={"name": "smart BOARD"}).status_code == 409
    assert admin.put("/api/admin/facilities/projector", json={"name": "Projector (HD)"}).json()["name"] == "Projector (HD)"
    assert admin.delete("/api/admin/facilities/whiteboard").status_code == 204
    assert all("whiteboard" not in r["facility_ids"] for r in db.all("classrooms"))


# ---------- timetable ----------
def test_admin_adds_edits_and_removes_a_class(client, db):
    admin = client.login("admin-1")
    entry = {"course_id": "sta-201", "classroom_id": "lt-7", "day_of_week": 6, "start_time": "09:00", "end_time": "11:00"}
    created = admin.post("/api/admin/timetable", json=entry).json()
    assert created["course"]["code"] == "STA 201" and created["classroom"]["name"] == "LT 7"
    clash = admin.post("/api/admin/timetable", json={**entry, "course_id": "csc-301", "start_time": "10:00", "end_time": "12:00"})
    assert clash.status_code == 409 and "STA 201" in clash.json()["detail"]
    assert admin.put(f'/api/admin/timetable/{created["id"]}', json={**entry, "end_time": "12:00"}).status_code == 200   # its own slot is fine
    assert admin.post("/api/admin/timetable", json={**entry, "start_time": "12:00", "end_time": "11:00"}).status_code == 400
    assert len(admin.get("/api/admin/timetable").json()) == 16

    db.add("session_overrides", {"timetable_entry_id": created["id"], "session_date": "2026-12-05", "type": "cancelled"})
    assert admin.delete(f'/api/admin/timetable/{created["id"]}').status_code == 204
    assert db.all("session_overrides") == []


def test_timetable_upload_imports_good_rows_and_reports_bad_ones(client, db):
    rows = [
        {"course_code": "csc  301", "room": "NLT 2", "day": "Mon", "start": "8:00", "end": "10:00", "lecturer": "Dr. Mensah"},
        {"course_code": "BIO 101", "course_title": "Cell Biology", "room": "lt 9", "day": "2", "start": "13:00", "end": "15:00"},
        {"course_code": "", "room": "NLT 2", "day": "Monday", "start": "08:00", "end": "10:00"},
        {"course_code": "CSC 305", "room": "Moon 1", "day": "Monday", "start": "08:00", "end": "10:00"},
        {"course_code": "CSC 305", "room": "NLT 3", "day": "Funday", "start": "08:00", "end": "10:00"},
        {"course_code": "CSC 305", "room": "NLT 3", "day": "Monday", "start": "8am", "end": "10:00"},
        {"course_code": "CSC 305", "room": "NLT 3", "day": "Monday", "start": "10:00", "end": "09:00"},
        {"course_code": "CSC 305", "room": "NLT 1", "day": "Monday", "start": "09:00", "end": "11:00"},   # CSC 301 is there
        {"course_code": "CSC 305", "room": "NLT 2", "day": "Monday", "start": "09:00", "end": "11:00"},   # clashes with row 1
    ]
    out = client.login("admin-1").post("/api/admin/timetable/import", json={"rows": rows}).json()
    assert out["imported"] == 2
    assert [s["line"] for s in out["skipped"]] == [4, 5, 6, 7, 8, 9, 10]
    assert len(db.all("timetable")) == 17
    assert db.get("courses", "bio-101") == {"id": "bio-101", "code": "BIO 101", "title": "Cell Biology"}
    added = [t for t in db.all("timetable") if t["classroom_id"] == "nlt-2"][0]
    assert (added["course_id"], added["day_of_week"], added["start_time"]) == ("csc-301", 1, "08:00")


def test_timetable_upload_can_replace_everything(client, db):
    db.add("session_overrides", {"timetable_entry_id": "class-01", "session_date": "2026-12-07", "type": "cancelled"})
    admin = client.login("admin-1")
    row = {"course_code": "MAT 204", "room": "NLT 1", "day": "Monday", "start": "08:00", "end": "10:00"}
    assert admin.post("/api/admin/timetable/import", json={"rows": [row], "replace": True}).json()["imported"] == 1
    assert len(db.all("timetable")) == 1 and db.all("session_overrides") == []
    bad = admin.post("/api/admin/timetable/import", json={"rows": [{**row, "room": "nowhere"}], "replace": True}).json()
    assert bad["imported"] == 0 and len(db.all("timetable")) == 1              # nothing changed when every row fails


# ---------- overview ----------
def test_overview_counts_and_usage(client, db):
    db.add("activity_logs", {"user_id": "admin-1", "user_name": "Esi Asante", "text": "Did a thing", "created_at": "2026-11-01T09:00:00+00:00"})
    o = client.login("admin-1").get("/api/admin/overview").json()
    assert (o["rooms_total"], o["rooms_active"], o["accounts"], o["classes"]) == (94, 94, 4, 15)
    assert o["top_rooms"][0] == {"name": "NLT 1", "hours": 8.0}                 # four 2-hour classes a week
    assert sum(b["hours"] for b in o["buildings"]) == 30.0
    assert o["activity"][0]["user"] == "Esi Asante"


def test_admin_endpoints_are_closed_to_reps(client):
    rep = client.login("rep-1")
    for path in ("/api/admin/users", "/api/admin/classrooms", "/api/admin/buildings", "/api/admin/timetable",
                 "/api/admin/overview", "/api/admin/pending-counts"):
        assert rep.get(path).status_code == 403, path
