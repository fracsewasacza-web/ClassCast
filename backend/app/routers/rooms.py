"""
STUDENT FEATURES — which rooms are free, and one room's timetable.
    GET /api/lookups
    GET /api/rooms/search
    GET /api/rooms/{room_id}
    GET /api/rooms/{room_id}/schedule
    GET /api/reservations/check-clash
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from app import store
from app.auth import current_user
from app.schemas import DATE, TIME
from app.services import schedule

router = APIRouter(tags=["Rooms"])


def check_slot(start: str, end: str) -> None:
    if end <= start:
        raise HTTPException(400, "End time must be after the start time.")


@router.get("/lookups")
def lookups(user: dict = Depends(current_user)) -> dict:
    """The lists every screen needs for its drop-downs: open rooms, buildings, facilities, courses."""
    def by_order(x: dict) -> tuple:
        return x.get("sort_order", 0), x.get("name", "")

    rooms = [schedule.room_view(r) for r in store.db.lookup("classrooms") if r.get("is_active", True)]
    return {
        "classrooms": sorted(rooms, key=by_order),
        "buildings": sorted(store.db.lookup("buildings"), key=by_order),
        "facilities": sorted(store.db.lookup("facilities"), key=lambda f: f["name"].lower()),
        "courses": sorted(store.db.lookup("courses"), key=lambda c: c["code"]),
    }


@router.get("/rooms/search")
def search_rooms(
    date: str = Query(pattern=DATE), start: str = Query(pattern=TIME), end: str = Query(pattern=TIME),
    building: str | None = None, min_capacity: int | None = None, facility: str | None = None, q: str | None = None,
    user: dict = Depends(current_user),
) -> list[dict]:
    """Every open room, marked free or in use for the slot. Free rooms come first."""
    check_slot(start, end)
    day = schedule.load_day(date)
    text = (q or "").strip().lower()
    results = []
    for room in store.db.lookup("classrooms"):
        if not room.get("is_active", True):
            continue
        if building and room["building_id"] != building:
            continue
        if min_capacity and room["capacity"] < min_capacity:
            continue
        if facility and facility not in room.get("facility_ids", []):
            continue
        view = schedule.room_view(room)
        if text and text not in f'{room["name"]} {view["building"]["name"] if view["building"] else ""}'.lower():
            continue
        is_free, hint = schedule.room_status(schedule.room_blocks(room["id"], day), start, end)
        results.append({**view, "is_free": is_free, "hint": hint})
    return sorted(results, key=lambda r: (not r["is_free"], r.get("sort_order", 0)))


@router.get("/rooms/{room_id}")
def get_room(room_id: str, user: dict = Depends(current_user)) -> dict:
    """One room, with its building and facility names."""
    room = store.db.get("classrooms", room_id)
    if room is None:
        raise HTTPException(404, "That room no longer exists.")
    return schedule.room_view(room)


@router.get("/rooms/{room_id}/schedule")
def room_schedule(room_id: str, date: str = Query(pattern=DATE), user: dict = Depends(current_user)) -> dict:
    """One room's details and everything occupying it on a date."""
    room = store.db.get("classrooms", room_id)
    if room is None:
        raise HTTPException(404, "That room does not exist.")
    return {"room": schedule.room_view(room), "date": date,
            "blocks": schedule.room_blocks(room_id, schedule.load_day(date))}


@router.get("/reservations/check-clash")
def check_clash(
    classroom_id: str, date: str = Query(pattern=DATE), start: str = Query(pattern=TIME), end: str = Query(pattern=TIME),
    user: dict = Depends(current_user),
) -> list[dict]:
    """What is already in the room during the slot. An empty list means it is free."""
    check_slot(start, end)
    return schedule.find_clashes(classroom_id, date, start, end)
