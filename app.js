import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, updateProfile } from "firebase/auth";
import { getDatabase, ref, set, onValue, push, update, remove, get, runTransaction, query, orderByChild, limitToLast } from "firebase/database";
import Swal from 'sweetalert2';
import confetti from 'canvas-confetti';

const firebaseConfig = {
  apiKey: "AIzaSyAgp27hYSZ433dBtrVDwmatt5xCJ6EOt9U",
  authDomain: "cayang.firebaseapp.com",
  projectId: "cayang",
  databaseURL: "https://cayang-default-rtdb.firebaseio.com",
  storageBucket: "cayang.firebasestorage.app",
  messagingSenderId: "960652456673",
  appId: "1:960652456673:web:21f18d74ad28728e187da0"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

let currentUser = null;
let currentRoomId = null;
let userData = {};

// --- UTILS ---
const showSection = (id) => {
    ['auth-section', 'dashboard-section', 'game-section'].forEach(sec => {
        document.getElementById(sec).classList.add('hidden-section');
    });
    document.getElementById(id).classList.remove('hidden-section');
    document.getElementById('loader').classList.add('hidden-section');
};

const toast = (msg, icon = 'success') => {
    Swal.fire({ text: msg, icon: icon, toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
};

// --- AUTH LOGIC ---
window.toggleAuth = () => {
    document.getElementById('login-form').classList.toggle('hidden-section');
    document.getElementById('register-form').classList.toggle('hidden-section');
};

window.register = async () => {
    const name = document.getElementById('reg-name').value;
    const city = document.getElementById('reg-city').value;
    const email = document.getElementById('reg-email').value;
    const pass = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm').value;

    if(!name || pass !== confirm) return toast('Cek kembali data pendaftaran', 'error');

    try {
        const res = await createUserWithEmailAndPassword(auth, email, pass);
        await updateProfile(res.user, { displayName: name });
        await set(ref(db, 'users/' + res.user.uid), {
            name, city, email, wins: 0, level: 1, exp: 0, photoURL: name.charAt(0).toUpperCase()
        });
        toast('Akun Pro Berhasil Dibuat!');
    } catch (e) { toast(e.message, 'error'); }
};

window.login = async () => {
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (e) { toast('Email atau password salah', 'error'); }
};

window.logout = () => signOut(auth);

// --- MONITOR STATE ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        loadDashboard();
    } else {
        showSection('auth-section');
    }
});

function loadDashboard() {
    onValue(ref(db, 'users/' + currentUser.uid), (snap) => {
        userData = snap.val();
        if(!userData) return;
        document.getElementById('user-display-name').innerText = userData.name;
        document.getElementById('user-city').innerText = userData.city;
        document.getElementById('user-wins').innerText = userData.wins;
        document.getElementById('user-avatar').innerText = userData.photoURL;
        showSection('dashboard-section');
    });
    listenForRooms();
    listenLeaderboard();
}

// --- ROOMS & LOBBY ---
window.createRoom = async () => {
    const name = document.getElementById('room-name-input').value || `${userData.name}'s Arena`;
    const pin = document.getElementById('room-pin-input').value;
    
    const newRoomRef = push(ref(db, 'rooms'));
    const roomId = newRoomRef.key;

    await set(newRoomRef, {
        id: roomId,
        name: name,
        pin: pin || null,
        status: 'waiting',
        host: currentUser.uid,
        players: {
            [currentUser.uid]: { name: userData.name, move: "", avatar: userData.photoURL }
        },
        chat: { system: { name: 'Sistem', msg: 'Arena telah siap!' } }
    });
    joinGame(roomId);
};

function listenForRooms() {
    onValue(ref(db, 'rooms'), (snap) => {
        const listDiv = document.getElementById('room-list');
        listDiv.innerHTML = "";
        const rooms = snap.val();
        if(!rooms) {
            listDiv.innerHTML = '<div class="text-center text-slate-500 py-10 italic">Belum ada arena aktif...</div>';
            return;
        }

        Object.keys(rooms).forEach(id => {
            const room = rooms[id];
            if(room.status === 'finished') return;
            
            const playerCount = Object.keys(room.players || {}).length;
            const isFull = playerCount >= 2;

            listDiv.innerHTML += `
                <div class="flex justify-between items-center p-4 bg-slate-800/40 rounded-xl border border-slate-700 hover:border-blue-500 transition-all group">
                    <div class="flex items-center gap-3">
                        <div class="text-2xl">${room.pin ? '🔒' : '🎮'}</div>
                        <div>
                            <p class="font-bold text-slate-200 group-hover:text-blue-400">${room.name}</p>
                            <p class="text-[10px] text-slate-500 uppercase tracking-widest">${playerCount}/2 Pemain</p>
                        </div>
                    </div>
                    <button onclick="handleJoin('${id}', '${room.pin || ''}')" 
                        class="${isFull ? 'bg-slate-700 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 shadow-lg'} px-5 py-2 rounded-lg text-sm font-bold transition-all"
                        ${isFull ? 'disabled' : ''}>
                        ${isFull ? 'PENUH' : 'JOIN'}
                    </button>
                </div>
            `;
        });
    });
}

window.handleJoin = async (id, correctPin) => {
    if(correctPin) {
        const { value: pin } = await Swal.fire({
            title: 'Arena Private',
            input: 'text',
            inputPlaceholder: 'Masukkan PIN Arena',
            showCancelButton: true
        });
        if(pin !== correctPin) return toast('PIN Salah!', 'error');
    }

    await update(ref(db, `rooms/${id}/players/${currentUser.uid}`), {
        name: userData.name,
        move: "",
        avatar: userData.photoURL
    });
    await update(ref(db, `rooms/${id}`), { status: 'playing' });
    joinGame(id);
};

// --- GAMEPLAY CORE ---
function joinGame(id) {
    currentRoomId = id;
    showSection('game-section');
    
    // Listen to game data
    onValue(ref(db, `rooms/${id}`), (snapshot) => {
        const room = snapshot.val();
        if(!room) {
            leaveRoom();
            return;
        }

        document.getElementById('current-room-name').innerText = room.name;
        const playerIds = Object.keys(room.players || {});
        
        // Player 1 UI (Host biasanya)
        const p1 = room.players[playerIds[0]];
        document.getElementById('p1-name').innerText = p1.name;
        document.getElementById('p1-avatar').innerText = p1.avatar;
        document.getElementById('p1-visual').innerText = p1.move ? '✅' : '❓';

        // Player 2 UI
        const p2 = room.players[playerIds[1]];
        if(p2) {
            document.getElementById('p2-name').innerText = p2.name;
            document.getElementById('p2-avatar').innerText = p2.avatar;
            document.getElementById('p2-visual').innerText = p2.move ? '✅' : '❓';
        }

        // Check Winner
        if(p1?.move && p2?.move) {
            processResult(p1, p2, playerIds[0], playerIds[1]);
        }
    });

    // Listen to Chat
    onValue(ref(db, `rooms/${id}/chat`), (snap) => {
        const chatBox = document.getElementById('chat-box');
        chatBox.innerHTML = "";
        const messages = snap.val();
        if(messages) {
            Object.values(messages).forEach(m => {
                const isMe = m.name === userData.name;
                chatBox.innerHTML += `
                    <div class="${m.name === 'Sistem' ? 'text-center italic text-slate-500' : ''}">
                        <span class="${isMe ? 'text-blue-400' : 'text-emerald-400'} font-bold">${m.name}:</span> ${m.msg}
                    </div>
                `;
            });
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    });
}

window.makeMove = async (move) => {
    await update(ref(db, `rooms/${currentRoomId}/players/${currentUser.uid}`), { move });
};

async function processResult(p1, p2, id1, id2) {
    const moveIcons = { batu: '🪨', kertas: '📄', gunting: '✂️' };
    document.getElementById('p1-visual').innerText = moveIcons[p1.move];
    document.getElementById('p2-visual').innerText = moveIcons[p2.move];

    let resultMsg = "";
    let winnerId = null;

    if(p1.move === p2.move) {
        resultMsg = "HASIL SERI!";
    } else if (
        (p1.move === 'batu' && p2.move === 'gunting') ||
        (p1.move === 'gunting' && p2.move === 'kertas') ||
        (p1.move === 'kertas' && p2.move === 'batu')
    ) {
        winnerId = id1;
        resultMsg = `${p1.name} MENANG!`;
    } else {
        winnerId = id2;
        resultMsg = `${p2.name} MENANG!`;
    }

    document.getElementById('game-status-msg').innerText = resultMsg;

    if(winnerId === currentUser.uid) {
        confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
        const userRef = ref(db, 'users/' + currentUser.uid + '/wins');
        runTransaction(userRef, (wins) => (wins || 0) + 1);
    }

    // Reset game after 4 seconds
    setTimeout(async () => {
        if(currentUser.uid === id1) {
            await update(ref(db, `rooms/${currentRoomId}/players/${id1}`), { move: "" });
            await update(ref(db, `rooms/${currentRoomId}/players/${id2}`), { move: "" });
            document.getElementById('game-status-msg').innerText = "";
        }
    }, 4000);
}

// --- CHAT SYSTEM ---
window.sendChat = async () => {
    const input = document.getElementById('chat-input');
    if(!input.value.trim()) return;
    
    await push(ref(db, `rooms/${currentRoomId}/chat`), {
        name: userData.name,
        msg: input.value
    });
    input.value = "";
};

// --- LEADERBOARD ---
function listenLeaderboard() {
    const lbQuery = query(ref(db, 'users'), orderByChild('wins'), limitToLast(5));
    onValue(lbQuery, (snap) => {
        const lbList = document.getElementById('leaderboard-list');
        lbList.innerHTML = "";
        let players = [];
        snap.forEach(child => { players.push(child.val()); });
        players.reverse().forEach((p, index) => {
            lbList.innerHTML += `
                <div class="flex justify-between items-center p-3 bg-slate-900/50 rounded-lg border-l-2 ${index === 0 ? 'border-yellow-500' : 'border-slate-700'}">
                    <div class="flex items-center gap-3">
                        <span class="font-bold text-slate-500">#${index + 1}</span>
                        <span class="font-medium">${p.name}</span>
                    </div>
                    <span class="text-yellow-500 font-bold">${p.wins} WINS</span>
                </div>
            `;
        });
    });
}

window.leaveRoom = async () => {
    if(currentRoomId) {
        // Logika hapus room jika host keluar
        const roomSnap = await get(ref(db, `rooms/${currentRoomId}`));
        if(roomSnap.val()?.host === currentUser.uid) {
            await remove(ref(db, `rooms/${currentRoomId}`));
        } else {
            await remove(ref(db, `rooms/${currentRoomId}/players/${currentUser.uid}`));
        }
        currentRoomId = null;
        showSection('dashboard-section');
    }
};
