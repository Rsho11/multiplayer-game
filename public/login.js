/* login.js – gate + persistent sign-in */
export function initLoginGate({ onGuest, onGoogle }) {
  const loginGate = document.getElementById('loginGate');
  const guestBtn  = document.getElementById('guestBtn');
  const loginMsg  = document.getElementById('loginMsg');

  guestBtn.onclick = onGuest;

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
