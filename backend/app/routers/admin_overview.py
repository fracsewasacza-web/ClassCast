"""
ADMIN MODULE 7 — what is waiting, how the rooms are used, and who did what.
    GET /api/admin/pending-counts      (the numbers on the menu badges)
    GET /api/admin/overview
"""
from fastapi import APIRouter, Depends

from app import store
from app.auth import require_role

router = APIRouter(prefix="/admin", tags=["Overview (admin)"])
admin = require_role("admin")

ACTIVITY_SHOWN = 40


def minutes(clock: str) -> int:
    return int(clock[:2]) * 60 + int(clock[3:])


def hours(start: str, end: str) -> float:
    return (minutes(end) - minutes(start)) / 60


@router.get("/pending-counts")
def pending_counts(user: dict = Depends(admin)) -> dict:
    return {"requests": len(store.db.where("reservations", status="pending")),
            "reports": len(store.db.where("change_reports", status="pending"))}


@router.get("/overview")
def overview(user: dict = Depends(admin)) -> dict:
    rooms = store.db.lookup("classrooms")
    timetable = store.db.lookup("timetable")
    approved = store.db.where("reservations", status="approved")

    used = {r["id"]: 0.0 for r in rooms}                       # weekly class hours + approved booking hours
    for t in timetable:
        if t["classroom_id"] in used:
            used[t["classroom_id"]] += hours(t["start_time"], t["end_time"])
    for r in approved:
        if r["classroom_id"] in used:
            used[r["classroom_id"]] += hours(r["start_time"], r["end_time"])

    buildings = sorted(store.db.lookup("buildings"), key=lambda b: (b.get("sort_order", 0), b["name"]))
    activity = sorted(store.db.all("activity_logs"), key=lambda a: a["created_at"], reverse=True)[:ACTIVITY_SHOWN]
    return {
        "pending_requests": len(store.db.where("reservations", status="pending")),
        "pending_reports": len(store.db.where("change_reports", status="pending")),
        "rooms_total": len(rooms),
        "rooms_active": sum(1 for r in rooms if r.get("is_active", True)),
        "accounts": sum(1 for u in store.db.all("users") if u.get("is_active", True)),
        "classes": len(timetable),
        "buildings": [{"code": b["code"], "name": b["name"],
                       "rooms": sum(1 for r in rooms if r["building_id"] == b["id"]),
                       "hours": round(sum(used[r["id"]] for r in rooms if r["building_id"] == b["id"]), 1)}
                      for b in buildings],
        "top_rooms": [{"name": r["name"], "hours": round(used[r["id"]], 1)}
                      for r in sorted(rooms, key=lambda r: -used[r["id"]]) if used[r["id"]] > 0][:6],
        "activity": [{**a, "user": a.get("user_name") or "Removed account"} for a in activity],
    }
