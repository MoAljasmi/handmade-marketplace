/*
 * auth.js - login.html and register.html
 *   Uses Supabase Auth. Passwords are handled by Supabase and are never
 *   stored in our own tables. A database trigger creates the matching
 *   row in the customers table after registration.
 */

const page = document.body.dataset.page;
const redirectTarget = safeRedirectTarget(getParam("redirect"));

function setBusy(form, busy, label) {
    const button = form.querySelector("button[type=submit]");
    button.disabled = busy;
    if (label) button.textContent = label;
}

/* ---------- Register ---------- */
function validateRegistration(values) {
    if (values.fullName.length < 3) return "Please enter your full name.";
    if (!/^\S+@\S+\.\S+$/.test(values.email)) return "Please enter a valid e-mail address.";
    if (values.phone && !/^\+?[0-9\s-]{8,15}$/.test(values.phone)) return "Please enter a valid phone number, for example 050 123 4567.";
    if (values.password.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Za-z]/.test(values.password) || !/[0-9]/.test(values.password)) return "Password must contain letters and numbers.";
    if (values.password !== values.confirm) return "Passwords do not match.";
    if (!values.terms) return "Please accept the privacy policy to continue.";
    return "";
}

async function handleRegister(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#form-message");
    const values = {
        fullName: form.fullName.value.trim(),
        email: form.email.value.trim().toLowerCase(),
        phone: form.phone.value.trim(),
        password: form.password.value,
        confirm: form.confirm.value,
        terms: form.terms.checked
    };

    const problem = validateRegistration(values);
    if (problem) {
        showMessage(message, problem, "error");
        return;
    }
    if (!supabaseClient) {
        showMessage(message, "The database is not connected yet (see js/config.js).", "error");
        return;
    }

    setBusy(form, true, "Creating account...");
    const loginPage = new URL("login.html", window.location.href).href;
    const { data, error } = await supabaseClient.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
            data: { full_name: values.fullName, phone: values.phone },
            emailRedirectTo: loginPage
        }
    });
    setBusy(form, false, "Create account");

    if (error) {
        showMessage(message, friendlyError(error), "error");
        return;
    }

    if (data.session) {
        // E-mail confirmation is turned off: the user is logged in now
        window.location.href = redirectTarget;
    } else {
        form.reset();
        showMessage(message, "Account created. Please check your e-mail and click the confirmation link, then log in.", "success");
    }
}

/* ---------- Log in ---------- */
async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#form-message");
    const email = form.email.value.trim().toLowerCase();
    const password = form.password.value;

    if (!email || !password) {
        showMessage(message, "Please enter your e-mail and password.", "error");
        return;
    }
    if (!supabaseClient) {
        showMessage(message, "The database is not connected yet (see js/config.js).", "error");
        return;
    }

    setBusy(form, true, "Logging in...");
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    setBusy(form, false, "Log in");

    if (error) {
        const text = error.message === "Email not confirmed"
            ? "Please confirm your e-mail first (check your inbox)."
            : "Incorrect e-mail or password.";
        showMessage(message, text, "error");
        return;
    }
    window.location.href = redirectTarget;
}

/* Show / hide password */
$all("[data-toggle-password]").forEach(button => {
    button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.togglePassword);
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        button.textContent = show ? "Hide" : "Show";
        button.setAttribute("aria-pressed", String(show));
    });
});

async function initAuthPage() {
    // Already logged in? Go straight on.
    const user = await getCurrentUser();
    if (user) {
        window.location.href = redirectTarget === "index.html" ? "account.html" : redirectTarget;
        return;
    }
    if (page === "register") $("#register-form").addEventListener("submit", handleRegister);
    if (page === "login") {
        $("#login-form").addEventListener("submit", handleLogin);
        if (getParam("redirect")) {
            showMessage($("#form-message"), "Please log in to continue.", "info");
        }
        const registerLink = $("#register-link");
        if (registerLink && getParam("redirect")) {
            registerLink.href = `register.html?redirect=${encodeURIComponent(redirectTarget)}`;
        }
    }
}

initAuthPage();
