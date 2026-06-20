import assert from "node:assert/strict";
import test from "node:test";
import { getGeminiBaseURL } from "../src/lib/ai";

test("Gemini 网关自动补全 v1beta1 协议路径", () => {
  const previous = process.env.GEMINI_GATEWAY_URL;
  process.env.GEMINI_GATEWAY_URL = "https://api.readark.club/api/";

  try {
    assert.equal(
      getGeminiBaseURL(),
      "https://api.readark.club/api/v1beta1"
    );
  } finally {
    if (previous === undefined) {
      delete process.env.GEMINI_GATEWAY_URL;
    } else {
      process.env.GEMINI_GATEWAY_URL = previous;
    }
  }
});
