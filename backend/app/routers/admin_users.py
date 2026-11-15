"""
ADMIN MODULE 1 — student, course rep and administrator accounts.
    GET    /api/admin/users
    POST   /api/admin/users
    PUT    /api/admin/users/{user_id}
    PATCH  /api/admin/users/{user_id}/active
    DELETE /api/admin/users/{user_id}

Each account is a Firebase login (email + password, see app/logins.py) plus a
document in "users" with the same id, holding the name, role and courses.
"""
import re

from fastapi import APIRouter, Depends, HTTPException

from app import logins, store
from app.auth import require_role
from app.schemas import ActiveIn, UserIn
from app.services import records

router = APIRouter(prefix="/admin", tags=["Accounts (admin)"])
admin = require_role("admin")

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def clean(body: UserIn, user_id: str | None) -> dict:
    """Check the form and return the fields to save."""
    name, email = body.full_name.strip(), body.email.strip().lower()
    if not name:
        raise HTTPException(400, "Enter the full name.")
    if not EMAIL.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    if any(u["id"] != user_id for u in store.db.where("users", email=email)):
        raise HTTPException(409, "Another account already uses that email.")
    if body.password is not None and body.password != "" and len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters.")
    courses = {c["id"] for c in store.db.lookup("courses")}
    course_ids = [] if body.role == "admin" else list(dict.fromkeys(body.course_ids))
    unknown = [c for c in course_ids if c not in courses]
    if unknown:
        raise HTTPException(400, f"Unknown course: {unknown[0]}")
    return {"full_name": name, "email": email, "role": body.role,
            "index_number": body.index_number.strip(), "course_ids": course_ids}


def existing(user_id: str) -> dict:
    found = store.db.get("users", user_id)
    if found is None:
        raise HTTPException(404, "That account no longer exists.")
    return found


@router.get("/users")
def list_users(user: dict = Depends(admin)) -> list[dict]:
    """Every account, by name."""
    return [records.user_view(u) for u in sorted(store.db.all("users"), key=lambda u: u["full_name"].lower())]


@router.post("/users", status_code=201)
def create_user(body: UserIn, user: dict = Depends(admin)) -> dict:
    """Create the login and the account. If the email already has a Firebase login, it is linked."""
    fields = clean(body, None)
    if not body.password:
        raise HTTPException(400, "Set a password of at least 6 characters.")
    uid = logins.create(fields["email"], body.password, fields["full_name"])
    if store.db.get("users", uid) is not None:
        raise HTTPException(409, "That login already has a ClassCast account.")
    row = {**fields, "is_active": True}
    store.db.set("users", uid, row)
    records.log(store.db, user, f'Created a {body.role.replace("_", " ")} account for {fields["full_name"]}')
    return records.user_view({**row, "id": uid})


@router.put("/users/{user_id}")
def update_user(user_id: str, body: UserIn, user: dict = Depends(admin)) -> dict:
    """Change an account. Leave the password empty to keep it."""
    found = existing(user_id)
    fields = clean(body, user_id)
    if user_id == user["id"] and body.role != "admin":
        raise HTTPException(400, "You cannot remove your own administrator role.")
    logins.update(user_id, email=fields["email"] if fields["email"] != found.get("email") else None,
                  password=body.password or None, display_name=fields["full_name"])
    store.db.update("users", user_id, fields)
    records.log(store.db, user, f'Updated the account of {fields["full_name"]}')
    return records.user_view({**found, **fields})


@router.patch("/users/{user_id}/active")
def set_active(user_id: str, body: ActiveIn, user: dict = Depends(admin)) -> dict:
    """Disable or enable an account. A disabled person cannot sign in."""
    found = existing(user_id)
    if user_id == user["id"]:
        raise HTTPException(400, "You cannot disable your own account.")
    logins.update(user_id, disabled=not body.is_active)
    store.db.update("users", user_id, {"is_active": body.is_active})
    records.log(store.db, user, f'{"Enabled" if body.is_active else "Disabled"} the account of {found["full_name"]}')
    return records.user_view({**found, "is_active": body.is_active})


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: str, user: dict = Depends(admin)) -> None:
    """Remove an account and its login. Refused if the person has reservations or reports on record."""
    found = existing(user_id)
    if user_id == user["id"]:
        raise HTTPException(400, "You cannot remove your own account.")
    if store.db.where("reservations", requested_by=user_id) or store.db.where("change_reports", reported_by=user_id):
        raise HTTPException(400, f'{found["full_name"]} has reservations or reports on record. Disable the account instead.')
    for n in store.db.where("notifications", user_id=user_id):
        store.db.delete("notifications", n["id"])
    store.db.delete("users", user_id)
    logins.delete(user_id)
    records.log(store.db, user, f'Removed the account of {found["full_name"]}')
