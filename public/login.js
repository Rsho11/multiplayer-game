// login.js – responsible only for the gate
export function initLoginGate({ onGuest, onGoogle }) {
  const loginGate = document.getElementById('loginGate');
  const guestBtn  = document.getElementById('guestBtn');
  const loginMsg  = document.getElementById('loginMsg');

  guestBtn.onclick = onGuest;

  /* global google */
  google.accounts.id.initialize({
    client_id: "410563389240-cj67c6dalqbg1d7dllba097327gs23pa.apps.googleusercontent.com",    
    ux_mode: "popup",
    callback: (resp) => {
      loginMsg.textContent = "";               // clear errors
      onGoogle(resp.credential);               // send the JWT upward
    }
  });
  google.accounts.id.renderButton(
    document.getElementById("gSignIn"),
    { theme:"filled", size:"large", type:"standard", shape:"pill", text:"signin_with" }
  );

  function closeGate() { loginGate.style.display = 'none'; }
  return closeGate;
}
