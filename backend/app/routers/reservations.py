"""
COURSE REP — request, view and cancel reservations.
    POST  /api/reservations
    POST  /api/reservations/batch
    GET   /api/reservations/mine
    PATCH /api/reservations/{reservation_id}/cancel
"""
from fastapi import APIRouter, Depends, HTTPException

from app import store
from app.auth import require_role
from app.schemas import ReservationBatchIn, ReservationIn
from app.services import records, schedule

router = APIRouter(tags=["Reservations (course rep)"])
rep = require_role("course_rep")


def _checked(body: ReservationIn, user: dict, prefix: str = "") -> tuple[dict, str]:
    """The checks that don't depend on what else is booked. Returns (room, purpose)."""
    room = store.db.get("classrooms", body.classroom_id)
    if room is None or not room.get("is_active", True):
        raise HTTPException(404, f"{prefix}That room is not available.")
    if body.course_id not in user.get("course_ids", []):
        raise HTTPException(403, f"{prefix}You can only book for the courses you represent.")
    if body.end_time <= body.start_time:
        raise HTTPException(400, f"{prefix}End time must be after the start time.")
    if body.reservation_date < schedule.today():
        raise HTTPException(400, f"{prefix}Choose today or a future date.")
    if body.expected_attendance > room["capacity"]:
        raise HTTPException(400, f'{prefix}{room["name"]} only seats {room["capacity"]}. Choose a bigger room.')
    purpose = body.purpose.strip()
    if not purpose:
        raise HTTPException(400, f"{prefix}Enter the purpose of the reservation.")
    return room, purpose


def _save(writes, body: ReservationIn, room: dict, purpose: str, user: dict) -> dict:
    row = {**body.model_dump(), "purpose": purpose, "requested_by": user["id"], "status": "pending",
           "rejection_reason": None, "reviewed_by": None, "reviewed_at": None, "created_at": store.now_iso()}
    row["id"] = writes.add("reservations", {k: v for k, v in row.items() if k != "id"})
    records.log(writes, user, f'Requested {room["name"]} for {body.reservation_date}')
    return row


@router.post("/reservations", status_code=201)
def create_reservation(body: ReservationIn, user: dict = Depends(rep)) -> dict:
    """Ask for a room. Refused with 409 if anything else is in the room at that time."""
    room, purpose = _checked(body, user)

    def work(writes) -> dict:
        # Runs one at a time per room and date (see store.locked), so two reps cannot both get the slot.
        hits = schedule.find_clashes(room["id"], body.reservation_date, body.start_time, body.end_time)
        if hits:
            raise HTTPException(409, f'That slot is taken: {hits[0]["label"]}')
        return _save(writes, body, room, purpose, user)

    row = store.db.locked(f'{room["id"]}_{body.reservation_date}', work)
    return records.reservation_view(row)


@router.post("/reservations/batch", status_code=201)
def create_reservations(body: ReservationBatchIn, user: dict = Depends(rep)) -> list[dict]:
    """Ask for several rooms or slots at once (up to 20). All or nothing: if any one is
    refused, none are saved, and the error says which one ("Booking 2: ...")."""
    items = body.reservations
    checked = [_checked(b, user, prefix=f"Booking {i}: ") for i, b in enumerate(items, 1)]

    # Two bookings in the same list must not clash with each other either.
    for i, a in enumerate(items):
        for j in range(i + 1, len(items)):
            b = items[j]
            if (a.classroom_id == b.classroom_id and a.reservation_date == b.reservation_date
                    and schedule.overlaps(a.start_time, a.end_time, b.start_time, b.end_time)):
                raise HTTPException(409, f"Booking {j + 1}: overlaps booking {i + 1} in the same room.")

    def work(writes) -> list[dict]:
        # Holds every room-and-date in the list at once, so no other booking can slip in between.
        for i, (b, (room, _)) in enumerate(zip(items, checked), 1):
            hits = schedule.find_clashes(room["id"], b.reservation_date, b.start_time, b.end_time)
            if hits:
                raise HTTPException(409, f'Booking {i}: {room["name"]} is taken: {hits[0]["label"]}')
        return [_save(writes, b, room, purpose, user) for b, (room, purpose) in zip(items, checked)]

    keys = [f"{b.classroom_id}_{b.reservation_date}" for b in items]
    rows = store.db.locked(keys, work)
    return [records.reservation_view(r) for r in rows]


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
