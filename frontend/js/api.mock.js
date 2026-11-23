/* =====================================================================
   ClassCast — data layer (MOCK)
   Stands in for the backend. Every function returns a Promise, exactly
   like fetch() would, and has a comment with the endpoint it should call.
   When the backend is ready, replace the function bodies with fetch();
   the screens in js/modules/ will not need to change.

   All data lives in one object (db) saved in the browser, so what the
   admin does (approve, edit a room ...) is seen by the course rep.
   Table and field names match classcast_schema_mssql.sql.
   ===================================================================== */
const API = (() => {
  // ---------- date / time helpers ----------
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => iso(new Date());
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  const dayOfWeek = (s) => ((parse(s).getDay() + 6) % 7) + 1;          // 1 = Monday
  const nextDay = (dow) => { let n = 1; while (dayOfWeek(addDays(n)) !== dow) n++; return addDays(n); };
  const overlaps = (s1, e1, s2, e2) => s1 < e2 && e1 > s2;             // "HH:MM" strings compare fine
  const hours = (start, end) => { const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)); return (m(end) - m(start)) / 60; };
  const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  // =====================================================================
  // SAMPLE DATA — used the first time the app opens (replace with real UCC data)
  // =====================================================================
  function seed() {
    const buildings = [
      { id: 1, code: 'NLT', name: 'New Lecture Theatre' },
      { id: 2, code: 'LT', name: 'Lecture Theatre' },
      { id: 3, code: 'SWLT', name: 'Sandwich Lecture Theatre' },
      { id: 4, code: 'CALC', name: 'C. A. Ackah Lecture Theatre Complex' },
      { id: 5, code: 'G Block', name: 'Science G Block' },
    ];
    const facilities = [
      { id: 1, name: 'Projector' }, { id: 2, name: 'PA system' }, { id: 3, name: 'Air conditioning' },
      { id: 4, name: 'Whiteboard' }, { id: 5, name: 'Computers' },
    ];

    // Rooms: NLT 1 … NLT 19, LT 1 … LT 21, and so on.
    // PLACEHOLDER seat counts and facilities — the admin can edit each room in the app.
    const ROOMS = { NLT: [19, 150], LT: [21, 120], SWLT: [18, 100], CALC: [11, 200], 'G Block': [25, 60] };
    const classrooms = [];
    for (const b of buildings) {
      const [count, capacity] = ROOMS[b.code];
      for (let n = 1; n <= count; n++) {
        classrooms.push({ id: classrooms.length + 1, building_id: b.id, name: `${b.code} ${n}`, floor: null, capacity, facility_ids: [4], is_active: true });
      }
    }
    const room = (name) => classrooms.find((c) => c.name === name).id;

    const courses = [
      { id: 1, code: 'CSC 301', title: 'Operating Systems' },
      { id: 2, code: 'CSC 305', title: 'Software Engineering' },
      { id: 3, code: 'MAT 204', title: 'Linear Algebra' },
      { id: 4, code: 'PHY 202', title: 'Electronics' },
      { id: 5, code: 'STA 201', title: 'Statistics' },
    ];

    // DEMO ACCOUNTS. Passwords are plain text ONLY because this is a mock.
    // The real backend must store a hash (bcrypt / argon2) and never send it to the browser.
    const users = [
      { id: 1, full_name: 'Esi Asante', email: 'admin@classcast.test', password: 'admin123', role: 'admin', index_number: 'STAFF/001', course_ids: [], is_active: true },
      { id: 7, full_name: 'Kofi Boateng', email: 'rep@classcast.test', password: 'rep123', role: 'course_rep', index_number: 'CSC/23/0041', course_ids: [1, 2], is_active: true },
      { id: 8, full_name: 'Abena Osei', email: 'abena@classcast.test', password: 'rep123', role: 'course_rep', index_number: 'MAT/23/0107', course_ids: [3, 5], is_active: true },
      { id: 20, full_name: 'Yaw Mensah', email: 'yaw@classcast.test', password: 'student123', role: 'student', index_number: 'CSC/23/0012', course_ids: [1, 2, 3], is_active: true },
      { id: 21, full_name: 'Akua Darko', email: 'akua@classcast.test', password: 'student123', role: 'student', index_number: 'CSC/23/0058', course_ids: [1, 2], is_active: true },
      { id: 22, full_name: 'Kwame Adjei', email: 'kwame@classcast.test', password: 'student123', role: 'student', index_number: 'PHY/23/0033', course_ids: [3, 4, 5], is_active: false },
    ];

    // Weekly timetable: day_of_week 1 = Monday
    const T = (id, course_id, roomName, day_of_week, start_time, end_time) =>
      ({ id, course_id, classroom_id: room(roomName), day_of_week, start_time, end_time, lecturer_name: null });
    const timetable = [
      T(1, 1, 'NLT 1', 1, '08:00', '10:00'), T(2, 3, 'NLT 1', 1, '14:00', '16:00'), T(3, 2, 'CALC 2', 2, '10:00', '12:00'),
      T(4, 4, 'CALC 2', 1, '10:00', '12:00'), T(5, 5, 'SWLT 5', 1, '10:00', '12:00'), T(6, 1, 'G Block 1', 3, '13:00', '15:00'),
      T(7, 2, 'LT 3', 4, '08:00', '10:00'), T(8, 3, 'SWLT 5', 3, '08:00', '10:00'), T(9, 4, 'G Block 12', 2, '13:00', '15:00'),
      T(10, 5, 'NLT 1', 5, '10:00', '12:00'), T(11, 2, 'NLT 1', 3, '10:00', '12:00'), T(12, 1, 'CALC 2', 4, '14:00', '16:00'),
      T(13, 5, 'LT 3', 2, '08:00', '10:00'), T(14, 3, 'G Block 12', 5, '08:00', '10:00'), T(15, 4, 'LT 3', 1, '12:00', '14:00'),
    ];

    const R = (id, requested_by, roomName, course_id, reservation_date, start_time, end_time, purpose, expected_attendance, status, rejection_reason = null) =>
      ({ id, requested_by, classroom_id: room(roomName), course_id, reservation_date, start_time, end_time, purpose, expected_attendance, status, rejection_reason, reviewed_by: status === 'pending' ? null : 1, created_at: addDays(-2) });
    const reservations = [
      R(1, 7, 'CALC 2', 2, addDays(3), '14:00', '16:00', 'Revision class', 120, 'approved'),
      R(2, 7, 'SWLT 5', 2, addDays(-4), '08:00', '10:00', 'Group presentations', 55, 'rejected', 'Clashes with a timetabled class'),
      R(3, 7, 'G Block 1', 1, addDays(5), '09:00', '11:00', 'Lab practice', 55, 'pending'),
      R(4, 8, 'LT 3', 3, addDays(2), '15:00', '17:00', 'Class test', 100, 'pending'),
      R(5, 8, 'SWLT 2', 5, addDays(4), '09:00', '11:00', 'Tutorial', 60, 'pending'),
    ];

    const stamp = (daysAgo, h) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(h, 15, 0, 0); return d.toISOString(); };
    return {
      nextId: 100,
      session: null,                                  // id of the signed-in user
      users, buildings, facilities, classrooms, courses, timetable, reservations,
      session_overrides: [],
      change_reports: [
        { id: 6, reported_by: 8, type: 'class_cancelled', timetable_entry_id: 2, classroom_id: null, affected_date: nextDay(1),
          proposed_classroom_id: null, proposed_start_time: null, proposed_end_time: null, details: 'Lecturer is travelling.', status: 'pending', created_at: addDays(-1) },
      ],
      notifications: [
        { id: 1, user_id: 7, title: 'Reservation approved', message: 'CALC 2 is confirmed for CSC 305.', is_read: false, created_at: addDays(-1) },
        { id: 2, user_id: 7, title: 'Reservation rejected', message: 'SWLT 5: clashes with a timetabled class.', is_read: true, created_at: addDays(-5) },
      ],
      activity_logs: [
        { id: 1, user_id: 1, text: 'Uploaded the semester timetable (15 classes)', created_at: stamp(6, 9) },
        { id: 2, user_id: 1, text: 'Rejected the SWLT 5 request from Kofi Boateng', created_at: stamp(5, 11) },
        { id: 3, user_id: 1, text: 'Approved the CALC 2 request from Kofi Boateng', created_at: stamp(1, 14) },
      ],
    };
  }

  // ---------- storage ----------
  const KEY = 'classcast_v3';
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage unavailable: keep in memory */ } };

  // Run fn after a short fake network delay. Errors thrown inside become rejected Promises.
  const call = (fn) => new Promise((resolve, reject) => setTimeout(() => {
    try { const out = fn(); save(); resolve(out === undefined ? undefined : structuredClone(out)); } catch (err) { reject(err); }
  }, 100));
  const fail = (msg) => { throw new Error(msg); };

  // ---------- who is signed in ----------
  const byId = (list, id) => list.find((x) => x.id === Number(id));
  const me = () => db.users.find((u) => u.id === db.session && u.is_active) || null;
  // The real server must make this same check on every request
  const need = (...roles) => { const u = me(); if (!u || !roles.includes(u.role)) fail('You are not allowed to do that.'); return u; };
  const pub = (u) => { const { password, ...rest } = u; return { ...rest, courses: u.course_ids.map((id) => byId(db.courses, id)).filter(Boolean) }; };

  const notify = (user_id, title, message) => db.notifications.push({ id: db.nextId++, user_id, title, message, is_read: false, created_at: today() });
  const log = (text) => db.activity_logs.push({ id: db.nextId++, user_id: db.session, text, created_at: new Date().toISOString() });

  // ---------- joins ----------
  const withMap = (b) => ({ ...b, map_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.name}, University of Cape Coast`)}` });
  const roomView = (c) => ({
    ...c,
    building: withMap(byId(db.buildings, c.building_id)),
    facilities: c.facility_ids.map((id) => byId(db.facilities, id)).filter(Boolean).map((f) => f.name),
  });
  const courseLabel = (id) => { const c = byId(db.courses, id); return c ? `${c.code} · ${c.title}` : 'Other'; };
  const roomName = (id) => (byId(db.classrooms, id) || { name: '(removed room)' }).name;

  // Everything occupying a room on a date: timetabled classes (after
  // cancellations / moves) + pending and approved reservations.
  function daySchedule(classroomId, date, { ignoreReservation = null, ignoreEntry = null } = {}) {
    const dow = dayOfWeek(date);
    const blocks = [];
    for (const t of db.timetable) {
      if (t.day_of_week !== dow || t.id === ignoreEntry) continue;
      const o = db.session_overrides.find((x) => x.timetable_entry_id === t.id && x.session_date === date);
      if (o && o.type === 'cancelled') continue;
      const room = (o && o.new_classroom_id) || t.classroom_id;
      if (room !== Number(classroomId)) continue;
      blocks.push({ kind: 'class', start: (o && o.new_start_time) || t.start_time, end: (o && o.new_end_time) || t.end_time, label: courseLabel(t.course_id) });
    }
    for (const r of db.reservations) {
      if (r.id === ignoreReservation || Number(r.classroom_id) !== Number(classroomId) || r.reservation_date !== date) continue;   // the form sends ids as text
      if (r.status !== 'pending' && r.status !== 'approved') continue;
      blocks.push({ kind: 'reservation', start: r.start_time, end: r.end_time, status: r.status, label: `${r.purpose || 'Reservation'} (${r.status})` });
    }
    return blocks.sort((a, b) => a.start.localeCompare(b.start));
  }
  const clashes = (classroomId, date, start, end, opts) => daySchedule(classroomId, date, opts).filter((b) => overlaps(start, end, b.start, b.end));

  const reportView = (r) => {
    const t = r.timetable_entry_id ? byId(db.timetable, r.timetable_entry_id) : null;
    return {
      ...r,
      reporter: (byId(db.users, r.reported_by) || {}).full_name || 'Removed account',
      entry: t,
      course: t ? byId(db.courses, t.course_id) : null,
      classroom: { name: roomName(r.classroom_id || (t && t.classroom_id)) },
      proposed_classroom: r.proposed_classroom_id ? { name: roomName(r.proposed_classroom_id) } : null,
    };
  };
  const reservationView = (r) => ({
    ...r,
    classroom: byId(db.classrooms, r.classroom_id) ? roomView(byId(db.classrooms, r.classroom_id)) : { name: '(removed room)', capacity: 0 },
    course: byId(db.courses, r.course_id) || null,
    requester: (byId(db.users, r.requested_by) || {}).full_name || 'Removed account',
  });

  // =====================================================================
  return {
    today, dayOfWeek,

    // ================= SIGN IN =================
    // POST /api/auth/login
    login: (email, password) => call(() => {
      const u = db.users.find((x) => x.email.toLowerCase() === String(email).trim().toLowerCase());
      if (!u || u.password !== password) fail('Wrong email or password.');
      if (!u.is_active) fail('This account has been disabled. Contact the administrator.');
      if (u.role === 'student') fail('Student accounts cannot sign in yet. Only course reps and administrators can.');
      db.session = u.id;
      log('Signed in');
      return pub(u);
    }),
    // POST /api/auth/logout
    logout: () => call(() => { db.session = null; }),
    // (real app: Firebase reauthenticateWithCredential + updatePassword, no server call)
    changePassword: (current, next) => call(() => {
      const u = me();
      if (!u) fail('Log in first.');
      if (u.password !== current) fail('Your current password is wrong.');
      u.password = next;
      log('Changed their password');
    }),
    // GET /api/me   (null when nobody is signed in)
    getMe: () => call(() => (me() ? pub(me()) : null)),

    // ================= COURSE REP =================
    // GET /api/classrooms , /api/buildings , /api/facilities , /api/courses
    getLookups: () => call(() => ({
      classrooms: db.classrooms.filter((c) => c.is_active).map(roomView),
      buildings: db.buildings, facilities: db.facilities, courses: db.courses,
    })),

    // GET /api/classrooms/search?date=&start=&end=&building=&minCap=&facility=&q=
    searchHalls: ({ date, start, end, building, minCap, facility, q }) => call(() => {
      const text = (q || '').trim().toLowerCase();
      return db.classrooms
        .filter((c) => c.is_active)
        .filter((c) => !building || c.building_id === Number(building))
        .filter((c) => !minCap || c.capacity >= Number(minCap))
        .filter((c) => !facility || c.facility_ids.includes(Number(facility)))
        .map(roomView)
        .filter((c) => !text || `${c.name} ${c.building.name}`.toLowerCase().includes(text))
        .map((c) => {
          const blocks = daySchedule(c.id, date);
          const hit = blocks.filter((b) => overlaps(start, end, b.start, b.end));
          let hint;
          if (!hit.length) {
            const next = blocks.find((b) => b.start >= end);
            hint = next ? `Free until ${next.start}` : 'Free for the rest of the day';
          } else {
            let until = hit.reduce((m, b) => (b.end > m ? b.end : m), '00:00');
            for (const b of blocks) if (b.start <= until && b.end > until) until = b.end;   // back-to-back classes
            hint = `In use: ${hit[0].label}. Free from ${until}`;
          }
          return { ...c, is_free: !hit.length, hint };
        })
        .sort((a, b) => b.is_free - a.is_free || a.id - b.id);
    }),

    // GET /api/classrooms/:id
    getHall: (id) => call(() => roomView(byId(db.classrooms, id) || fail('That room no longer exists.'))),
    // GET /api/classrooms/:id/schedule?date=
    getDaySchedule: (id, date) => call(() => daySchedule(id, date)),
    // GET /api/reservations/check-clash?classroom_id=&date=&start=&end=   (calls sp_check_clash)
    checkClash: (classroomId, date, start, end) => call(() => clashes(classroomId, date, start, end)),

    // POST /api/reservations
    createReservation: (data) => call(() => {
      const u = need('course_rep');
      // The server must repeat the clash check — never trust the browser alone.
      const hit = clashes(data.classroom_id, data.reservation_date, data.start_time, data.end_time);
      if (hit.length) fail(`That slot is taken: ${hit[0].label}`);
      const row = { id: db.nextId++, requested_by: u.id, status: 'pending', rejection_reason: null, reviewed_by: null, created_at: today(), ...data };
      db.reservations.push(row);
      log(`Requested ${roomName(row.classroom_id)} for ${row.reservation_date}`);
      return row;
    }),

    // POST /api/reservations/batch   { reservations: [...] }  — all or nothing
    createReservations: (list) => call(() => {
      const u = need('course_rep');
      list.forEach((data, i) => {
        const hit = clashes(data.classroom_id, data.reservation_date, data.start_time, data.end_time);
        if (hit.length) fail(`Booking ${i + 1}: ${roomName(data.classroom_id)} is taken: ${hit[0].label}`);
        list.slice(0, i).forEach((a, j) => {
          if (String(a.classroom_id) === String(data.classroom_id) && a.reservation_date === data.reservation_date
              && overlaps(a.start_time, a.end_time, data.start_time, data.end_time)) fail(`Booking ${i + 1}: overlaps booking ${j + 1} in the same room.`);
        });
      });
      return list.map((data) => {
        const row = { id: db.nextId++, requested_by: u.id, status: 'pending', rejection_reason: null, reviewed_by: null, created_at: today(), ...data };
        db.reservations.push(row);
        log(`Requested ${roomName(row.classroom_id)} for ${row.reservation_date}`);
        return row;
      });
    }),

    // GET /api/reservations/mine
    listMyReservations: () => call(() => {
      const u = need('course_rep');
      return db.reservations.filter((r) => r.requested_by === u.id).map(reservationView)
        .sort((a, b) => b.reservation_date.localeCompare(a.reservation_date));
    }),

    // PATCH /api/reservations/:id/cancel
    cancelReservation: (id) => call(() => {
      const u = need('course_rep');
      const r = byId(db.reservations, id);
      if (!r || r.requested_by !== u.id) fail('That reservation is not yours.');
      r.status = 'cancelled';
      log(`Cancelled the ${roomName(r.classroom_id)} booking for ${r.reservation_date}`);
      return r;
    }),

    // GET /api/timetable/mine   (classes of the courses this rep represents)
    listMyClasses: () => call(() => {
      const u = need('course_rep');
      return db.timetable.filter((t) => u.course_ids.includes(t.course_id))
        .map((t) => ({ ...t, course: byId(db.courses, t.course_id), classroom: { name: roomName(t.classroom_id) } }));
    }),

    // POST /api/change-reports
    createChangeReport: (data) => call(() => {
      const u = need('course_rep');
      const row = { id: db.nextId++, reported_by: u.id, status: 'pending', created_at: today(), ...data };
      db.change_reports.push(row);
      log(`Sent a "${row.type.replace(/_/g, ' ')}" report`);
      return row;
    }),

    // GET /api/change-reports/mine
    listMyReports: () => call(() => {
      const u = need('course_rep');
      return db.change_reports.filter((r) => r.reported_by === u.id).map(reportView).sort((a, b) => b.id - a.id);
    }),

    // GET /api/notifications
    listNotifications: () => call(() => db.notifications.filter((n) => n.user_id === db.session).sort((a, b) => b.id - a.id)),
    unreadCount: () => call(() => db.notifications.filter((n) => n.user_id === db.session && !n.is_read).length),
    // PATCH /api/notifications/read-all
    markAllRead: () => call(() => { db.notifications.forEach((n) => { if (n.user_id === db.session) n.is_read = true; }); }),

    // ================= ADMIN 1: accounts =================
    // GET /api/admin/users
    listUsers: () => call(() => { need('admin'); return db.users.map(pub); }),

    // POST /api/admin/users   or   PUT /api/admin/users/:id
    saveUser: (data) => call(() => {
      const admin = need('admin');
      const name = (data.full_name || '').trim(), email = (data.email || '').trim().toLowerCase();
      if (!name) fail('Enter the full name.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Enter a valid email address.');
      if (!['student', 'course_rep', 'admin'].includes(data.role)) fail('Choose a role.');
      if (db.users.some((u) => u.email.toLowerCase() === email && u.id !== Number(data.id))) fail('Another account already uses that email.');
      const fields = { full_name: name, email, role: data.role, index_number: (data.index_number || '').trim(),
        course_ids: data.role === 'admin' ? [] : (data.course_ids || []).map(Number) };

      if (data.id) {
        const u = byId(db.users, data.id) || fail('That account no longer exists.');
        if (u.id === admin.id && data.role !== 'admin') fail('You cannot remove your own administrator role.');
        Object.assign(u, fields);
        if (data.password) { if (data.password.length < 6) fail('Password must be at least 6 characters.'); u.password = data.password; }
        log(`Updated the account of ${name}`);
        return pub(u);
      }
      if (!data.password || data.password.length < 6) fail('Set a password of at least 6 characters.');
      const u = { id: db.nextId++, ...fields, password: data.password, is_active: true };
      db.users.push(u);
      log(`Created a ${data.role.replace('_', ' ')} account for ${name}`);
      return pub(u);
    }),

    // PATCH /api/admin/users/:id/active
    setUserActive: (id, active) => call(() => {
      const admin = need('admin');
      const u = byId(db.users, id) || fail('That account no longer exists.');
      if (u.id === admin.id) fail('You cannot disable your own account.');
      u.is_active = Boolean(active);
      log(`${active ? 'Enabled' : 'Disabled'} the account of ${u.full_name}`);
    }),

    // DELETE /api/admin/users/:id
    deleteUser: (id) => call(() => {
      const admin = need('admin');
      const u = byId(db.users, id) || fail('That account no longer exists.');
      if (u.id === admin.id) fail('You cannot remove your own account.');
      if (db.reservations.some((r) => r.requested_by === u.id) || db.change_reports.some((r) => r.reported_by === u.id)) {
        fail(`${u.full_name} has reservations or reports on record. Disable the account instead.`);
      }
      db.users = db.users.filter((x) => x.id !== u.id);
      db.notifications = db.notifications.filter((n) => n.user_id !== u.id);
      log(`Removed the account of ${u.full_name}`);
    }),

    // ================= ADMIN 2: classrooms =================
    // GET /api/admin/classrooms   (includes disabled rooms)
    listClassrooms: () => call(() => { need('admin'); return db.classrooms.map(roomView); }),

    // POST /api/admin/classrooms   or   PUT /api/admin/classrooms/:id
    saveClassroom: (data) => call(() => {
      need('admin');
      const name = (data.name || '').trim();
      if (!name) fail('Enter the room name.');
      if (!byId(db.buildings, data.building_id)) fail('Choose a building.');
      if (!(Number(data.capacity) > 0)) fail('Enter the number of seats.');
      if (db.classrooms.some((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== Number(data.id))) fail('Another room already has that name.');
      const fields = { name, building_id: Number(data.building_id), capacity: Number(data.capacity), floor: (data.floor || '').trim() || null,
        facility_ids: (data.facility_ids || []).map(Number), is_active: Boolean(data.is_active) };
      if (data.id) {
        Object.assign(byId(db.classrooms, data.id) || fail('That room no longer exists.'), fields);
        log(`Updated room ${name}`);
      } else {
        db.classrooms.push({ id: db.nextId++, ...fields });
        log(`Added room ${name}`);
      }
    }),

    // DELETE /api/admin/classrooms/:id
    deleteClassroom: (id) => call(() => {
      need('admin');
      const c = byId(db.classrooms, id) || fail('That room no longer exists.');
      if (db.timetable.some((t) => t.classroom_id === c.id)) fail(`${c.name} has classes on the timetable. Move them first, or disable the room instead.`);
      if (db.reservations.some((r) => r.classroom_id === c.id)) fail(`${c.name} has reservations on record. Disable the room instead.`);
      db.classrooms = db.classrooms.filter((x) => x.id !== c.id);
      log(`Removed room ${c.name}`);
    }),

    // ================= ADMIN 3: buildings and facilities =================
    // GET /api/admin/buildings
    listBuildings: () => call(() => { need('admin'); return db.buildings.map((b) => ({ ...b, rooms: db.classrooms.filter((c) => c.building_id === b.id).length })); }),

    // POST / PUT /api/admin/buildings
    saveBuilding: (data) => call(() => {
      need('admin');
      const name = (data.name || '').trim(), code = (data.code || '').trim();
      if (!name) fail('Enter the building name.');
      if (!code) fail('Enter a short code, e.g. NLT.');
      if (db.buildings.some((b) => b.code.toLowerCase() === code.toLowerCase() && b.id !== Number(data.id))) fail('Another building already uses that code.');
      if (data.id) Object.assign(byId(db.buildings, data.id) || fail('That building no longer exists.'), { name, code });
      else db.buildings.push({ id: db.nextId++, name, code });
      log(`${data.id ? 'Updated' : 'Added'} building ${name}`);
    }),

    // DELETE /api/admin/buildings/:id
    deleteBuilding: (id) => call(() => {
      need('admin');
      const b = byId(db.buildings, id) || fail('That building no longer exists.');
      const n = db.classrooms.filter((c) => c.building_id === b.id).length;
      if (n) fail(`${b.name} still has ${n} room${n === 1 ? '' : 's'}. Remove or move them first.`);
      db.buildings = db.buildings.filter((x) => x.id !== b.id);
      log(`Removed building ${b.name}`);
    }),

    // POST / PUT /api/admin/facilities
    saveFacility: (data) => call(() => {
      need('admin');
      const name = (data.name || '').trim();
      if (!name) fail('Enter the facility name.');
      if (db.facilities.some((f) => f.name.toLowerCase() === name.toLowerCase() && f.id !== Number(data.id))) fail('That facility is already on the list.');
      if (data.id) (byId(db.facilities, data.id) || fail('That facility no longer exists.')).name = name;
      else db.facilities.push({ id: db.nextId++, name });
      log(`${data.id ? 'Renamed a facility to' : 'Added facility'} ${name}`);
    }),

    // DELETE /api/admin/facilities/:id   (also takes it off every room)
    deleteFacility: (id) => call(() => {
      need('admin');
      const f = byId(db.facilities, id) || fail('That facility no longer exists.');
      db.facilities = db.facilities.filter((x) => x.id !== f.id);
      db.classrooms.forEach((c) => { c.facility_ids = c.facility_ids.filter((x) => x !== f.id); });
      log(`Removed facility ${f.name}`);
    }),

    // ================= ADMIN 4: timetable =================
    // GET /api/admin/timetable
    listTimetable: () => call(() => {
      need('admin');
      return db.timetable.map((t) => ({ ...t, course: byId(db.courses, t.course_id), classroom: { name: roomName(t.classroom_id) } }))
        .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time));
    }),

    // POST / PUT /api/admin/timetable
    saveTimetableEntry: (data) => call(() => {
      need('admin');
      const e = { course_id: Number(data.course_id), classroom_id: Number(data.classroom_id), day_of_week: Number(data.day_of_week),
        start_time: data.start_time, end_time: data.end_time, lecturer_name: (data.lecturer_name || '').trim() || null };
      if (!byId(db.courses, e.course_id)) fail('Choose a course.');
      if (!byId(db.classrooms, e.classroom_id)) fail('Choose a room.');
      if (!e.start_time || !e.end_time || e.end_time <= e.start_time) fail('End time must be after the start time.');
      const hit = db.timetable.find((t) => t.id !== Number(data.id) && t.classroom_id === e.classroom_id && t.day_of_week === e.day_of_week
        && overlaps(e.start_time, e.end_time, t.start_time, t.end_time));
      if (hit) fail(`${roomName(e.classroom_id)} already has ${courseLabel(hit.course_id)} at that time on ${DAY_NAMES[e.day_of_week]}s.`);
      if (data.id) Object.assign(byId(db.timetable, data.id) || fail('That class no longer exists.'), e);
      else db.timetable.push({ id: db.nextId++, ...e });
      log(`${data.id ? 'Updated' : 'Added'} ${courseLabel(e.course_id)} on the timetable`);
    }),

    // DELETE /api/admin/timetable/:id
    deleteTimetableEntry: (id) => call(() => {
      need('admin');
      const t = byId(db.timetable, id) || fail('That class no longer exists.');
      db.timetable = db.timetable.filter((x) => x.id !== t.id);
      db.session_overrides = db.session_overrides.filter((o) => o.timetable_entry_id !== t.id);
      log(`Removed ${courseLabel(t.course_id)} (${DAY_NAMES[t.day_of_week]}) from the timetable`);
    }),

    // POST /api/admin/timetable/import
    // rows: [{ course_code, course_title, room, day, start, end, lecturer }]  (already read from the CSV file)
    // Good rows are imported; bad rows are skipped and reported back with the reason.
    importTimetable: ({ rows, replace }) => call(() => {
      need('admin');
      const staged = replace ? [] : db.timetable.map((t) => ({ ...t }));
      const newCourses = [], skipped = [];
      let imported = 0, nextId = db.nextId;
      const clock = (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim()); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? `${pad(m[1])}:${m[2]}` : null; };
      const dayNo = (v) => { const s = String(v || '').trim().toLowerCase(); if (/^[1-7]$/.test(s)) return Number(s);
        const i = DAY_NAMES.findIndex((d) => d && s.length >= 3 && d.toLowerCase().startsWith(s)); return i > 0 ? i : null; };

      rows.forEach((r, i) => {
        const line = i + 2;                                        // line 1 of the file is the header
        const skip = (reason) => skipped.push({ line, reason });
        const code = String(r.course_code || '').trim().replace(/\s+/g, ' ').toUpperCase();
        if (!code) return skip('No course code');
        const room = db.classrooms.find((c) => c.name.toLowerCase() === String(r.room || '').trim().toLowerCase());
        if (!room) return skip(`Room "${r.room || ''}" does not exist`);
        const day = dayNo(r.day); if (!day) return skip(`Day "${r.day || ''}" is not valid`);
        const start = clock(r.start), end = clock(r.end);
        if (!start || !end) return skip('Times must look like 08:00');
        if (end <= start) return skip('End time is not after the start time');
        const hit = staged.find((t) => t.classroom_id === room.id && t.day_of_week === day && overlaps(start, end, t.start_time, t.end_time));
        if (hit) return skip(`${room.name} is already taken at that time on ${DAY_NAMES[day]}`);

        let course = [...db.courses, ...newCourses].find((c) => c.code.toUpperCase() === code);
        if (!course) { course = { id: nextId++, code, title: String(r.course_title || '').trim() || code }; newCourses.push(course); }
        staged.push({ id: nextId++, course_id: course.id, classroom_id: room.id, day_of_week: day, start_time: start, end_time: end, lecturer_name: String(r.lecturer || '').trim() || null });
        imported++;
      });

      if (imported) {                                              // nothing is changed if every row failed
        db.timetable = staged; db.courses.push(...newCourses); db.nextId = nextId;
        if (replace) db.session_overrides = [];
        log(`Uploaded a timetable: ${imported} classes ${replace ? 'replaced the old timetable' : 'added'}${skipped.length ? `, ${skipped.length} rows skipped` : ''}`);
      }
      return { imported, skipped };
    }),

    // ================= ADMIN 5: reservation requests =================
    // GET /api/admin/reservations
    listAllReservations: () => call(() => {
      need('admin');
      return db.reservations.map((r) => ({
        ...reservationView(r),
        // Has something else taken the slot since the request was made?
        clashes: r.status === 'pending' ? clashes(r.classroom_id, r.reservation_date, r.start_time, r.end_time, { ignoreReservation: r.id }) : [],
      })).sort((a, b) => a.reservation_date.localeCompare(b.reservation_date));
    }),

    // PATCH /api/admin/reservations/:id   { decision: 'approved' | 'rejected', reason }
    reviewReservation: (id, decision, reason) => call(() => {
      const admin = need('admin');
      const r = byId(db.reservations, id) || fail('That request no longer exists.');
      if (r.status !== 'pending') fail('That request has already been handled.');
      const where = `${roomName(r.classroom_id)} on ${r.reservation_date}`;
      if (decision === 'approved') {
        const hit = clashes(r.classroom_id, r.reservation_date, r.start_time, r.end_time, { ignoreReservation: r.id });
        if (hit.length) fail(`Cannot approve: the slot is now taken by ${hit[0].label}.`);
        r.status = 'approved';
        notify(r.requested_by, 'Reservation approved', `${where} is confirmed.`);
      } else {
        if (!(reason || '').trim()) fail('Give a reason so the course rep knows why.');
        r.status = 'rejected'; r.rejection_reason = reason.trim();
        notify(r.requested_by, 'Reservation rejected', `${where}: ${r.rejection_reason}`);
      }
      r.reviewed_by = admin.id; r.reviewed_at = new Date().toISOString();
      log(`${decision === 'approved' ? 'Approved' : 'Rejected'} the ${roomName(r.classroom_id)} request from ${(byId(db.users, r.requested_by) || {}).full_name || 'a removed account'}`);
    }),

    // ================= ADMIN 6: reported changes =================
    // GET /api/admin/change-reports
    listAllReports: () => call(() => { need('admin'); return db.change_reports.map(reportView).sort((a, b) => b.id - a.id); }),

    // PATCH /api/admin/change-reports/:id   { decision: 'verified' | 'rejected' }
    // Verifying a class report changes the timetable for that one date (session_overrides).
    reviewReport: (id, decision) => call(() => {
      const admin = need('admin');
      const r = byId(db.change_reports, id) || fail('That report no longer exists.');
      if (r.status !== 'pending') fail('That report has already been handled.');
      const t = r.timetable_entry_id ? byId(db.timetable, r.timetable_entry_id) : null;
      const label = t ? courseLabel(t.course_id) : roomName(r.classroom_id);

      if (decision === 'verified' && r.timetable_entry_id) {
        if (!t) fail('That class is no longer on the timetable. Reject the report instead.');
        const o = { id: db.nextId++, timetable_entry_id: t.id, session_date: r.affected_date, change_report_id: r.id,
          type: 'cancelled', new_classroom_id: null, new_start_time: null, new_end_time: null };
        if (r.type === 'venue_moved') {
          const hit = clashes(r.proposed_classroom_id, r.affected_date, t.start_time, t.end_time);
          if (hit.length) fail(`${roomName(r.proposed_classroom_id)} is not free then: ${hit[0].label}.`);
          Object.assign(o, { type: 'moved', new_classroom_id: r.proposed_classroom_id });
        }
        if (r.type === 'time_changed') {
          const hit = clashes(t.classroom_id, r.affected_date, r.proposed_start_time, r.proposed_end_time, { ignoreEntry: t.id });
          if (hit.length) fail(`${roomName(t.classroom_id)} is not free at the new time: ${hit[0].label}.`);
          Object.assign(o, { type: 'rescheduled', new_start_time: r.proposed_start_time, new_end_time: r.proposed_end_time });
        }
        db.session_overrides = db.session_overrides.filter((x) => !(x.timetable_entry_id === t.id && x.session_date === r.affected_date));
        db.session_overrides.push(o);

        // Tell everyone on the course (students and reps), except the reporter
        const what = { class_cancelled: 'is cancelled', venue_moved: `has moved to ${roomName(r.proposed_classroom_id)}`,
          time_changed: `is now ${r.proposed_start_time} – ${r.proposed_end_time}` }[r.type];
        db.users.filter((u) => u.is_active && u.id !== r.reported_by && u.course_ids.includes(t.course_id))
          .forEach((u) => notify(u.id, 'Class change', `${label} on ${r.affected_date} ${what}.`));
      }

      r.status = decision === 'verified' ? 'verified' : 'rejected';
      r.verified_by = admin.id; r.verified_at = new Date().toISOString();
      notify(r.reported_by, `Report ${r.status}`, `Your "${r.type.replace(/_/g, ' ')}" report for ${label} on ${r.affected_date} was ${r.status}.`);
      log(`${decision === 'verified' ? 'Verified' : 'Rejected'} a "${r.type.replace(/_/g, ' ')}" report for ${label}`);
    }),

    // ================= ADMIN 7: usage and activity =================
    // GET /api/admin/pending-counts   (numbers on the nav badges)
    pendingCounts: () => call(() => ({
      requests: db.reservations.filter((r) => r.status === 'pending').length,
      reports: db.change_reports.filter((r) => r.status === 'pending').length,
    })),

    // GET /api/admin/overview
    getOverview: () => call(() => {
      need('admin');
      const classHours = (roomId) => db.timetable.filter((t) => t.classroom_id === roomId).reduce((s, t) => s + hours(t.start_time, t.end_time), 0);
      const bookedHours = (roomId) => db.reservations.filter((r) => r.classroom_id === roomId && r.status === 'approved').reduce((s, r) => s + hours(r.start_time, r.end_time), 0);
      const rooms = db.classrooms.map((c) => ({ id: c.id, name: c.name, building_id: c.building_id, class_hours: classHours(c.id), booked_hours: bookedHours(c.id) }));
      return {
        pending_requests: db.reservations.filter((r) => r.status === 'pending').length,
        pending_reports: db.change_reports.filter((r) => r.status === 'pending').length,
        rooms_total: db.classrooms.length,
        rooms_active: db.classrooms.filter((c) => c.is_active).length,
        accounts: db.users.filter((u) => u.is_active).length,
        classes: db.timetable.length,
        buildings: db.buildings.map((b) => {
          const mine = rooms.filter((r) => r.building_id === b.id);
          return { code: b.code, name: b.name, rooms: mine.length, hours: mine.reduce((s, r) => s + r.class_hours + r.booked_hours, 0) };
        }),
        top_rooms: rooms.map((r) => ({ name: r.name, hours: r.class_hours + r.booked_hours })).filter((r) => r.hours > 0)
          .sort((a, b) => b.hours - a.hours).slice(0, 6),
        activity: [...db.activity_logs].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 40)
          .map((a) => ({ ...a, user: (byId(db.users, a.user_id) || {}).full_name || 'Removed account' })),
      };
    }),
  };
})();
