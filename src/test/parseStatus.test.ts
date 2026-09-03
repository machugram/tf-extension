import assert from "node:assert/strict";
import test from "node:test";
import { parseStatus, parseStatusDetailed, parseStatusXml, primaryChangeType } from "../tf/parseStatus";

const xml = `<?xml version="1.0" encoding="utf-8"?>
<status>
  <pendingchanges>
    <pendingchange serveritem="$/jeyou/README.md" localitem="C:\\repos\\README.md" version="19" owner="Jeff Young" date="Wednesday, February 22, 2017 1:47:26 PM" lock="none" changetype="edit" workspace="jeyou-dev00" computer="JEYOU-DEV00" />
    <pendingchange serveritem="$/jeyou/old.ts" localitem="C:\\repos\\renamed.ts" sourceitem="$/jeyou/old.ts" version="8" owner="Jeff" date="d" lock="none" changetype="edit, rename" workspace="ws" computer="PC" />
  </pendingchanges>
  <candidatependingchanges>
    <pendingchange serveritem="$/jeyou/therightstuff.txt" localitem="C:\\repos\\therightstuff.txt" version="0" owner="Jeff Young" date="Wednesday, February 22, 2017 11:48:34 AM" lock="none" changetype="add" workspace="jeyou-dev00" computer="JEYOU-DEV00" />
  </candidatependingchanges>
</status>`;

const detailed = `$/jeyou/README.md;C19
User : Jeff Young (TFS)
Date : Wednesday, February 22, 2017 1:47:26 PM
Lock : none
Change : edit
Workspace : jeyou-dev00-tfexe-OnPrem
Local item : [JEYOU-DEV00] C:\\repos\\TfExe.Tfvc.L2VSCodeExtension.RC.TFS\\README.md
File type : utf-8

-------------------------------------------------------------------------------------------------------------------------------------------------------------
Detected Changes:
-------------------------------------------------------------------------------------------------------------------------------------------------------------
$/jeyou/therightstuff.txt
User : Jeff Young (TFS)
Date : Wednesday, February 22, 2017 11:48:34 AM
Lock : none
Change : add
Workspace : jeyou-dev00-tfexe-OnPrem
Local item : [JEYOU-DEV00] C:\\repos\\TfExe.Tfvc.L2VSCodeExtension.RC.TFS\\therightstuff.txt

1 change(s), 1 detected change(s)
`;

test("parseStatusXml reads pending and candidate changes", () => {
  const changes = parseStatusXml(xml);
  assert.equal(changes.length, 3);
  assert.equal(changes[0].serverItem, "$/jeyou/README.md");
  assert.equal(changes[0].localItem, "C:\\repos\\README.md");
  assert.deepEqual(changes[0].changeTypes, ["edit"]);
  assert.equal(changes[0].isCandidate, false);
  assert.deepEqual(changes[1].changeTypes, ["edit", "rename"]);
  assert.equal(changes[1].sourceItem, "$/jeyou/old.ts");
  assert.equal(changes[2].isCandidate, true);
  assert.deepEqual(changes[2].changeTypes, ["add"]);
});

test("parseStatusDetailed reads exe output including detected changes", () => {
  const changes = parseStatusDetailed(detailed);
  assert.equal(changes.length, 2);
  assert.equal(changes[0].serverItem, "$/jeyou/README.md");
  assert.equal(changes[0].version, "19");
  assert.equal(changes[0].computer, "JEYOU-DEV00");
  assert.equal(changes[0].localItem, "C:\\repos\\TfExe.Tfvc.L2VSCodeExtension.RC.TFS\\README.md");
  assert.equal(changes[0].isCandidate, false);
  assert.equal(changes[1].isCandidate, true);
  assert.deepEqual(changes[1].changeTypes, ["add"]);
});

test("parseStatus auto-detects xml vs detailed", () => {
  assert.equal(parseStatus(xml).length, 3);
  assert.equal(parseStatus(detailed).length, 2);
  assert.deepEqual(parseStatus(""), []);
});

test("primaryChangeType prefers delete, add, rename, edit", () => {
  const [editRename] = parseStatusXml(xml).slice(1);
  assert.equal(primaryChangeType(editRename), "rename");
});
