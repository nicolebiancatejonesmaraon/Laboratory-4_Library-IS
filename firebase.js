import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-analytics.js";

const firebaseConfig = {
    apiKey: "AIzaSyBroWviBwwMeQz2o29_lfHWH695UsBqA-E",
    authDomain: "libraryis-87282.firebaseapp.com",
    projectId: "libraryis-87282",
    storageBucket: "libraryis-87282.appspot.com",
    messagingSenderId: "992616952611",
    appId: "1:992616952611:web:6abbc327bb3ae8e7421296",
    measurementId: "G-HZFXJLJ0LW"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const analytics = getAnalytics(app);

export { app, db };
