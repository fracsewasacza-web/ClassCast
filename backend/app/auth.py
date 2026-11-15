"""
Who is calling? Every request must carry the Firebase login token:

    Authorization: Bearer <token>

current_user() checks the token with Firebase, then loads that person's
document from the "users" collection, which holds their role.

Use in an endpoint:

    def my_endpoint(user: dict = Depends(current_user)):           # any signed-in user
    def my_endpoint(user: dict = Depends(require_role("admin"))):  # administrators only
"""
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import auth as firebase_auth

from app import store

bearer = HTTPBearer(auto_error=False)     # also adds the "Authorize" button on /docs


def current_user(token: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if token is None:
        raise HTTPException(401, "Log in first.")
    firebase = store.firebase_app()          # fails loudly if the key file is missing
    try:
        decoded = firebase_auth.verify_id_token(token.credentials, app=firebase)
    except Exception:
        raise HTTPException(401, "Your login has expired. Log in again.")

    user = store.db.get("users", decoded["uid"])
    if user is None:
        raise HTTPException(403, "This login has no ClassCast account. Ask the administrator to add you.")
    if not user.get("is_active", True):
        raise HTTPException(403, "This account has been disabled. Contact the administrator.")
    return user


def require_role(*roles: str):
    """A dependency that only lets the given roles through."""
    def check(user: dict = Depends(current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(403, "You are not allowed to do that.")
        return user
    return check
