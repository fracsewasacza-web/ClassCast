"""An in-memory stand-in for Firestore, with the same methods as app.store.FirestoreStore.
The tests use it so they run in a second, offline, without touching the real database."""
import copy
import itertools


class FakeStore:
    def __init__(self, data: dict[str, dict[str, dict]] | None = None):
        self.data = copy.deepcopy(data or {})
        self._ids = itertools.count(1)

    def _rows(self, collection):
        return self.data.setdefault(collection, {})

    # reading
    def get(self, collection, doc_id):
        row = self._rows(collection).get(str(doc_id))
        return {**copy.deepcopy(row), "id": str(doc_id)} if row is not None else None

    def all(self, collection):
        return [{**copy.deepcopy(row), "id": doc_id} for doc_id, row in self._rows(collection).items()]

    lookup = all

    def where(self, collection, **equals):
        return [r for r in self.all(collection) if all(r.get(k) == v for k, v in equals.items())]

    def forget(self, collection):
        pass

    # writing
    def add(self, collection, data):
        doc_id = f"auto-{next(self._ids)}"
        self._rows(collection)[doc_id] = copy.deepcopy(data)
        return doc_id

    def set(self, collection, doc_id, data):
        self._rows(collection)[str(doc_id)] = copy.deepcopy(data)

    def update(self, collection, doc_id, changes):
        self._rows(collection)[str(doc_id)].update(copy.deepcopy(changes))

    def delete(self, collection, doc_id):
        self._rows(collection).pop(str(doc_id), None)

    def locked(self, key, work):
        """Like the real one: if work() raises, none of its writes are kept."""
        backup = copy.deepcopy(self.data)
        try:
            return work(self)
        except Exception:
            self.data = backup
            raise
