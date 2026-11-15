"""
ADMIN MODULES 2 and 3 — classrooms, buildings and facilities.
    GET    /api/admin/classrooms              (includes disabled rooms)
    POST   /api/admin/classrooms
    PUT    /api/admin/classrooms/{room_id}
    DELETE /api/admin/classrooms/{room_id}
    GET    /api/admin/buildings               (with the number of rooms in each)
    POST   /api/admin/buildings
    PUT    /api/admin/buildings/{building_id}
    DELETE /api/admin/buildings/{building_id}
    POST   /api/admin/facilities
    PUT    /api/admin/facilities/{facility_id}
    DELETE /api/admin/facilities/{facility_id}
"""
from fastapi import APIRouter, Depends, HTTPException

from app import store
from app.auth import require_role
from app.schemas import BuildingIn, ClassroomIn, FacilityIn
from app.services import records, schedule

router = APIRouter(prefix="/admin", tags=["Rooms and buildings (admin)"])
admin = require_role("admin")


def must_exist(collection: str, doc_id: str, what: str) -> dict:
    found = store.db.get(collection, doc_id)
    if found is None:
        raise HTTPException(404, f"That {what} no longer exists.")
    return found


# ---------- classrooms ----------
@router.get("/classrooms")
def list_classrooms(user: dict = Depends(admin)) -> list[dict]:
    rooms = sorted(store.db.lookup("classrooms"), key=lambda r: (r.get("sort_order", 0), r["name"]))
    return [schedule.room_view(r) for r in rooms]


def classroom_fields(body: ClassroomIn, room_id: str | None) -> dict:
    name = " ".join(body.name.split())
    if not name:
        raise HTTPException(400, "Enter the room name.")
    if store.db.get("buildings", body.building_id) is None:
        raise HTTPException(400, "Choose a building.")
    rooms = store.db.lookup("classrooms")
    if any(r["name"].lower() == name.lower() and r["id"] != room_id for r in rooms):
        raise HTTPException(409, "Another room already has that name.")
    facilities = {f["id"] for f in store.db.lookup("facilities")}
    return {"name": name, "building_id": body.building_id, "capacity": body.capacity,
            "floor": (body.floor or "").strip() or None,
            "facility_ids": [f for f in dict.fromkeys(body.facility_ids) if f in facilities],
            "is_active": body.is_active}


@router.post("/classrooms", status_code=201)
def create_classroom(body: ClassroomIn, user: dict = Depends(admin)) -> dict:
    fields = classroom_fields(body, None)
    fields["sort_order"] = max((r.get("sort_order", 0) for r in store.db.lookup("classrooms")), default=0) + 1
    room_id = records.new_id("classrooms", fields["name"])
    store.db.set("classrooms", room_id, fields)
    records.log(store.db, user, f'Added room {fields["name"]}')
    return schedule.room_view({**fields, "id": room_id})


@router.put("/classrooms/{room_id}")
def update_classroom(room_id: str, body: ClassroomIn, user: dict = Depends(admin)) -> dict:
    found = must_exist("classrooms", room_id, "room")
    fields = classroom_fields(body, room_id)
    store.db.update("classrooms", room_id, fields)
    records.log(store.db, user, f'Updated room {fields["name"]}')
    return schedule.room_view({**found, **fields})


@router.delete("/classrooms/{room_id}", status_code=204)
def delete_classroom(room_id: str, user: dict = Depends(admin)) -> None:
    room = must_exist("classrooms", room_id, "room")
    if store.db.where("timetable", classroom_id=room_id):
        raise HTTPException(400, f'{room["name"]} has classes on the timetable. Move them first, or disable the room instead.')
    if store.db.where("reservations", classroom_id=room_id):
        raise HTTPException(400, f'{room["name"]} has reservations on record. Disable the room instead.')
    store.db.delete("classrooms", room_id)
    records.log(store.db, user, f'Removed room {room["name"]}')


# ---------- buildings ----------
@router.get("/buildings")
def list_buildings(user: dict = Depends(admin)) -> list[dict]:
    rooms = store.db.lookup("classrooms")
    buildings = sorted(store.db.lookup("buildings"), key=lambda b: (b.get("sort_order", 0), b["name"]))
    return [{**b, "rooms": sum(1 for r in rooms if r["building_id"] == b["id"])} for b in buildings]


def building_fields(body: BuildingIn, building_id: str | None) -> dict:
    name, code = " ".join(body.name.split()), " ".join(body.code.split())
    if not name:
        raise HTTPException(400, "Enter the building name.")
    if not code:
        raise HTTPException(400, "Enter a short code, e.g. NLT.")
    if any(b["code"].lower() == code.lower() and b["id"] != building_id for b in store.db.lookup("buildings")):
        raise HTTPException(409, "Another building already uses that code.")
    return {"name": name, "code": code}


@router.post("/buildings", status_code=201)
def create_building(body: BuildingIn, user: dict = Depends(admin)) -> dict:
    fields = building_fields(body, None)
    fields["sort_order"] = max((b.get("sort_order", 0) for b in store.db.lookup("buildings")), default=0) + 1
    building_id = records.new_id("buildings", fields["code"])
    store.db.set("buildings", building_id, fields)
    records.log(store.db, user, f'Added building {fields["name"]}')
    return {**fields, "id": building_id, "rooms": 0}


@router.put("/buildings/{building_id}")
def update_building(building_id: str, body: BuildingIn, user: dict = Depends(admin)) -> dict:
    found = must_exist("buildings", building_id, "building")
    fields = building_fields(body, building_id)
    store.db.update("buildings", building_id, fields)
    records.log(store.db, user, f'Updated building {fields["name"]}')
    return {**found, **fields}


@router.delete("/buildings/{building_id}", status_code=204)
def delete_building(building_id: str, user: dict = Depends(admin)) -> None:
    building = must_exist("buildings", building_id, "building")
    n = sum(1 for r in store.db.lookup("classrooms") if r["building_id"] == building_id)
    if n:
        raise HTTPException(400, f'{building["name"]} still has {n} room{"" if n == 1 else "s"}. Remove or move them first.')
    store.db.delete("buildings", building_id)
    records.log(store.db, user, f'Removed building {building["name"]}')


# ---------- facilities ----------
def facility_name(body: FacilityIn, facility_id: str | None) -> str:
    name = " ".join(body.name.split())
    if not name:
        raise HTTPException(400, "Enter the facility name.")
    if any(f["name"].lower() == name.lower() and f["id"] != facility_id for f in store.db.lookup("facilities")):
        raise HTTPException(409, "That facility is already on the list.")
    return name


@router.post("/facilities", status_code=201)
def create_facility(body: FacilityIn, user: dict = Depends(admin)) -> dict:
    name = facility_name(body, None)
    facility_id = records.new_id("facilities", name)
    store.db.set("facilities", facility_id, {"name": name})
    records.log(store.db, user, f"Added facility {name}")
    return {"id": facility_id, "name": name}


@router.put("/facilities/{facility_id}")
def rename_facility(facility_id: str, body: FacilityIn, user: dict = Depends(admin)) -> dict:
    must_exist("facilities", facility_id, "facility")
    name = facility_name(body, facility_id)
    store.db.update("facilities", facility_id, {"name": name})
    records.log(store.db, user, f"Renamed a facility to {name}")
    return {"id": facility_id, "name": name}


@router.delete("/facilities/{facility_id}", status_code=204)
def delete_facility(facility_id: str, user: dict = Depends(admin)) -> None:
    """Remove a facility, and take it off every room that had it."""
    facility = must_exist("facilities", facility_id, "facility")
    for room in store.db.lookup("classrooms"):
        if facility_id in room.get("facility_ids", []):
            store.db.update("classrooms", room["id"],
                            {"facility_ids": [f for f in room["facility_ids"] if f != facility_id]})
    store.db.delete("facilities", facility_id)
    records.log(store.db, user, f'Removed facility {facility["name"]}')
