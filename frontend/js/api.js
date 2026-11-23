/* =====================================================================
   ClassCast — data layer (REAL BACKEND)
   Every function calls the FastAPI server in Backend/classcast-backend
   and returns a Promise. The screens in js/modules/ call these functions
   only, so they do not know or care where the data comes from.

   Signing in is done here with Firebase Authentication. Each request
   carries the person's Firebase token; the server checks it and their role.
   Settings (server address, Firebase project) are in js/firebase-config.js.

   The old in-browser mock is kept in js/api.mock.js for reference.
   ===================================================================== */
const API = (() => {
  const CONFIG = window.CLASSCAST_CONFIG || {};
  const BASE = (CONFIG.apiBase || 'http://127.0.0.1:8000').replace(/\/$/, '');

  // The free Render server sleeps after ~15 minutes without visitors and needs 30–60 seconds to wake.
  // Knock once as soon as the page opens, so it is usually awake by the time someone logs in.
  fetch(BASE + '/api/health').catch(() => {});
  // How long a request keeps retrying while the server wakes up (not on this laptop: there a
  // stopped server should be reported straight away).
  const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(BASE);
  const WAKE_WAIT = LOCAL ? 0 : 75000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- date helpers (used by the screens) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => iso(new Date());
  const dayOfWeek = (s) => { const [y, m, d] = s.split('-').map(Number); return ((new Date(y, m - 1, d).getDay() + 6) % 7) + 1; };   // 1 = Monday

  // ---------- Firebase sign-in ----------
  let auth = null;
  let setupError = null;
  try {
    if (!window.firebase) throw new Error('The Firebase library did not load. Check your internet connection.');
    if (!CONFIG.firebase || !CONFIG.firebase.apiKey) throw new Error('js/firebase-config.js is missing the Firebase settings.');
    auth = firebase.initializeApp(CONFIG.firebase).auth();
  } catch (err) { setupError = err; }

  // Firebase remembers the last sign-in. Wait until it has checked, once, at start-up.
  const ready = new Promise((resolve) => {
    if (!auth) { resolve(); return; }
    const stop = auth.onAuthStateChanged(() => { stop(); resolve(); });
  });

  const FIREBASE_ERRORS = {
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/invalid-login-credentials': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'Wrong email or password.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/user-disabled': 'This account has been disabled. Contact the administrator.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'No internet connection. Firebase could not be reached.',
  };

  // ---------- one request to the server ----------
  async function call(method, path, { query, body, timeout } = {}) {
    if (setupError) throw setupError;
    await ready;
    const user = auth.currentUser;
    if (!user) throw new Error('Log in first.');

    const url = new URL(BASE + path);
    Object.entries(query || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });

    // While the server is waking up the request fails (no answer, or 502/503 from Render).
    // Such a request never reached ClassCast, so it is safe to send it again.
    const giveUpAt = Date.now() + WAKE_WAIT;
    let response;
    for (;;) {
      // A request that hangs (server stuck, bad connection) is abandoned after a while and
      // counted as "no answer", so the page shows a message instead of waiting forever.
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), timeout || (LOCAL ? 10000 : 25000));
      try {
        response = await fetch(url, {
          method,
          headers: { Authorization: `Bearer ${await user.getIdToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: stop.signal,
        });
        if (![502, 503, 504].includes(response.status) || LOCAL) break;
      } catch {
        response = null;
      } finally {
        clearTimeout(timer);
      }
      if (Date.now() >= giveUpAt) break;
      await sleep(3000);
    }
    if (!response || (!LOCAL && [502, 503, 504].includes(response.status))) {
      throw new Error(LOCAL
        ? `Cannot reach the ClassCast server at ${BASE}. Is it running?`
        : 'The ClassCast server is still starting up (this takes up to a minute after a quiet spell). Please try again in a moment, and check your internet connection.');
    }
    if (response.status === 204) return undefined;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data && data.detail;
      const msg = Array.isArray(detail)                         // FastAPI form errors: [{loc, msg}, ...]
        ? detail.map((d) => `${d.loc[d.loc.length - 1]}: ${d.msg}`).join('; ')
        : detail || `The server answered ${response.status}.`;
      const err = new Error(msg); err.status = response.status;
      throw err;
    }
    return data;
  }
  const get = (path, query) => call('GET', path, { query });
  const post = (path, body) => call('POST', path, { body });
  const put = (path, body) => call('PUT', path, { body });
  const patch = (path, body) => call('PATCH', path, { body });
  const del = (path) => call('DELETE', path);
  const id = (x) => encodeURIComponent(x);

  // A photo from a phone can be 4000 px and 5 MB. Redraw it at most `longest` px on its long side,
  // as JPEG, and return it the way the server wants it: { media_type, data } with data in base64.
  async function shrinkImage(file, longest) {
    const bitmap = await createImageBitmap(file).catch(() => { throw new Error('That image could not be opened.'); });
    const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);     // transparent PNGs get a white page
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
    return { media_type: 'image/jpeg', data };
  }

  // The room page links to Google Maps; the server does not store map links
  const withMap = (b) => b && ({ ...b, map_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.name}, University of Cape Coast`)}` });

  // =====================================================================
  return {
    today, dayOfWeek,

    // ================= SIGN IN =================
    // Firebase checks the password; then the server says who this is and their role.
    login: async (email, password) => {
      if (setupError) throw setupError;
      try {
        await auth.signInWithEmailAndPassword(String(email).trim(), password);
      } catch (err) {
        throw new Error(FIREBASE_ERRORS[err.code] || err.message);
      }
      try {
        const me = await get('/api/me');
        if (me.role === 'student') throw new Error('Student accounts cannot sign in yet. Only course reps and administrators can.');
        return me;
      } catch (err) {
        await auth.signOut();                                   // no ClassCast account, disabled, or a student
        throw err;
      }
    },
    logout: async () => { if (auth) await auth.signOut(); },

    // "Forgot password?": Firebase emails a link to a page where the person sets a new password.
    // Firebase does not say whether the email has an account, so nobody can use this to find out.
    sendPasswordReset: async (email) => {
      if (setupError) throw setupError;
      try {
        await auth.sendPasswordResetEmail(String(email).trim());
      } catch (err) {
        if (err.code === 'auth/user-not-found') return;          // same answer as for a real account
        throw new Error(FIREBASE_ERRORS[err.code] || err.message);
      }
    },

    // Change my own password. Firebase asks for the current one again first, so someone
    // using a computer the rep left signed in cannot take over the account.
    changePassword: async (current, next) => {
      if (setupError) throw setupError;
      await ready;
      const user = auth.currentUser;
      if (!user) throw new Error('Log in first.');
      try {
        await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, current));
      } catch (err) {
        const wrong = ['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/wrong-password'].includes(err.code);
        throw new Error(wrong ? 'Your current password is wrong.' : FIREBASE_ERRORS[err.code] || err.message);
      }
      try {
        await user.updatePassword(next);
      } catch (err) {
        throw new Error(err.code === 'auth/weak-password' ? 'Firebase refused that password as too weak. Choose a longer one.'
          : FIREBASE_ERRORS[err.code] || err.message);
      }
    },

    // GET /api/me   (null when nobody is signed in, or the login has no usable account)
    getMe: async () => {
      if (setupError) return null;
      await ready;
      if (!auth.currentUser) return null;
      try {
        const me = await get('/api/me');
        return me.role === 'student' ? null : me;
      } catch (err) {
        if (err.status === 401 || err.status === 403) { await auth.signOut(); return null; }
        throw err;
      }
    },

    // ================= COURSE REP =================
    getLookups: () => get('/api/lookups'),
    searchHalls: ({ date, start, end, building, minCap, facility, q }) =>
      get('/api/rooms/search', { date, start, end, building, min_capacity: minCap, facility, q }),
    getHall: async (roomId) => { const room = await get(`/api/rooms/${id(roomId)}`); return { ...room, building: withMap(room.building) }; },
    getDaySchedule: async (roomId, date) => (await get(`/api/rooms/${id(roomId)}/schedule`, { date })).blocks,
    checkClash: (classroomId, date, start, end) => get('/api/reservations/check-clash', { classroom_id: classroomId, date, start, end }),

    createReservation: (data) => post('/api/reservations', data),
    // Several at once (up to 20). All are booked or none; errors start "Booking 2: ..."
    createReservations: (list) => post('/api/reservations/batch', { reservations: list }),
    listMyReservations: () => get('/api/reservations/mine'),
    cancelReservation: (reservationId) => patch(`/api/reservations/${id(reservationId)}/cancel`),

    listMyClasses: () => get('/api/timetable/mine'),
    createChangeReport: (data) => post('/api/change-reports', data),
    listMyReports: () => get('/api/change-reports/mine'),

    listNotifications: () => get('/api/notifications'),
    unreadCount: async () => (await get('/api/notifications/unread-count')).count,
    markAllRead: () => patch('/api/notifications/read-all'),

    // ================= ADMIN 1: accounts =================
    listUsers: () => get('/api/admin/users'),
    saveUser: (d) => {
      const body = { full_name: d.full_name || '', email: d.email || '', role: d.role, index_number: d.index_number || '',
        course_ids: d.role === 'admin' ? [] : (d.course_ids || []).map(String), password: d.password || null };
      return d.id ? put(`/api/admin/users/${id(d.id)}`, body) : post('/api/admin/users', body);
    },
    setUserActive: (userId, active) => patch(`/api/admin/users/${id(userId)}/active`, { is_active: Boolean(active) }),
    deleteUser: (userId) => del(`/api/admin/users/${id(userId)}`),

    // ================= ADMIN 2: classrooms =================
    listClassrooms: () => get('/api/admin/classrooms'),
    saveClassroom: (d) => {
      const capacity = Number(d.capacity);
      if (!(capacity > 0)) return Promise.reject(new Error('Enter the number of seats.'));
      const body = { name: d.name || '', building_id: String(d.building_id || ''), capacity, floor: d.floor || null,
        facility_ids: (d.facility_ids || []).map(String), is_active: Boolean(d.is_active) };
      return d.id ? put(`/api/admin/classrooms/${id(d.id)}`, body) : post('/api/admin/classrooms', body);
    },
    deleteClassroom: (roomId) => del(`/api/admin/classrooms/${id(roomId)}`),

    // ================= ADMIN 3: buildings and facilities =================
    listBuildings: () => get('/api/admin/buildings'),
    saveBuilding: (d) => {
      const body = { name: d.name || '', code: d.code || '' };
      return d.id ? put(`/api/admin/buildings/${id(d.id)}`, body) : post('/api/admin/buildings', body);
    },
    deleteBuilding: (buildingId) => del(`/api/admin/buildings/${id(buildingId)}`),
    saveFacility: (d) => (d.id ? put(`/api/admin/facilities/${id(d.id)}`, { name: d.name || '' }) : post('/api/admin/facilities', { name: d.name || '' })),
    deleteFacility: (facilityId) => del(`/api/admin/facilities/${id(facilityId)}`),

    // ================= ADMIN 4: timetable =================
    listTimetable: () => get('/api/admin/timetable'),
    saveTimetableEntry: (d) => {
      if (!d.start_time || !d.end_time) return Promise.reject(new Error('Enter the start and end time.'));
      const body = { course_id: String(d.course_id || ''), classroom_id: String(d.classroom_id || ''), day_of_week: Number(d.day_of_week),
        start_time: d.start_time, end_time: d.end_time, lecturer_name: d.lecturer_name || null };
      return d.id ? put(`/api/admin/timetable/${id(d.id)}`, body) : post('/api/admin/timetable', body);
    },
    deleteTimetableEntry: (entryId) => del(`/api/admin/timetable/${id(entryId)}`),
    importTimetable: ({ rows, replace, file_name, source }) =>
      post('/api/admin/timetable/import', { rows, replace: Boolean(replace), file_name: file_name || '', source: source || 'csv' }),
    listTimetableImports: () => get('/api/admin/timetable/imports'),
    deleteTimetableImport: (importId) => del(`/api/admin/timetable/imports/${id(importId)}`),
    // Claude reads a timetable photo into rows for the admin to check. Nothing is saved yet.
    // The photo is shrunk in the browser first (smaller upload, and within Claude's image limits).
    readTimetableImage: async (file) => {
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) throw new Error('Choose a JPG, PNG or WebP image.');
      const image = await shrinkImage(file, 2000);
      return call('POST', '/api/admin/timetable/read-image', { body: image, timeout: 180000 });
    },

    // ================= ADMIN 5: reservation requests =================
    listAllReservations: () => get('/api/admin/reservations'),
    reviewReservation: (reservationId, decision, reason) => patch(`/api/admin/reservations/${id(reservationId)}`, { decision, reason: reason || null }),

    // ================= ADMIN 6: reported changes =================
    listAllReports: () => get('/api/admin/change-reports'),
    reviewReport: (reportId, decision) => patch(`/api/admin/change-reports/${id(reportId)}`, { decision }),

    // ================= ADMIN 7: usage and activity =================
    pendingCounts: () => get('/api/admin/pending-counts'),
    getOverview: () => get('/api/admin/overview'),
  };
})();
