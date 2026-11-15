"""Shared test setup: an in-memory database loaded with the seed data, and fake logins."""
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app import logins, store
from app.auth import current_user
from app.main import app
from seed import build_documents
from tests.fake_store import FakeStore

USERS = {
    "admin-1": {"full_name": "Esi Asante", "email": "admin@classcast.test", "role": "admin", "course_ids": [], "is_active": True},
    "rep-1": {"full_name": "Kofi Boateng", "email": "rep@classcast.test", "role": "course_rep", "course_ids": ["csc-301", "csc-305"], "is_active": True},
    "rep-2": {"full_name": "Abena Osei", "email": "abena@classcast.test", "role": "course_rep", "course_ids": ["mat-204"], "is_active": True},
    "student-1": {"full_name": "Yaw Mensah", "email": "yaw@classcast.test", "role": "student", "course_ids": ["csc-301"], "is_active": True},
}


def next_weekday(weekday: int) -> str:
    """The next date that falls on this weekday (1 = Monday), as text."""
    d = date.today() + timedelta(days=1)
    while d.isoweekday() != weekday:
        d += timedelta(days=1)
    return d.isoformat()


@pytest.fixture
def db(monkeypatch):
    fake = FakeStore({**build_documents(), "users": USERS})
    monkeypatch.setattr(store, "db", fake)
    return fake


class FakeLogins:
    """Stands in for Firebase Authentication: remembers the logins the code would have made."""

    def __init__(self):
        self.accounts: dict[str, dict] = {}

    def create(self, email, password, full_name):
        uid = next((u for u, a in self.accounts.items() if a["email"] == email), None) or f"uid-{len(self.accounts) + 1}"
        self.accounts.setdefault(uid, {"email": email, "disabled": False}).update(password=password)
        return uid

    def update(self, uid, **changes):
        self.accounts.setdefault(uid, {}).update({k: v for k, v in changes.items() if v is not None})

    def delete(self, uid):
        self.accounts.pop(uid, None)


@pytest.fixture(autouse=True)
def fake_logins(monkeypatch):
    fake = FakeLogins()
    for name in ("create", "update", "delete"):
        monkeypatch.setattr(logins, name, getattr(fake, name))
    return fake


@pytest.fixture
def client(db):
    """client.login("rep-1") makes the following requests come from that user."""
    test_client = TestClient(app)

    def login(uid: str):
        app.dependency_overrides[current_user] = lambda: db.get("users", uid)
        return test_client

    test_client.login = login
    yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def monday():
    return next_weekday(1)
