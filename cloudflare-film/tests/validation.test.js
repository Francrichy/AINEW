import test from "node:test";
import assert from "node:assert/strict";
import { validateFilmRequest } from "../src/validation.js";

test("accepts a valid multi-scene film request", () => {
  const result = validateFilmRequest({
    ownerId: "user-1",
    title: "Demo",
    scenes: [{ prompt: "A sunrise over a green farm", duration: 15, aspectRatio: "16:9" }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.scenes.length, 1);
});

test("rejects more than 120 scenes", () => {
  const scenes = Array.from({ length: 121 }, () => ({ prompt: "A valid scene prompt" }));
  assert.equal(validateFilmRequest({ ownerId: "u1", scenes }).ok, false);
});

test("rejects unsupported clip duration", () => {
  const result = validateFilmRequest({
    ownerId: "u1", scenes: [{ prompt: "A valid scene prompt", duration: 30 }]
  });
  assert.equal(result.ok, false);
});

test("rejects an empty prompt", () => {
  const result = validateFilmRequest({ ownerId: "u1", scenes: [{ prompt: " " }] });
  assert.equal(result.ok, false);
});
