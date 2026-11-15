"""The shape of the data the front end sends. FastAPI rejects anything that doesn't fit."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

DATE = r"^\d{4}-\d{2}-\d{2}$"                 # 2026-11-16
TIME = r"^([01]\d|2[0-3]):[0-5]\d$"           # 08:00 … 23:59

CLASS_REPORTS = ("class_cancelled", "venue_moved", "time_changed")   # about one class on the timetable
HALL_REPORTS = ("hall_in_use", "hall_free")                         # "the app shows this hall wrongly"


class ReservationIn(BaseModel):
    classroom_id: str
    course_id: str
    reservation_date: str = Field(pattern=DATE)
    start_time: str = Field(pattern=TIME)
    end_time: str = Field(pattern=TIME)
    purpose: str = Field(min_length=1, max_length=200)
    expected_attendance: int = Field(gt=0)


class ReviewIn(BaseModel):
    decision: Literal["approved", "rejected"]
    reason: str | None = Field(default=None, max_length=255)


# ---------- change reports ----------
class ChangeReportIn(BaseModel):
    type: Literal["class_cancelled", "venue_moved", "time_changed", "hall_in_use", "hall_free"]
    timetable_entry_id: str | None = None         # class reports
    classroom_id: str | None = None               # hall reports
    affected_date: str = Field(pattern=DATE)
    proposed_classroom_id: str | None = None      # venue_moved
    proposed_start_time: str | None = Field(default=None, pattern=TIME)   # time_changed
    proposed_end_time: str | None = Field(default=None, pattern=TIME)
    details: str = Field(default="", max_length=500)


class ReportReviewIn(BaseModel):
    decision: Literal["verified", "rejected"]


# ---------- admin: accounts ----------
class UserIn(BaseModel):
    full_name: str = Field(max_length=100)
    email: str = Field(max_length=120)
    role: Literal["student", "course_rep", "admin"]
    index_number: str = Field(default="", max_length=40)
    course_ids: list[str] = []
    password: str | None = Field(default=None, max_length=100)   # required when creating


class ActiveIn(BaseModel):
    is_active: bool


# ---------- admin: rooms, buildings, facilities ----------
class ClassroomIn(BaseModel):
    name: str = Field(max_length=60)
    building_id: str
    capacity: int = Field(gt=0, le=5000)
    floor: str | None = Field(default=None, max_length=60)
    facility_ids: list[str] = []
    is_active: bool = True


class BuildingIn(BaseModel):
    name: str = Field(max_length=100)
    code: str = Field(max_length=12)


class FacilityIn(BaseModel):
    name: str = Field(max_length=60)


# ---------- admin: timetable ----------
class TimetableIn(BaseModel):
    course_id: str
    classroom_id: str
    day_of_week: int = Field(ge=1, le=7)          # 1 = Monday
    start_time: str = Field(pattern=TIME)
    end_time: str = Field(pattern=TIME)
    lecturer_name: str | None = Field(default=None, max_length=100)


class ImportRow(BaseModel):
    """One line of the uploaded CSV, already read by the browser. Checked one by one by the server."""
    model_config = ConfigDict(extra="ignore")
    course_code: str = ""
    course_title: str = ""
    room: str = ""
    day: str = ""
    start: str = ""
    end: str = ""
    lecturer: str = ""


class ImportIn(BaseModel):
    rows: list[ImportRow] = Field(max_length=2000)
    replace: bool = False
