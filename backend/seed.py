"""
Fill Firestore with the starting data, and make your account the administrator.

Run it once from the classcast-backend folder:

    python seed.py

It asks for the email of the user you added in Firebase Authentication.
Running it again is safe, but it resets the buildings, rooms, facilities,
courses and timetable below back to these values.
"""
import sys

from firebase_admin import auth

from app import store

BUILDINGS = [      # id, code, name, number of rooms, seats per room (PLACEHOLDER seat counts)
    ("nlt", "NLT", "New Lecture Theatre", 19, 150),
    ("lt", "LT", "Lecture Theatre", 21, 120),
    ("swlt", "SWLT", "Sandwich Lecture Theatre", 18, 100),
    ("calc", "CALC", "C. A. Ackah Lecture Theatre Complex", 11, 200),
    ("g-block", "G Block", "Science G Block", 25, 60),
]
FACILITIES = [("projector", "Projector"), ("pa-system", "PA system"), ("air-conditioning", "Air conditioning"),
              ("whiteboard", "Whiteboard"), ("computers", "Computers")]
COURSES = [("csc-301", "CSC 301", "Operating Systems"), ("csc-305", "CSC 305", "Software Engineering"),
           ("mat-204", "MAT 204", "Linear Algebra"), ("phy-202", "PHY 202", "Electronics"),
           ("sta-201", "STA 201", "Statistics")]
TIMETABLE = [      # course, room, day (1 = Monday), start, end   — SAMPLE classes
    ("csc-301", "nlt-1", 1, "08:00", "10:00"), ("mat-204", "nlt-1", 1, "14:00", "16:00"),
    ("csc-305", "calc-2", 2, "10:00", "12:00"), ("phy-202", "calc-2", 1, "10:00", "12:00"),
    ("sta-201", "swlt-5", 1, "10:00", "12:00"), ("csc-301", "g-block-1", 3, "13:00", "15:00"),
    ("csc-305", "lt-3", 4, "08:00", "10:00"), ("mat-204", "swlt-5", 3, "08:00", "10:00"),
    ("phy-202", "g-block-12", 2, "13:00", "15:00"), ("sta-201", "nlt-1", 5, "10:00", "12:00"),
    ("csc-305", "nlt-1", 3, "10:00", "12:00"), ("csc-301", "calc-2", 4, "14:00", "16:00"),
    ("sta-201", "lt-3", 2, "08:00", "10:00"), ("mat-204", "g-block-12", 5, "08:00", "10:00"),
    ("phy-202", "lt-3", 1, "12:00", "14:00"),
]


def build_documents() -> dict[str, dict[str, dict]]:
    """Returns {collection: {document id: fields}} for everything to be written."""
    docs = {"buildings": {}, "facilities": {}, "classrooms": {}, "courses": {}, "timetable": {}}
    order = 0
    for position, (bid, code, name, rooms, seats) in enumerate(BUILDINGS, start=1):
        docs["buildings"][bid] = {"code": code, "name": name, "sort_order": position}
        for n in range(1, rooms + 1):
            order += 1
            docs["classrooms"][f"{bid}-{n}"] = {
                "building_id": bid, "name": f"{code} {n}", "floor": None, "capacity": seats,
                "facility_ids": ["whiteboard"], "is_active": True, "sort_order": order}
    for fid, name in FACILITIES:
        docs["facilities"][fid] = {"name": name}
    for cid, code, title in COURSES:
        docs["courses"][cid] = {"code": code, "title": title}
    for i, (course, room, day, start, end) in enumerate(TIMETABLE, start=1):
        docs["timetable"][f"class-{i:02d}"] = {
            "course_id": course, "classroom_id": room, "day_of_week": day,
            "start_time": start, "end_time": end, "lecturer_name": None}
    return docs


def write_documents(docs: dict) -> None:
    client = store.db.client
    for collection, items in docs.items():
        batch, pending = client.batch(), 0
        for doc_id, fields in items.items():
            batch.set(client.collection(collection).document(doc_id), fields)
            pending += 1
            if pending == 400:                       # Firestore allows at most 500 writes per batch
                batch.commit(); batch, pending = client.batch(), 0
        if pending:
            batch.commit()
        print(f"  {collection}: {len(items)} documents")


def add_account(email: str, full_name: str, role: str, course_ids: list[str], password: str | None = None) -> None:
    """Give a Firebase login a ClassCast account (creating the login first if a password is given)."""
    try:
        login = auth.get_user_by_email(email, app=store.firebase_app())
    except auth.UserNotFoundError:
        if not password:
            sys.exit(f'\nNo user with the email "{email}" exists in Firebase Authentication.\n'
                     "Add it in the console (Security → Authentication → Add user), then run this again.")
        login = auth.create_user(email=email, password=password, display_name=full_name, app=store.firebase_app())
    store.db.client.collection("users").document(login.uid).set({
        "full_name": full_name, "email": email, "role": role, "index_number": "",
        "course_ids": course_ids, "is_active": True})
    print(f"  {email} is now a ClassCast {role.replace('_', ' ')}")


def main() -> None:
    print("ClassCast seed\n")
    print("1. Loading buildings, rooms, facilities, courses and the sample timetable ...")
    write_documents(build_documents())

    print("\n2. Administrator")
    email = input("   Email of the user you added in Firebase Authentication: ").strip()
    name = input("   Their full name: ").strip() or "Administrator"
    add_account(email, name, "admin", [])

    print("\n3. Demo course rep (press Enter to skip)")
    rep_email = input("   Email for a test course rep, e.g. rep@classcast.test: ").strip()
    if rep_email:
        rep_password = input("   Password for it (at least 6 characters): ").strip()
        if len(rep_password) < 6:
            sys.exit("   Password too short. Run the script again.")
        add_account(rep_email, "Kofi Boateng", "course_rep", ["csc-301", "csc-305"], rep_password)

    print("\nDone. Start the server with:  uvicorn app.main:app --reload")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as problem:        # e.g. the key file is missing
        sys.exit(f"\n{problem}")
