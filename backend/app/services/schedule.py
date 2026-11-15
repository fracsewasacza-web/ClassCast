"""
The rules for "is this room free?". Used by the search, the room timetable,
the clash check, booking and approval, so the answer is the same everywhere.

A room is occupied by:
  1. classes on the weekly timetable (unless cancelled or moved for that date)
  2. reservations that are pending or approved

Dates are text like "2026-11-16" and times are text like "08:00".
Text in that form sorts correctly, so "08:00" < "10:00" works.
"""
from datetime import date, datetime, timezone

from fastapi import HTTPException

from app import store

ACTIVE = ("pending", "approved")       # reservation statuses that hold a room


def today() -> str:
    # Ghana is on UTC all year, so UTC "today" is Ghana's "today".
    return datetime.now(timezone.utc).date().isoformat()


def parse_date(day: str) -> date:
    try:
        return date.fromisoformat(day)
    except ValueError:
        raise HTTPException(400, f'"{day}" is not a real date.')


def overlaps(start1: str, end1: str, start2: str, end2: str) -> bool:
    """Two time slots clash when each one starts before the other ends."""
    return start1 < end2 and end1 > start2


def load_day(day: str) -> dict:
    """Everything needed to work out any room's schedule on one date (3 small reads)."""
    weekday = parse_date(day).isoweekday()                     # 1 = Monday … 7 = Sunday
    return {
        "date": day,
        "entries": store.db.where("timetable", day_of_week=weekday),
        "overrides": {o["timetable_entry_id"]: o for o in store.db.where("session_overrides", session_date=day)},
        "reservations": [r for r in store.db.where("reservations", reservation_date=day) if r["status"] in ACTIVE],
        "courses": {c["id"]: c for c in store.db.lookup("courses")},
    }


def room_blocks(room_id: str, day: dict, ignore_reservation: str | None = None,
                ignore_entry: str | None = None) -> list[dict]:
    """Every occupied slot in one room on that date, earliest first."""
    blocks = []
    for entry in day["entries"]:
        if entry["id"] == ignore_entry:
            continue
        change = day["overrides"].get(entry["id"])              # cancelled / moved / rescheduled that date
        if change and change["type"] == "cancelled":
            continue
        room = (change and change.get("new_classroom_id")) or entry["classroom_id"]
        if room != room_id:
            continue
        course = day["courses"].get(entry["course_id"])
        blocks.append({
            "kind": "class",
            "start": (change and change.get("new_start_time")) or entry["start_time"],
            "end": (change and change.get("new_end_time")) or entry["end_time"],
            "label": f'{course["code"]} · {course["title"]}' if course else "Class",
        })
    for r in day["reservations"]:
        if r["id"] == ignore_reservation or r["classroom_id"] != room_id:
            continue
        blocks.append({
            "kind": "reservation", "start": r["start_time"], "end": r["end_time"], "status": r["status"],
            "label": f'{r.get("purpose") or "Reservation"} ({r["status"]})',
        })
    return sorted(blocks, key=lambda b: b["start"])


def find_clashes(room_id: str, day: str, start: str, end: str, **ignore) -> list[dict]:
    """The occupied slots that overlap start–end. An empty list means the room is free."""
    return [b for b in room_blocks(room_id, load_day(day), **ignore) if overlaps(start, end, b["start"], b["end"])]


def room_status(blocks: list[dict], start: str, end: str) -> tuple[bool, str]:
    """(is_free, hint) for one room, e.g. (False, 'In use: CSC 301 · Operating Systems. Free from 10:00')."""
    hits = [b for b in blocks if overlaps(start, end, b["start"], b["end"])]
    if not hits:
        following = next((b for b in blocks if b["start"] >= end), None)
        return True, f'Free until {following["start"]}' if following else "Free for the rest of the day"
    until = max(b["end"] for b in hits)
    for b in blocks:                                            # back-to-back classes
        if b["start"] <= until < b["end"]:
            until = b["end"]
    return False, f'In use: {hits[0]["label"]}. Free from {until}'


def room_view(room: dict) -> dict:
    """A classroom with its building and facility names filled in."""
    buildings = {b["id"]: b for b in store.db.lookup("buildings")}
    facilities = {f["id"]: f["name"] for f in store.db.lookup("facilities")}
    return {
        **room,
        "building": buildings.get(room["building_id"]),
        "facilities": [facilities[f] for f in room.get("facility_ids", []) if f in facilities],
    }
