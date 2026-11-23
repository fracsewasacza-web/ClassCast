"""
ADMIN MODULE 4 — the official weekly timetable.
    GET    /api/admin/timetable
    POST   /api/admin/timetable
    PUT    /api/admin/timetable/{entry_id}
    DELETE /api/admin/timetable/{entry_id}
    POST   /api/admin/timetable/import     (rows already read from a CSV file or an image)
    GET    /api/admin/timetable/imports    (the upload history)
    DELETE /api/admin/timetable/imports/{import_id}   (take one upload's classes off again)
    POST   /api/admin/timetable/read-image (Claude reads a timetable photo into rows to check)
"""
import re

from fastapi import APIRouter, Depends, HTTPException

from app import store
from app.auth import require_role
from app.schemas import ImportIn, TimetableImageIn, TimetableIn
from app.services import records, schedule, timetable_reader

router = APIRouter(prefix="/admin", tags=["Timetable (admin)"])
admin = require_role("admin")

DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def find_clash(entries: list[dict], room_id: str, day: int, start: str, end: str, ignore: str | None = None):
    """The class already in that room at that time on that weekday, or None."""
    return next((t for t in entries if (ignore is None or t["id"] != ignore) and t["classroom_id"] == room_id and t["day_of_week"] == day
                 and schedule.overlaps(start, end, t["start_time"], t["end_time"])), None)


@router.get("/timetable")
def list_timetable(user: dict = Depends(admin)) -> list[dict]:
    """The whole week, Monday first, earliest class first."""
    rows = [records.timetable_view(t) for t in store.db.all("timetable")]
    return sorted(rows, key=lambda t: (t["day_of_week"], t["start_time"]))


def entry_fields(body: TimetableIn, entry_id: str | None) -> dict:
    if store.db.get("courses", body.course_id) is None:
        raise HTTPException(400, "Choose a course.")
    if store.db.get("classrooms", body.classroom_id) is None:
        raise HTTPException(400, "Choose a room.")
    if body.end_time <= body.start_time:
        raise HTTPException(400, "End time must be after the start time.")
    hit = find_clash(store.db.where("timetable", day_of_week=body.day_of_week), body.classroom_id,
                     body.day_of_week, body.start_time, body.end_time, ignore=entry_id)
    if hit:
        raise HTTPException(409, f'{records.room_name(body.classroom_id)} already has '
                                 f'{records.course_label(hit["course_id"])} at that time on {DAY_NAMES[body.day_of_week]}s.')
    return {**body.model_dump(), "lecturer_name": (body.lecturer_name or "").strip() or None}


@router.post("/timetable", status_code=201)
def create_entry(body: TimetableIn, user: dict = Depends(admin)) -> dict:
    fields = entry_fields(body, None)
    entry_id = store.db.add("timetable", fields)
    records.log(store.db, user, f'Added {records.course_label(fields["course_id"])} on the timetable')
    return records.timetable_view({**fields, "id": entry_id})


@router.put("/timetable/{entry_id}")
def update_entry(entry_id: str, body: TimetableIn, user: dict = Depends(admin)) -> dict:
    if store.db.get("timetable", entry_id) is None:
        raise HTTPException(404, "That class no longer exists.")
    fields = entry_fields(body, entry_id)
    store.db.update("timetable", entry_id, fields)
    records.log(store.db, user, f'Updated {records.course_label(fields["course_id"])} on the timetable')
    return records.timetable_view({**fields, "id": entry_id})


@router.delete("/timetable/{entry_id}", status_code=204)
def delete_entry(entry_id: str, user: dict = Depends(admin)) -> None:
    """Remove a class, and any one-day changes made to it."""
    entry = store.db.get("timetable", entry_id)
    if entry is None:
        raise HTTPException(404, "That class no longer exists.")
    for o in store.db.where("session_overrides", timetable_entry_id=entry_id):
        store.db.delete("session_overrides", o["id"])
    store.db.delete("timetable", entry_id)
    records.log(store.db, user, f'Removed {records.course_label(entry["course_id"])} ({DAY_NAMES[entry["day_of_week"]]}) from the timetable')


# ---------- CSV upload ----------
def clock(text: str) -> str | None:
    """'8:00' or '08:00' -> '08:00'; anything else -> None."""
    m = re.fullmatch(r"(\d{1,2}):(\d{2})", text.strip())
    return f"{int(m[1]):02d}:{m[2]}" if m and int(m[1]) < 24 and int(m[2]) < 60 else None


def day_number(text: str) -> int | None:
    """'Monday', 'mon', '1' -> 1."""
    s = text.strip().lower()
    if re.fullmatch(r"[1-7]", s):
        return int(s)
    if len(s) >= 3:
        return next((i for i, d in enumerate(DAY_NAMES) if d and d.lower().startswith(s)), None)
    return None


@router.post("/timetable/import")
def import_timetable(body: ImportIn, user: dict = Depends(admin)) -> dict:
    """
    Add the good rows to the timetable (or replace it with them). Bad rows are
    skipped and reported back with their line number and the reason.
    If no row is good, nothing is changed.
    """
    rooms = {r["name"].lower(): r for r in store.db.lookup("classrooms")}
    courses = {c["code"].upper(): c for c in store.db.lookup("courses")}
    kept = [] if body.replace else store.db.all("timetable")
    staged, new_courses, skipped = [], {}, []

    for i, row in enumerate(body.rows):
        line = i + 2                                            # line 1 of the file is the header
        code = " ".join(row.course_code.split()).upper()
        room = rooms.get(row.room.strip().lower())
        day, start, end = day_number(row.day), clock(row.start), clock(row.end)
        if not code:
            reason = "No course code"
        elif not room:
            reason = f'Room "{row.room}" does not exist'
        elif not day:
            reason = f'Day "{row.day}" is not valid'
        elif not start or not end:
            reason = "Times must look like 08:00"
        elif end <= start:
            reason = "End time is not after the start time"
        elif find_clash(kept + staged, room["id"], day, start, end):
            reason = f'{room["name"]} is already taken at that time on {DAY_NAMES[day]}'
        else:
            reason = None
        if reason:
            skipped.append({"line": line, "reason": reason})
            continue
        if code not in courses and code not in new_courses:
            new_courses[code] = {"id": records.new_id("courses", code), "code": code,
                                 "title": row.course_title.strip() or code}
        course = courses.get(code) or new_courses[code]
        staged.append({"id": None, "course_id": course["id"], "classroom_id": room["id"], "day_of_week": day,
                       "start_time": start, "end_time": end, "lecturer_name": row.lecturer.strip() or None})

    import_id = None
    if staged:
        if body.replace:
            for t in store.db.all("timetable"):
                store.db.delete("timetable", t["id"])
            for o in store.db.all("session_overrides"):
                store.db.delete("session_overrides", o["id"])
        for c in new_courses.values():
            store.db.set("courses", c["id"], {"code": c["code"], "title": c["title"]})
        # One record per upload, so the administrator can see it later and take it back off
        name = body.file_name.strip() or ("Timetable photo" if body.source == "image" else "Timetable file")
        import_id = store.db.add("timetable_imports", {
            "file_name": name, "source": body.source, "replace": body.replace,
            "imported": len(staged), "skipped": len(skipped),
            "uploaded_by": user["id"], "uploaded_by_name": user.get("full_name", ""), "created_at": store.now_iso()})
        for t in staged:
            store.db.add("timetable", {**{k: v for k, v in t.items() if k != "id"}, "import_id": import_id})
        store.db.forget("timetable")
        note = f", {len(skipped)} rows skipped" if skipped else ""
        records.log(store.db, user, f'Uploaded {name}: {len(staged)} classes '
                                    f'{"replaced the old timetable" if body.replace else "added"}{note}')
    return {"imported": len(staged), "skipped": skipped, "import_id": import_id}


# ---------- upload history ----------
@router.get("/timetable/imports")
def list_imports(user: dict = Depends(admin)) -> list[dict]:
    """Every upload, newest first, with how many of its classes are still on the timetable."""
    left: dict[str, int] = {}
    for t in store.db.all("timetable"):
        if t.get("import_id"):
            left[t["import_id"]] = left.get(t["import_id"], 0) + 1
    rows = [{**i, "classes_now": left.get(i["id"], 0)} for i in store.db.all("timetable_imports")]
    return sorted(rows, key=lambda i: i["created_at"], reverse=True)


@router.delete("/timetable/imports/{import_id}", status_code=204)
def delete_import(import_id: str, user: dict = Depends(admin)) -> None:
    """Take every class that came from one upload off the timetable, and forget the upload."""
    upload = store.db.get("timetable_imports", import_id)
    if upload is None:
        raise HTTPException(404, "That upload no longer exists.")
    removed = store.db.where("timetable", import_id=import_id)
    gone = {t["id"] for t in removed}
    for o in store.db.all("session_overrides"):
        if o.get("timetable_entry_id") in gone:
            store.db.delete("session_overrides", o["id"])
    for t in removed:
        store.db.delete("timetable", t["id"])
    store.db.delete("timetable_imports", import_id)
    store.db.forget("timetable")
    records.log(store.db, user, f'Removed the upload {upload["file_name"]} ({len(removed)} classes)')


# ---------- reading a timetable photo ----------
@router.post("/timetable/read-image")
def read_timetable_image(body: TimetableImageIn, user: dict = Depends(admin)) -> dict:
    """
    Claude reads the photo and returns the classes as rows in the same shape as a
    CSV upload. Nothing is saved: the administrator checks the rows, then imports them.
    """
    rooms = sorted(r["name"] for r in store.db.lookup("classrooms"))
    try:
        result = timetable_reader.read(body.data, body.media_type, rooms)
    except timetable_reader.ReadError as problem:
        raise HTTPException(problem.status, str(problem))
    return {"rows": result["rows"], "notes": result["notes"]}
