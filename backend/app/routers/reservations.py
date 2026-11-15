"""
COURSE REP — request, view and cancel reservations.
    POST  /api/reservations
    GET   /api/reservations/mine
    PATCH /api/reservations/{reservation_id}/cancel
"""
from fastapi import APIRouter, Depends, HTTPException

from app import store
from app.auth import require_role
from app.schemas import ReservationIn
from app.services import records, schedule

router = APIRouter(tags=["Reservations (course rep)"])
rep = require_role("course_rep")


@router.post("/reservations", status_code=201)
def create_reservation(body: ReservationIn, user: dict = Depends(rep)) -> dict:
    """Ask for a room. Refused with 409 if anything else is in the room at that time."""
    room = store.db.get("classrooms", body.classroom_id)
    if room is None or not room.get("is_active", True):
        raise HTTPException(404, "That room is not available.")
    if body.course_id not in user.get("course_ids", []):
        raise HTTPException(403, "You can only book for the courses you represent.")
    if body.end_time <= body.start_time:
        raise HTTPException(400, "End time must be after the start time.")
    if body.reservation_date < schedule.today():
        raise HTTPException(400, "Choose today or a future date.")
    if body.expected_attendance > room["capacity"]:
        raise HTTPException(400, f'{room["name"]} only seats {room["capacity"]}. Choose a bigger room.')
    purpose = body.purpose.strip()
    if not purpose:
        raise HTTPException(400, "Enter the purpose of the reservation.")

    def work(writes) -> dict:
        # Runs one at a time per room and date (see store.locked), so two reps cannot both get the slot.
        hits = schedule.find_clashes(room["id"], body.reservation_date, body.start_time, body.end_time)
        if hits:
            raise HTTPException(409, f'That slot is taken: {hits[0]["label"]}')
        row = {**body.model_dump(), "purpose": purpose, "requested_by": user["id"], "status": "pending",
               "rejection_reason": None, "reviewed_by": None, "reviewed_at": None, "created_at": store.now_iso()}
        row["id"] = writes.add("reservations", {k: v for k, v in row.items() if k != "id"})
        records.log(writes, user, f'Requested {room["name"]} for {body.reservation_date}')
        return row

    row = store.db.locked(f'{room["id"]}_{body.reservation_date}', work)
    return records.reservation_view(row)


@router.get("/reservations/mine")
def my_reservations(user: dict = Depends(rep)) -> list[dict]:
    """Everything this rep has requested, newest date first."""
    rows = store.db.where("reservations", requested_by=user["id"])
    return [records.reservation_view(r) for r in sorted(rows, key=lambda r: r["reservation_date"], reverse=True)]


@router.patch("/reservations/{reservation_id}/cancel")
def cancel_reservation(reservation_id: str, user: dict = Depends(rep)) -> dict:
    """Cancel a pending or approved reservation. The room becomes free again."""
    r = store.db.get("reservations", reservation_id)
    if r is None or r["requested_by"] != user["id"]:
        raise HTTPException(404, "That reservation is not yours.")
    if r["status"] not in schedule.ACTIVE:
        raise HTTPException(400, f'This reservation is already {r["status"]}.')
    store.db.update("reservations", reservation_id, {"status": "cancelled"})
    records.log(store.db, user, f'Cancelled the {records.room_name(r["classroom_id"])} booking for {r["reservation_date"]}')
    return records.reservation_view({**r, "status": "cancelled"})
