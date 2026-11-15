/* =====================================================================
   firebase-config.js — where the backend is, and which Firebase project
   to sign in with. Loaded before api.js.

   The apiKey below is the Firebase *web* key. It is meant to be in the
   browser (it only identifies the project); it is NOT the private
   serviceAccountKey.json, which must never be put in the front end.
   ===================================================================== */
// On your own laptop the page uses the local server; online it uses the hosted one.
// ONLINE_API is the address Render gives the backend web service.
const ONLINE_API = 'https://classcast-api.onrender.com';
const ON_THIS_LAPTOP = ['127.0.0.1', 'localhost', ''].includes(location.hostname);

window.CLASSCAST_CONFIG = {
  apiBase: ON_THIS_LAPTOP ? 'http://127.0.0.1:8000' : ONLINE_API,   // the FastAPI server
  firebase: {
    apiKey: 'AIzaSyBxIm5esBV1Szea58hWuqpP9qoz29LxAJA',
    authDomain: 'classcast-40370.firebaseapp.com',
    projectId: 'classcast-40370',
  },
};
