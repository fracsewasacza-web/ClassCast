"""
Who am I, my alerts, and my classes.
    GET   /api/me
    GET   /api/notifications
    GET   /api/notifications/unread-count
    PATCH /api/notifications/read-all
    GET   /api/timetable/mine
"""
from fastapi import APIRouter, Depends

from app import store
from app.auth import current_user, require_role
from app.services import records

router = APIRouter(tags=["Me"])


@router.get("/me")
def get_me(user: dict = Depends(current_user)) -> dict:
    """The signed-in person, with their role and courses. The front end uses the role to pick the UI."""
    return records.user_view(user)


@router.get("/notifications")
def my_notifications(user: dict = Depends(current_user)) -> list[dict]:
    """The signed-in person's alerts, newest first."""
    rows = store.db.where("notifications", user_id=user["id"])
    return sorted(rows, key=lambda n: n.get("created_at", ""), reverse=True)


@router.get("/notifications/unread-count")
def unread_count(user: dict = Depends(current_user)) -> dict:
    """The number on the Alerts badge."""
    return {"count": sum(1 for n in store.db.where("notifications", user_id=user["id"]) if not n.get("is_read"))}


@router.patch("/notifications/read-all")
def mark_all_read(user: dict = Depends(current_user)) -> dict:
    """Mark every alert of the signed-in person as read."""
    unread = [n for n in store.db.where("notifications", user_id=user["id"]) if not n.get("is_read")]
    for n in unread:
        store.db.update("notifications", n["id"], {"is_read": True})
    return {"marked": len(unread)}


@router.get("/timetable/mine")
def my_classes(user: dict = Depends(require_role("course_rep"))) -> list[dict]:
    """The weekly classes of the courses this rep represents, Monday first."""
    mine = set(user.get("course_ids", []))
    rows = [records.timetable_view(t) for t in store.db.lookup("timetable") if t["course_id"] in mine]
    return sorted(rows, key=lambda t: (t["day_of_week"], t["start_time"]))
