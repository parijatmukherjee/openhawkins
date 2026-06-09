import { describe, it, expect } from "vitest";
import { redact, REDACTED } from "../../src/security/redact.js";

describe("redact", () => {
  it("redacts values of secret-named fields, recursively", () => {
    const out = redact({
      model: "llama3.1",
      apiKey: "sk-cloud-xyz",
      nested: { password: "hunter2", keep: "ok" },
    });
    expect(out).toEqual({
      model: "llama3.1",
      apiKey: REDACTED,
      nested: { password: REDACTED, keep: "ok" },
    });
  });

  it("redacts secret-shaped values even under an innocent key name", () => {
    expect(redact({ note: "use Bearer sk-abcdefgh12345 to auth" })).toEqual({
      note: `use ${REDACTED} to auth`,
    });
  });

  it("does not mutate the input", () => {
    const input = { apiKey: "sk-keepme-original" };
    redact(input);
    expect(input.apiKey).toBe("sk-keepme-original");
  });

  it("passes through non-secret primitives untouched", () => {
    expect(redact({ count: 3, ok: true, name: "disk_free" })).toEqual({
      count: 3,
      ok: true,
      name: "disk_free",
    });
  });
});

describe("redact — broadened patterns", () => {
  const masked = (s: string) => redact(s) as string;

  it("masks real provider key shapes inside a string", () => {
    // Built from low-entropy repeated chars so each VALUE matches our redaction regex but
    // the source contains no contiguous high-entropy secret literal (GitHub push protection
    // flags those even when they're obviously fake test fixtures).
    const body = (n: number, ch = "a") => ch.repeat(n);
    expect(masked(`x AKIA${body(16, "A")} y`)).toContain(REDACTED); // AWS access key id
    expect(masked(`x AIza${body(35)} y`)).toContain(REDACTED); // Google API key
    expect(masked(`x ghp_${body(36)} y`)).toContain(REDACTED); // GitHub token
    expect(masked(`x github_pat_${body(30)} y`)).toContain(REDACTED); // GitHub fine-grained PAT
    expect(masked(`x sk_live_${body(20)} y`)).toContain(REDACTED); // Stripe
    expect(masked(`x xoxb-${body(20, "0")} y`)).toContain(REDACTED); // Slack
    expect(masked(`x eyJ${body(8)}.${body(8, "b")}.${body(8, "c")} y`)).toContain(REDACTED); // JWT
  });

  it("masks a PEM private key block", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc123\n-----END RSA PRIVATE KEY-----";
    expect(masked(`x ${pem} y`)).toContain(REDACTED);
    expect(masked(`x ${pem} y`)).not.toContain("MIIabc123");
  });

  it("masks an email (PII)", () => {
    expect(masked("contact jane.doe@example.com please")).toContain(REDACTED);
    expect(masked("contact jane.doe@example.com please")).not.toContain("jane.doe@example.com");
  });

  it("redacts broadened secret KEY names", () => {
    const out = redact({
      client_secret: "x",
      access_token: "y",
      pwd: "z",
      credential: "c",
    }) as Record<string, unknown>;
    expect(out).toEqual({
      client_secret: REDACTED,
      access_token: REDACTED,
      pwd: REDACTED,
      credential: REDACTED,
    });
  });

  it("does NOT redact structural fields (replay safety)", () => {
    const ev = {
      type: "PhaseEntered",
      sessionId: "probe-agent-session",
      runId: "r1",
      phase: "Validate",
      at: 5,
    };
    expect(redact(ev)).toEqual(ev);
  });

  it("keeps the original sk-/Bearer behavior", () => {
    expect(masked("sk-abcdefgh12345")).toContain(REDACTED);
    expect(masked("Bearer abc.def")).toContain(REDACTED);
  });

  it("recurses into arrays", () => {
    expect(redact([{ token: "x" }, "plain", "Bearer abc.def"])).toEqual([
      { token: REDACTED },
      "plain",
      `${REDACTED}`,
    ]);
  });
});
