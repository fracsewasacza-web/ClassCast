# ClassCast backend (Python + FastAPI + Firebase)

Firebase stores the data and handles logins. This Python server applies the
rules: who may do what, and whether a room is free.

## First-time setup (Windows, PyCharm)

1. **Put this project in your backend folder.** Copy everything from this zip into
   `Documents\classcast-backend`, next to your `serviceAccountKey.json`.
   The folder should then contain `app`, `tests`, `seed.py`, `serviceAccountKey.json` and the rest.

2. **Open the folder in PyCharm** (File → Open → `classcast-backend`).
   If PyCharm offers to create a virtual environment from `requirements.txt`, say yes.

3. **Open PyCharm's Terminal** (bottom of the window) and install the packages:

   ```
   pip install -r requirements-dev.txt
   ```

   If `pip` is not recognised, use `py -m pip install -r requirements-dev.txt`.

4. **Create your `.env` file.** Copy `.env.example`, name the copy `.env`, and replace
   `paste-the-apiKey-here` with the `apiKey` value from your `firebaseConfig` block.

5. **Load the starting data and make yourself administrator** (once):

   ```
   python seed.py
   ```

   It asks for the email you added in Firebase Authentication and your name.
   It can also create a test course rep login for you.

6. **Start the server:**

   ```
   uvicorn app.main:app --reload
   ```

   Leave it running. `--reload` restarts it whenever you save a file.

7. **Open http://127.0.0.1:8000/docs** in your browser. Every endpoint is listed there
   and can be tried from the page.

## Trying endpoints on /docs

Almost every endpoint needs a login token.

1. In a second Terminal tab run `python get_token.py` and sign in with a Firebase email and password.
2. Copy the long token it prints.
3. On `/docs`, click **Authorize**, paste the token, click Authorize.
4. Open an endpoint, click **Try it out**, fill in the fields, click **Execute**.

Good first tries: `GET /api/me`, then `GET /api/rooms/search` with a date like
`2026-11-16`, start `08:00`, end `10:00`.

Tokens last one hour. An administrator token cannot book rooms and a course rep
token cannot approve them; that is the role check working.

## Running the tests

```
pytest
```

The tests use an in-memory database (`tests/fake_store.py`), so they need no
internet and never touch your real Firestore.

## Folder structure

```
classcast-backend/
├── serviceAccountKey.json     YOUR private key (never share or commit)
├── .env                       your settings (never commit)
├── seed.py                    loads starting data, creates the admin account
├── get_token.py               gets a login token for testing
├── requirements.txt           packages the server needs
├── requirements-dev.txt       the same, plus the test tools
├── app/
│   ├── main.py                creates the server, plugs in the routers
│   ├── config.py              reads .env
│   ├── store.py               THE DATABASE LAYER: all Firestore reads and writes
│   ├── auth.py                checks the login token and the person's role
│   ├── logins.py              creates / changes Firebase logins (Accounts screen)
│   ├── schemas.py             the shape of data the front end sends
│   ├── services/
│   │   ├── schedule.py        the "is this room free?" rules, used everywhere
│   │   └── records.py         alerts, activity log, joined views
│   └── routers/               one file per feature
│       ├── me.py                  who am I, mark alerts read
│       ├── rooms.py               search free rooms, room timetable, clash check
│       ├── reservations.py        course rep: request, list, cancel
│       ├── change_reports.py      course rep: report class changes and hall corrections
│       ├── admin_reservations.py  admin: list, approve, reject
│       ├── admin_change_reports.py admin: verify or reject reports
│       ├── admin_users.py         admin: accounts
│       ├── admin_places.py        admin: rooms, buildings, facilities
│       ├── admin_timetable.py     admin: timetable and CSV upload
│       └── admin_overview.py      admin: badges, usage, activity
└── tests/
```

## Endpoints

| Method | Address | Who | What it does |
|---|---|---|---|
| GET | `/api/health` | anyone | Is the server running |
| GET | `/api/me` | signed in | Name, role and courses |
| GET | `/api/notifications` | signed in | My alerts, newest first |
| GET | `/api/notifications/unread-count` | signed in | Number on the Alerts badge |
| PATCH | `/api/notifications/read-all` | signed in | Mark my alerts as read |
| GET | `/api/lookups` | signed in | Open rooms, buildings, facilities, courses (for drop-downs) |
| GET | `/api/rooms/search` | signed in | Rooms, free or in use for a date and time |
| GET | `/api/rooms/{room_id}` | signed in | One room |
| GET | `/api/rooms/{room_id}/schedule` | signed in | One room's timetable for a date |
| GET | `/api/reservations/check-clash` | signed in | What is in a room during a slot |
| POST | `/api/reservations` | course rep | Request a room (clash checked) |
| GET | `/api/reservations/mine` | course rep | My requests |
| PATCH | `/api/reservations/{id}/cancel` | course rep | Cancel my request |
| GET | `/api/timetable/mine` | course rep | Weekly classes of my courses |
| POST | `/api/change-reports` | course rep | Report a cancelled / moved / rescheduled class, or a hall shown wrongly |
| GET | `/api/change-reports/mine` | course rep | My reports |
| GET | `/api/admin/reservations` | admin | All requests |
| PATCH | `/api/admin/reservations/{id}` | admin | Approve or reject |
| GET | `/api/admin/change-reports` | admin | All reports |
| PATCH | `/api/admin/change-reports/{id}` | admin | Verify (changes that one date's timetable, tells the course) or reject |
| GET, POST | `/api/admin/users` | admin | List accounts / create one (also creates the Firebase login) |
| PUT | `/api/admin/users/{id}` | admin | Edit an account (empty password keeps it) |
| PATCH | `/api/admin/users/{id}/active` | admin | Disable or enable (also blocks the login) |
| DELETE | `/api/admin/users/{id}` | admin | Remove (refused if they have reservations or reports) |
| GET, POST | `/api/admin/classrooms` | admin | All rooms, including disabled / add one |
| PUT, DELETE | `/api/admin/classrooms/{id}` | admin | Edit / remove a room |
| GET, POST | `/api/admin/buildings` | admin | Buildings with room counts / add one |
| PUT, DELETE | `/api/admin/buildings/{id}` | admin | Edit / remove a building |
| POST | `/api/admin/facilities` | admin | Add a facility |
| PUT, DELETE | `/api/admin/facilities/{id}` | admin | Rename / remove (taken off every room) |
| GET, POST | `/api/admin/timetable` | admin | The weekly timetable / add a class |
| PUT, DELETE | `/api/admin/timetable/{id}` | admin | Edit / remove a class |
| POST | `/api/admin/timetable/import` | admin | Upload CSV rows (add to, or replace, the timetable) |
| GET | `/api/admin/pending-counts` | admin | Numbers on the Requests and Reports badges |
| GET | `/api/admin/overview` | admin | Counts, hours in use, recent activity |

Signing in and out happens in the browser with Firebase Authentication, so there is no login endpoint.

## Firestore collections

Dates are text like `2026-11-16`; times are text like `08:00`.

| Collection | Document id | Fields |
|---|---|---|
| `users` | the Firebase login's UID | full_name, email, role (`student` / `course_rep` / `admin`), index_number, course_ids, is_active |
| `buildings` | `nlt`, `lt`, … | code, name, sort_order |
| `classrooms` | `nlt-1`, `calc-7`, … | building_id, name, floor, capacity, facility_ids, is_active, sort_order |
| `facilities` | `projector`, … | name |
| `courses` | `csc-301`, … | code, title |
| `timetable` | `class-01`, … | course_id, classroom_id, day_of_week (1 = Monday), start_time, end_time, lecturer_name |
| `session_overrides` | automatic | timetable_entry_id, session_date, type (`cancelled` / `moved` / `rescheduled`), new_classroom_id, new_start_time, new_end_time |
| `reservations` | automatic | requested_by, classroom_id, course_id, reservation_date, start_time, end_time, purpose, expected_attendance, status, rejection_reason, reviewed_by, reviewed_at, created_at |
| `notifications` | automatic | user_id, title, message, is_read, created_at |
| `activity_logs` | automatic | user_id, user_name, text, created_at |
| `locks` | `<room>_<date>` | used by the server to stop double-booking; ignore |

## How a request is handled

1. The front end sends the request with the person's Firebase token.
2. `auth.py` checks the token with Firebase and loads the person from `users`.
3. The router checks their role and the input.
4. `services/schedule.py` decides whether the room is free.
5. `store.py` writes the result to Firestore.

## How double-booking is prevented

Booking and approving run inside `store.db.locked("<room>_<date>", ...)`. Firestore
lets only one such request for the same room and date finish at a time. The other
is restarted, sees the first booking, and is refused with "That slot is taken".

## Adding a new feature

1. Create `app/routers/your_feature.py` with `router = APIRouter(tags=["..."])`.
2. Write endpoints; use `Depends(current_user)` or `Depends(require_role("admin"))`.
3. Read and write only through `store.db`.
4. Add the router to the list in `app/main.py`.
5. Add tests in `tests/`.

## Keep these private

- `serviceAccountKey.json` and `.env` are listed in `.gitignore`. Check they are
  not in your first commit.
- If the key ever leaks: Firebase console → Settings → Service accounts →
  generate a new key, then delete the old one.
