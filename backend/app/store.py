"""
The database layer. Every read and write to Firestore goes through `store.db`.

Use it like this anywhere in the app:

    from app import store
    room  = store.db.get("classrooms", "nlt-1")              # one document, or None
    rooms = store.db.where("classrooms", building_id="nlt")  # documents matching fields
    new_id = store.db.add("notifications", {...})            # create with an automatic id

Every document comes back as a plain dict with its id added as "id".

Keeping Firestore behind this one small class means the rest of the code never
touches Firebase directly, and the tests can swap `store.db` for an in-memory
version (tests/fake_store.py) so they run without the internet.
"""
import time
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.base_query import FieldFilter

from app import config

CACHE_SECONDS = 60      # how long lookup() remembers a collection


def now_iso() -> str:
    """Current time as text, e.g. 2026-11-14T20:30:00+00:00 (Ghana time is UTC)."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def firebase_app():
    """Connect to Firebase once, using the private key file."""
    if not firebase_admin._apps:
        if not config.FIREBASE_KEY_PATH.exists():
            raise RuntimeError(
                f"Cannot find {config.FIREBASE_KEY_PATH.name}. Put the private key file "
                "from Firebase in the classcast-backend folder (see README.md).")
        firebase_admin.initialize_app(credentials.Certificate(str(config.FIREBASE_KEY_PATH)))
    return firebase_admin.get_app()


def _doc(snapshot) -> dict:
    return {**snapshot.to_dict(), "id": snapshot.id}


class _Writes:
    """Writes made inside store.db.locked(). They are saved together, or not at all."""

    def __init__(self, client, transaction):
        self._client, self._tx = client, transaction

    def add(self, collection: str, data: dict) -> str:
        ref = self._client.collection(collection).document()
        self._tx.set(ref, data)
        return ref.id

    def set(self, collection: str, doc_id: str, data: dict) -> None:
        self._tx.set(self._client.collection(collection).document(str(doc_id)), data)

    def update(self, collection: str, doc_id: str, changes: dict) -> None:
        self._tx.update(self._client.collection(collection).document(str(doc_id)), changes)

    def delete(self, collection: str, doc_id: str) -> None:
        self._tx.delete(self._client.collection(collection).document(str(doc_id)))


class FirestoreStore:
    def __init__(self):
        self._client = None
        self._cache: dict[str, tuple[float, list[dict]]] = {}

    @property
    def client(self):
        if self._client is None:
            self._client = firestore.client(firebase_app())
        return self._client

    # ---------- reading ----------
    def get(self, collection: str, doc_id: str) -> dict | None:
        snapshot = self.client.collection(collection).document(str(doc_id)).get()
        return _doc(snapshot) if snapshot.exists else None

    def all(self, collection: str) -> list[dict]:
        return [_doc(s) for s in self.client.collection(collection).stream()]

    def where(self, collection: str, **equals) -> list[dict]:
        """Documents where every given field equals the given value."""
        query = self.client.collection(collection)
        for field, value in equals.items():
            query = query.where(filter=FieldFilter(field, "==", value))
        return [_doc(s) for s in query.stream()]

    def lookup(self, collection: str) -> list[dict]:
        """Like all(), but remembered for a minute. For lists that rarely change
        (buildings, classrooms, facilities, courses). Saves Firestore's free daily reads."""
        saved = self._cache.get(collection)
        if saved and time.monotonic() - saved[0] < CACHE_SECONDS:
            return saved[1]
        rows = self.all(collection)
        self._cache[collection] = (time.monotonic(), rows)
        return rows

    def forget(self, collection: str) -> None:
        """Call after changing a collection that lookup() caches."""
        self._cache.pop(collection, None)

    # ---------- writing ----------
    def add(self, collection: str, data: dict) -> str:
        ref = self.client.collection(collection).document()
        ref.set(data)
        self.forget(collection)
        return ref.id

    def set(self, collection: str, doc_id: str, data: dict) -> None:
        self.client.collection(collection).document(str(doc_id)).set(data)
        self.forget(collection)

    def update(self, collection: str, doc_id: str, changes: dict) -> None:
        self.client.collection(collection).document(str(doc_id)).update(changes)
        self.forget(collection)

    def delete(self, collection: str, doc_id: str) -> None:
        self.client.collection(collection).document(str(doc_id)).delete()
        self.forget(collection)

    # ---------- one at a time ----------
    def locked(self, key: str, work):
        """
        Run work(writes) so that only ONE request with the same key runs at a time.

        This is what stops double-booking. Two reps booking the same room on the
        same day both use the key "<room>_<date>". Firestore lets the first one
        finish; the second is made to start again, and by then it sees the first
        booking and is refused.

        Inside work(): read with store.db as usual, but WRITE with the `writes`
        object it is given, so everything is saved together or not at all.
        If work() raises an error, nothing is saved.
        """
        lock_ref = self.client.collection("locks").document(key)

        @firestore.transactional
        def run(transaction):
            lock_ref.get(transaction=transaction)                 # take the lock
            result = work(_Writes(self.client, transaction))
            transaction.set(lock_ref, {"updated_at": now_iso()})  # release it, changed
            return result

        return run(self.client.transaction())


db = FirestoreStore()     # the one shared database object
