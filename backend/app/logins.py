"""
Firebase Authentication logins (email + password), kept apart from the "users"
collection, which holds the ClassCast account (name, role, courses).

Only the administrator's Accounts screen changes logins. Keeping the Firebase
calls in this one small file lets the tests swap them for fakes
(see tests/conftest.py), so the tests never create real logins.
"""
from fastapi import HTTPException
from firebase_admin import auth

from app import store


def create(email: str, password: str | None, full_name: str) -> str:
    """Make a login and return its uid. If the email already has a login, reuse it."""
    app = store.firebase_app()
    try:
        return auth.create_user(email=email, password=password, display_name=full_name, app=app).uid
    except auth.EmailAlreadyExistsError:
        uid = auth.get_user_by_email(email, app=app).uid
        if password:
            auth.update_user(uid, password=password, app=app)
        return uid
    except ValueError as problem:                 # e.g. a password Firebase will not accept
        raise HTTPException(400, f"Firebase refused the login: {problem}")


def update(uid: str, **changes) -> None:
    """Change a login's email, password, display_name or disabled flag."""
    changes = {k: v for k, v in changes.items() if v is not None}
    if not changes:
        return
    try:
        auth.update_user(uid, app=store.firebase_app(), **changes)
    except auth.UserNotFoundError:
        pass                                      # account without a login: nothing to change
    except auth.EmailAlreadyExistsError:
        raise HTTPException(409, "Another login already uses that email.")
    except ValueError as problem:
        raise HTTPException(400, f"Firebase refused the change: {problem}")


def delete(uid: str) -> None:
    try:
        auth.delete_user(uid, app=store.firebase_app())
    except auth.UserNotFoundError:
        pass
