import assert from "node:assert/strict";
import test from "node:test";
import { PairingBroker } from "./event-hub.mjs";

test("pairing broker requires poll secret and returns token only once", () => {
  const broker = new PairingBroker({
    ttlMs: 30_000,
    validateToken: (token) => {
      assert.match(token, /^device_/);
    }
  });
  const pair = broker.start("http://127.0.0.1:8787");
  assert.match(pair.pairUrl, new RegExp(`pair=${pair.code}`));
  assert.equal(broker.status(pair.code, pair.pollSecret).status, "pending");
  assert.throws(
    () => broker.status(pair.code, "wrong-secret"),
    (error) => error.status === 401
  );
  broker.complete(pair.code, "device_pair_test_12345678901234567890");
  const completed = broker.status(pair.code, pair.pollSecret);
  assert.equal(completed.status, "paired");
  assert.equal(completed.token, "device_pair_test_12345678901234567890");
  assert.throws(
    () => broker.status(pair.code, pair.pollSecret),
    (error) => error.status === 404
  );
});
