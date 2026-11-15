"""
COURSE REP MODULES 5 and 6 — report timetable changes and hall availability corrections.
    POST /api/change-reports
    GET  /api/change-reports/mine

Class reports (class_cancelled, venue_moved, time_changed) are about one class
of the rep's own courses on one date. Hall reports (hall_in_use, hall_free) say
the app shows a hall wrongly. Nothing changes until the administrator verifies.
"""
from fastapi import APIRouter, Depends, HTTPException

from app import store
from app.auth import require_role
from app.schemas import CLASS_REPORTS, ChangeReportIn
from app.services import records, schedule

router = APIRouter(tags=["Change reports (course rep)"])
rep = require_role("course_rep")

DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


@router.post("/change-reports", status_code=201)
def create_report(body: ChangeReportIn, user: dict = Depends(rep)) -> dict:
    """Send a report for the administrator to verify."""
    details = body.details.strip()
    row = {"type": body.type, "timetable_entry_id": None, "classroom_id": None, "affected_date": body.affected_date,
           "proposed_classroom_id": None, "proposed_start_time": None, "proposed_end_time": None, "details": details}

    if body.type in CLASS_REPORTS:
        entry = store.db.get("timetable", body.timetable_entry_id) if body.timetable_entry_id else None
        if entry is None:
            raise HTTPException(404, "Choose one of your classes.")
        if entry["course_id"] not in user.get("course_ids", []):
            raise HTTPException(403, "You can only report changes for the courses you represent.")
        if body.affected_date < schedule.today():
            raise HTTPException(400, "Choose today or a future date.")
        if schedule.parse_date(body.affected_date).isoweekday() != entry["day_of_week"]:
            day = DAY_NAMES[entry["day_of_week"]]
            raise HTTPException(400, f"That class meets on {day}s. Pick a {day}.")
        row["timetable_entry_id"] = entry["id"]

        if body.type == "venue_moved":
            new_room = store.db.get("classrooms", body.proposed_classroom_id) if body.proposed_classroom_id else None
            if new_room is None or not new_room.get("is_active", True):
                raise HTTPException(400, "Choose the hall the class moved to.")
            if new_room["id"] == entry["classroom_id"]:
                raise HTTPException(400, "The new hall is the same as the current one.")
            row["proposed_classroom_id"] = new_room["id"]

        if body.type == "time_changed":
            start, end = body.proposed_start_time, body.proposed_end_time
            if not start or not end:
                raise HTTPException(400, "Enter the new start and end time.")
            if end <= start:
                raise HTTPException(400, "New end time must be after the new start time.")
            row["proposed_start_time"], row["proposed_end_time"] = start, end
    else:
        room = store.db.get("classrooms", body.classroom_id) if body.classroom_id else None
        if room is None:
            raise HTTPException(404, "Choose the hall.")
        if not details:
            raise HTTPException(400, "Add a short note about what you saw.")
        schedule.parse_date(body.affected_date)
        row["classroom_id"] = room["id"]

    row.update({"reported_by": user["id"], "status": "pending", "verified_by": None, "verified_at": None,
                "created_at": store.now_iso()})
    row["id"] = store.db.add("change_reports", dict(row))
    records.log(store.db, user, f'Sent a "{body.type.replace("_", " ")}" report')
    return records.report_view(row)


@router.get("/change-reports/mine")
def my_reports(user: dict = Depends(rep)) -> list[dict]:
    """Everything this rep has reported, newest first."""
    rows = store.db.where("change_reports", reported_by=user["id"])
    users = {user["id"]: user}
    return [records.report_view(r, users) for r in sorted(rows, key=lambda r: r["created_at"], reverse=True)]
