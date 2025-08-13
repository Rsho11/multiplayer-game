/* login.js – gate + persistent sign-in */
export function initLoginGate({ onGuest, onGoogle }) {
  const loginGate = document.getElementById('loginGate');
  const guestBtn  = document.getElementById('guestBtn');
  const loginMsg  = document.getElementById('loginMsg');

  guestBtn.onclick = () => {
    // Hide the welcome gate when playing as guest
    loginGate.style.display = 'none';
    onGuest();
  };

  /* global google */
  google.accounts.id.initialize({
    client_id : '410563389240-cj67c6dalqbg1d7dllba097327gs23pa.apps.googleusercontent.com',
    ux_mode   : 'popup',
    auto_select : true,          // <── keeps them signed-in
    callback  : (resp) => {
      console.log('got token', resp.credential);
      loginGate.style.display = 'none';        // hide gate instantly
      onGoogle(resp.credential);
    }
  });

  // Ask GIS whether it can auto-sign-in.  If not, we’ll render buttons below.
  google.accounts.id.prompt((notification) => {
    if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
      // Auto-sign-in failed ➜ show the gate with our buttons
      renderButtons();
    }
  });

  function renderButtons() {
    loginGate.style.display = 'flex';          // gate is hidden by default
    google.accounts.id.renderButton(
      document.getElementById('gSignIn'),
      { theme:'filled', size:'large', type:'standard', shape:'pill', text:'signin_with' }
    );
  }
}
/******************************************************************************
 *  Spooky rotating subtitle – typewriter + fade-out
 ******************************************************************************/

async function startMessageLoop() {
  // 1.  Load the file only once.  (Falls back to a default list if fetch fails.)
  let lines = [
    "Welcome, dreamer.", "still think it's a dream..."
  ];
  try {
    const res = await fetch('/messages.json');
    if (res.ok) lines = await res.json();
  } catch { /* ignore – use fallback */ }

  // 2.  Grab / create the DOM node where we’ll write.
  const subtitle = document.querySelector('#loginGate .tagline');
  subtitle.style.cssText +=
    'font-family: "IBM Plex Mono", monospace;' +  // spooky vibe
    'letter-spacing: .5px; white-space: nowrap; overflow: hidden;';

  let idx = 0;
  let direction = 1;           // 1 = typing, 0 = pause, -1 = deleting

  /** small helper waits ms milliseconds */
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  while (true) {
    const sentence = lines[Math.floor(Math.random() * lines.length)];
    subtitle.textContent = '';                    // reset
    direction = 1;

    // ---------- Type ----------
    for (let i = 0; i < sentence.length; i++) {
      subtitle.textContent += sentence[i];
      await wait(45 + Math.random()*75);          // jitter for creepiness
    }

    // ---------- Idle ----------
    await wait(2200);                             // stay on screen

    // ---------- Delete ----------
    direction = -1;
    while (subtitle.textContent.length) {
      subtitle.textContent = subtitle.textContent.slice(0, -1);
      await wait(30 + Math.random()*60);
    }

    await wait(350);                              // small gap
  }
}

// kick-off once the page finished loading:
document.addEventListener('DOMContentLoaded', startMessageLoop);

