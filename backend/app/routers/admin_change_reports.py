"""
ADMIN MODULE 6 — verify or reject what course reps reported.
    GET   /api/admin/change-reports
    PATCH /api/admin/change-reports/{report_id}

Verifying a class report changes the timetable for that ONE date, by saving a
session override (cancelled / moved / rescheduled). The weekly timetable itself
is not touched. Everyone on the course is then told.
"""
from fastapi import APIRouter, Depends, HTTPException

from app import store
from app.auth import require_role
from app.schemas import CLASS_REPORTS, ReportReviewIn
from app.services import records, schedule

router = APIRouter(prefix="/admin", tags=["Change reports (admin)"])
admin = require_role("admin")

OVERRIDE_TYPE = {"class_cancelled": "cancelled", "venue_moved": "moved", "time_changed": "rescheduled"}


@router.get("/change-reports")
def all_reports(status: str | None = None, user: dict = Depends(admin)) -> list[dict]:
    """Every report, newest first."""
    rows = store.db.where("change_reports", status=status) if status else store.db.all("change_reports")
    users = {u["id"]: u for u in store.db.all("users")}
    return [records.report_view(r, users) for r in sorted(rows, key=lambda r: r["created_at"], reverse=True)]


@router.patch("/change-reports/{report_id}")
def review_report(report_id: str, body: ReportReviewIn, user: dict = Depends(admin)) -> dict:
    """Verify or reject a pending report. The reporter is told either way."""
    found = store.db.get("change_reports", report_id)
    if found is None:
        raise HTTPException(404, "That report no longer exists.")
    entry = store.db.get("timetable", found["timetable_entry_id"]) if found.get("timetable_entry_id") else None
    is_class_report = found["type"] in CLASS_REPORTS
    if body.decision == "verified" and is_class_report and entry is None:
        raise HTTPException(400, "That class is no longer on the timetable. Reject the report instead.")

    day = found["affected_date"]
    label = records.course_label(entry["course_id"]) if entry else records.room_name(found.get("classroom_id"))
    kind = found["type"].replace("_", " ")
    # The room whose schedule changes; locked so a booking cannot slip in at the same moment
    lock_room = found.get("proposed_classroom_id") or (entry and entry["classroom_id"]) or found.get("classroom_id")

    def work(writes) -> dict:
        r = store.db.get("change_reports", report_id)
        if r["status"] != "pending":
            raise HTTPException(400, "That report has already been handled.")

        if body.decision == "verified" and is_class_report:
            override = {"timetable_entry_id": entry["id"], "session_date": day, "change_report_id": r["id"],
                        "type": OVERRIDE_TYPE[r["type"]], "new_classroom_id": None,
                        "new_start_time": None, "new_end_time": None}
            if r["type"] == "venue_moved":
                hits = schedule.find_clashes(r["proposed_classroom_id"], day, entry["start_time"], entry["end_time"])
                if hits:
                    raise HTTPException(409, f'{records.room_name(r["proposed_classroom_id"])} is not free then: {hits[0]["label"]}.')
                override["new_classroom_id"] = r["proposed_classroom_id"]
            if r["type"] == "time_changed":
                hits = schedule.find_clashes(entry["classroom_id"], day, r["proposed_start_time"], r["proposed_end_time"],
                                             ignore_entry=entry["id"])
                if hits:
                    raise HTTPException(409, f'{records.room_name(entry["classroom_id"])} is not free at the new time: {hits[0]["label"]}.')
                override["new_start_time"], override["new_end_time"] = r["proposed_start_time"], r["proposed_end_time"]
            # Only one change per class per date: the newest verified report wins
            override_id = f'{entry["id"]}_{day}'
            for old in store.db.where("session_overrides", session_date=day):
                if old["timetable_entry_id"] == entry["id"] and old["id"] != override_id:
                    writes.delete("session_overrides", old["id"])
            writes.set("session_overrides", override_id, override)

        changes = {"status": body.decision, "verified_by": user["id"], "verified_at": store.now_iso()}
        writes.update("change_reports", report_id, changes)
        records.notify(writes, r["reported_by"], f"Report {body.decision}",
                       f'Your "{kind}" report for {label} on {day} was {body.decision}.')
        records.log(writes, user, f'{body.decision.capitalize()} a "{kind}" report for {label}')
        return {**r, **changes}

    row = store.db.locked(f"{lock_room}_{day}", work)

    # Tell everyone on the course (students and reps), except the reporter.
    # Done after the lock: a big class could need more writes than one Firestore transaction allows.
    if body.decision == "verified" and is_class_report:
        what = {"class_cancelled": "is cancelled",
                "venue_moved": f'has moved to {records.room_name(row["proposed_classroom_id"])}',
                "time_changed": f'is now {row["proposed_start_time"]} – {row["proposed_end_time"]}'}[row["type"]]
        for person in store.db.all("users"):
            if (person.get("is_active", True) and person["id"] != row["reported_by"]
                    and entry["course_id"] in person.get("course_ids", [])):
                records.notify(store.db, person["id"], "Class change", f"{label} on {day} {what}.")

    return records.report_view(row)
