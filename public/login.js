// login.js – handles the “Play as Guest / Sign-in with Google” gate
export function initLoginGate({ onGuest, onGoogle }) {
  const loginGate = document.getElementById('loginGate');
  const guestBtn  = document.getElementById('guestBtn');
  const loginMsg  = document.getElementById('loginMsg');

  // ---------------------------------------------------------------------------
  // 1. “Play as Guest” – just close the gate and let the caller proceed
  // ---------------------------------------------------------------------------
  guestBtn.onclick = onGuest;

  // ---------------------------------------------------------------------------
  // 2. Google Identity Services (GIS)
  // ---------------------------------------------------------------------------
  /* global google */
  google.accounts.id.initialize({
    client_id: '410563389240-cj67c6dalqbg1d7dllba097327gs23pa.apps.googleusercontent.com', // ← your real client-ID
    ux_mode  : 'popup',
    callback : (resp) => {
      console.log('got token', resp.credential);  // debug – remove if you like
      loginMsg.textContent = '';                  // clear any previous error
      onGoogle(resp.credential);                  // bubble the JWT up
    }
  });

  google.accounts.id.renderButton(
    document.getElementById('gSignIn'),
    { theme: 'filled', size: 'large', type: 'standard', shape: 'pill', text: 'signin_with' }
  );

  // ---------------------------------------------------------------------------
  // helper so caller can hide the gate when they’re ready
  // ---------------------------------------------------------------------------
  function closeGate() { loginGate.style.display = 'none'; }
  return closeGate;
}
