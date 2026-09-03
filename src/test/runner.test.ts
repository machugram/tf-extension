import assert from "node:assert/strict";
import test from "node:test";
import { TfArgs, workItemIds } from "../tf/args";
import { parseChangeTypes } from "../types";

test("parseChangeTypes splits combined TFVC change flags", () => {
  assert.deepEqual(parseChangeTypes("edit, rename"), ["edit", "rename"]);
  assert.deepEqual(parseChangeTypes("edit|lock"), ["edit", "lock"]);
  assert.deepEqual(parseChangeTypes(""), ["unknown"]);
});

test("workItemIds reads #ids from a check-in comment", () => {
  assert.deepEqual(workItemIds("Fixes #12 and #340"), [12, 340]);
  assert.deepEqual(workItemIds("no ids"), []);
});

test("TfArgs builds exe and clc switches", () => {
  const exe = new TfArgs("exe", "https://dev.azure.com/org", "user,secret");
  assert.deepEqual(exe.args("status", [exe.flag("format", "detailed"), exe.flag("recursive")]), [
    "status",
    "/format:detailed",
    "/recursive",
    "/collection:https://dev.azure.com/org",
    "/login:user,secret",
  ]);

  const clc = new TfArgs("clc");
  assert.equal(clc.flag("noprompt"), "-noprompt");
  assert.deepEqual(clc.args("status", [clc.flag("format", "xml")]), ["status", "-format:xml"]);
});
