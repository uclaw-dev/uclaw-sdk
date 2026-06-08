export function getDefaultGetToken(appId: string): () => Promise<string> {
  return async () => {
    let isUClawDev = false;
    if (typeof window !== "undefined" && window.location) {
      const hostname = window.location.hostname;
      isUClawDev = hostname === "uclaw.dev" || hostname.endsWith(".uclaw.dev");
    }

    if (isUClawDev) {
      const res = await fetch("https://api.uclaw.dev/v1/client-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch client token: ${res.statusText}`);
      }

      const data = (await res.json()) as { token: string };
      return data.token;
    } else {
      const res = await fetch("/api/uclaw/client-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appId }),
        credentials: "include",
      });

      if (!res.ok) {
        const hint =
          res.status === 404
            ? "Please ensure the UClaw API handler is configured at /api/uclaw/client-tokens. Refer to the documentation for details."
            : "Please check if your server-side UClaw API handler is configured correctly.";
        throw new Error(`Failed to fetch client token (${res.status} ${res.statusText}): ${hint}`);
      }

      const data = (await res.json()) as { token: string };
      return data.token;
    }
  };
}
