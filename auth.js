(() => {
  const accounts = [
    { identity: "superadmin", password: "admin123", role: "superadmin", label: "Super Administrator", redirect: "/superadmin/dashboard" },
    { identity: "admin", password: "admin123", role: "admin", label: "Admin Biasa", redirect: "/admin/dashboard" },
  ];

  const screen = document.querySelector("#login-screen");
  const form = document.querySelector("#login-form");
  const identity = document.querySelector("#login-identity");
  const password = document.querySelector("#login-password");
  const remember = document.querySelector("#remember-me");
  const submit = document.querySelector("#login-submit");
  const alertBox = document.querySelector("#login-alert");
  const toggle = document.querySelector(".password-toggle");

  const getSession = () => {
    try { return JSON.parse(sessionStorage.getItem("gkpi_session") || localStorage.getItem("gkpi_remembered_session") || "null"); }
    catch { return null; }
  };

  const showApp = (session) => {
    if (!session) return;
    screen.classList.add("is-hidden");
    document.body.dataset.role = session.role;
    document.body.dataset.user = session.identity;
    document.querySelector("#session-user-name").textContent = session.identity;
    document.querySelector("#session-user-role").textContent = session.label;
  };

  const clearError = (name) => {
    const field = document.querySelector(`[data-error-for="${name}"]`);
    field.textContent = "";
    field.closest(".login-field").classList.remove("has-error");
  };

  const setError = (name, message) => {
    const field = document.querySelector(`[data-error-for="${name}"]`);
    field.textContent = message;
    field.closest(".login-field").classList.add("has-error");
  };

  toggle.addEventListener("click", () => {
    const visible = password.type === "text";
    password.type = visible ? "password" : "text";
    toggle.setAttribute("aria-pressed", String(!visible));
    toggle.setAttribute("aria-label", visible ? "Tampilkan password" : "Sembunyikan password");
  });

  [identity, password].forEach((input) => input.addEventListener("input", () => {
    clearError(input.name);
    alertBox.textContent = "";
  }));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearError("identity"); clearError("password"); alertBox.className = "login-alert"; alertBox.textContent = "";
    let valid = true;
    if (!identity.value.trim()) { setError("identity", "Email atau username wajib diisi."); valid = false; }
    if (!password.value) { setError("password", "Password wajib diisi."); valid = false; }
    if (!valid) return;

    submit.classList.add("is-loading");
    window.setTimeout(() => {
      const account = accounts.find((item) => item.identity.toLowerCase() === identity.value.trim().toLowerCase() && item.password === password.value);
      if (!account) {
        submit.classList.remove("is-loading");
        alertBox.textContent = "Kombinasi username/password salah. Silakan coba lagi.";
        return;
      }
      const session = { identity: account.identity, role: account.role, label: account.label, loginAt: new Date().toISOString(), redirect: account.redirect };
      sessionStorage.setItem("gkpi_session", JSON.stringify(session));
      if (remember.checked) localStorage.setItem("gkpi_remembered_session", JSON.stringify(session));
      alertBox.className = "login-alert success";
      alertBox.textContent = `Berhasil masuk sebagai ${account.label}.`;
      window.setTimeout(() => showApp(session), 350);
    }, 650);
  });

  document.querySelector("#forgot-password").addEventListener("click", (event) => {
    event.preventDefault();
    alertBox.className = "login-alert";
    alertBox.textContent = "Silakan hubungi administrator untuk mengatur ulang password.";
  });

  document.querySelector("#logout-button").addEventListener("click", () => {
    sessionStorage.removeItem("gkpi_session");
    localStorage.removeItem("gkpi_remembered_session");
    document.body.removeAttribute("data-role");
    document.body.removeAttribute("data-user");
    form.reset();
    alertBox.textContent = "";
    clearError("identity");
    clearError("password");
    screen.classList.remove("is-hidden");
    identity.focus();
  });

  showApp(getSession());
})();
