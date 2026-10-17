// Same-origin transport only. The server verifies the owner session with Neon.
export function createHubAuth(fetcher = fetch) {
  async function post(route, body = {}) {
    const response = await fetcher("/api/auth/" + route, {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      return {
        error: {
          message:
            typeof data.error === "string"
              ? data.error
              : data.message || "Sign-in could not finish. Please try again.",
        },
      };
    return { data };
  }
  return {
    signOut: () => post("sign-out"),
    signIn: { emailOtp: (data) => post("sign-in/email-otp", data) },
    emailOtp: {
      sendVerificationOtp: (data) =>
        post("email-otp/send-verification-otp", data),
    },
  };
}
