import { describe, expect, it } from "vitest";
import request from "supertest";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";

describe("POST /generate", () => {
  it("requires tenant ID", async () => {
    const response = await request("http://localhost:3000")
      .post("/generate")
      .set("Idempotency-Key", "test-missing-tenant")
      .send({
        inputTokens: 10,
        outputTokens: 10,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("X-Tenant-Id header is required");
  });

  it("requires idempotency key", async () => {
    const response = await request("http://localhost:3000")
      .post("/generate")
      .set("X-Tenant-Id", TENANT_ID)
      .send({
        inputTokens: 10,
        outputTokens: 10,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      "Idempotency-Key header is required",
    );
  });

  it("rejects invalid request body", async () => {
    const response = await request("http://localhost:3000")
      .post("/generate")
      .set("X-Tenant-Id", TENANT_ID)
      .set("Idempotency-Key", "test-invalid-body")
      .send({
        inputTokens: -1,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid request body");
  });
});