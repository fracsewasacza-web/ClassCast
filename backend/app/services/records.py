"""Small helpers shared by the routers: alerts, the activity log, ids, and joined views."""
import re

from app import store


def notify(writes, user_id: str, title: str, message: str) -> None:
    """Put an alert in a person's Alerts screen."""
    writes.add("notifications", {
        "user_id": user_id, "title": title, "message": message, "is_read": False, "created_at": store.now_iso()})


def log(writes, user: dict, text: str) -> None:
    """Record who did what, for the administrator's activity log."""
    writes.add("activity_logs", {
        "user_id": user["id"], "user_name": user.get("full_name", ""), "text": text, "created_at": store.now_iso()})


def slug(text: str) -> str:
    """'NLT 20' -> 'nlt-20'. Used to make readable document ids."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "item"


def new_id(collection: str, text: str) -> str:
    """A readable id that is not taken yet: 'nlt-20', or 'nlt-20-2' if it is."""
    base = candidate = slug(text)
    n = 1
    while store.db.get(collection, candidate) is not None:
        n += 1
        candidate = f"{base}-{n}"
    return candidate


def room_name(room_id: str) -> str:
    room = next((r for r in store.db.lookup("classrooms") if r["id"] == room_id), None)
    return room["name"] if room else "(removed room)"


def course_label(course_id: str) -> str:
    course = next((c for c in store.db.lookup("courses") if c["id"] == course_id), None)
    return f'{course["code"]} · {course["title"]}' if course else "Other"


def reservation_view(r: dict) -> dict:
    """A reservation with its room, course and requester's name filled in."""
    rooms = {x["id"]: x for x in store.db.lookup("classrooms")}
    courses = {x["id"]: x for x in store.db.lookup("courses")}
    requester = store.db.get("users", r["requested_by"])
    room = rooms.get(r["classroom_id"])
    return {
        **r,
        "classroom": {"id": room["id"], "name": room["name"], "capacity": room["capacity"]} if room
                     else {"id": r["classroom_id"], "name": "(removed room)", "capacity": 0},
        "course": courses.get(r.get("course_id")),
        "requester": requester["full_name"] if requester else "Removed account",
    }


def timetable_view(entry: dict) -> dict:
    """A timetable class with its course and room name filled in."""
    courses = {x["id"]: x for x in store.db.lookup("courses")}
    return {**entry, "course": courses.get(entry["course_id"]),
            "classroom": {"id": entry["classroom_id"], "name": room_name(entry["classroom_id"])}}


def report_view(r: dict, users: dict | None = None) -> dict:
    """A change report with the class, course, rooms and reporter's name filled in."""
    entry = store.db.get("timetable", r["timetable_entry_id"]) if r.get("timetable_entry_id") else None
    courses = {x["id"]: x for x in store.db.lookup("courses")}
    reporter = users.get(r["reported_by"]) if users is not None else store.db.get("users", r["reported_by"])
    room_id = r.get("classroom_id") or (entry and entry["classroom_id"])
    return {
        **r,
        "reporter": reporter["full_name"] if reporter else "Removed account",
        "entry": entry,
        "course": courses.get(entry["course_id"]) if entry else None,
        "classroom": {"id": room_id, "name": room_name(room_id)},
        "proposed_classroom": {"id": r["proposed_classroom_id"], "name": room_name(r["proposed_classroom_id"])}
                              if r.get("proposed_classroom_id") else None,
    }


def user_view(user: dict) -> dict:
    """A ClassCast account with its courses filled in."""
    courses = {c["id"]: c for c in store.db.lookup("courses")}
    return {**user, "courses": [courses[c] for c in user.get("course_ids", []) if c in courses]}
