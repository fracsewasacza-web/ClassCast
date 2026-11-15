"""
ADMIN MODULE 5 — approve or reject reservation requests.
    GET   /api/admin/reservations
    PATCH /api/admin/reservations/{reservation_id}
"""
from fastapi import APIRouter, Depends, HTTPException

from app import store
from app.auth import require_role
from app.schemas import ReviewIn
from app.services import records, schedule

router = APIRouter(prefix="/admin", tags=["Reservations (admin)"])
admin = require_role("admin")


@router.get("/reservations")
def all_reservations(status: str | None = None, user: dict = Depends(admin)) -> list[dict]:
    """Every request, earliest date first. Pending ones say whether the slot is still free."""
    rows = store.db.where("reservations", status=status) if status else store.db.all("reservations")
    out = []
    for r in sorted(rows, key=lambda r: r["reservation_date"]):
        view = records.reservation_view(r)
        view["clashes"] = schedule.find_clashes(
            r["classroom_id"], r["reservation_date"], r["start_time"], r["end_time"],
            ignore_reservation=r["id"]) if r["status"] == "pending" else []
        out.append(view)
    return out


@router.patch("/reservations/{reservation_id}")
def review_reservation(reservation_id: str, body: ReviewIn, user: dict = Depends(admin)) -> dict:
    """Approve or reject a pending request. The course rep gets an alert either way."""
    found = store.db.get("reservations", reservation_id)
    if found is None:
        raise HTTPException(404, "That request no longer exists.")
    reason = (body.reason or "").strip()
    if body.decision == "rejected" and not reason:
        raise HTTPException(400, "Give a reason so the course rep knows why.")
    room = records.room_name(found["classroom_id"])
    where = f'{room} on {found["reservation_date"]}'

    def work(writes) -> dict:
        r = store.db.get("reservations", reservation_id)          # read again, now that we hold the lock
        if r["status"] != "pending":
            raise HTTPException(400, "That request has already been handled.")
        changes = {"status": body.decision, "reviewed_by": user["id"], "reviewed_at": store.now_iso()}
        if body.decision == "approved":
            hits = schedule.find_clashes(r["classroom_id"], r["reservation_date"], r["start_time"], r["end_time"],
                                         ignore_reservation=r["id"])
            if hits:
                raise HTTPException(409, f'Cannot approve: the slot is now taken by {hits[0]["label"]}.')
            records.notify(writes, r["requested_by"], "Reservation approved", f"{where} is confirmed.")
        else:
            changes["rejection_reason"] = reason
            records.notify(writes, r["requested_by"], "Reservation rejected", f"{where}: {reason}")
        writes.update("reservations", reservation_id, changes)
        records.log(writes, user, f'{body.decision.capitalize()} the {room} request')
        return {**r, **changes}

    row = store.db.locked(f'{found["classroom_id"]}_{found["reservation_date"]}', work)
    return records.reservation_view(row)
