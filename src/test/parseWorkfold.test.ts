import assert from "node:assert/strict";
import test from "node:test";
import { parseHistory, parseChangesetNumber, parseShelvesets } from "../tf/parseHistory";
import { localPathIsInside, parseWorkfold, teamProjectFromServerPath } from "../tf/parseWorkfold";

const clcWorkfold = `
Access denied connecting to TFS server https://account.visualstudio.com/ (authenticating as Personal Access Token)
=====================================================================================================================================================
Workspace: MyNewWorkspace2
Collection: http://java-tfs2015:8081/tfs/
$/tfsTest_01: D:\\tmp\\test
`;

const exeWorkfold = `
=====================================================================================================================================================
Workspace : MyNewWorkspace2 (user name)
Collection: http://server:8081/tfs/
$/tfsTest_01: C:\\code\\Main
(cloaked) $/tfsTest_01/secret:
`;

test("parseWorkfold reads CLC workspace mappings", () => {
  const workspace = parseWorkfold(clcWorkfold);
  assert.ok(workspace);
  assert.equal(workspace.name, "MyNewWorkspace2");
  assert.equal(workspace.collection, "http://java-tfs2015:8081/tfs/");
  assert.equal(workspace.teamProject, "tfsTest_01");
  assert.equal(workspace.mappings[0].localPath, "D:\\tmp\\test");
});

test("parseWorkfold strips owner from tf.exe workspace name", () => {
  const workspace = parseWorkfold(exeWorkfold, true);
  assert.ok(workspace);
  assert.equal(workspace.name, "MyNewWorkspace2");
  assert.equal(workspace.mappings.length, 2);
  assert.equal(workspace.mappings[1].cloaked, true);
  assert.equal(workspace.mappings[1].serverPath, "$/tfsTest_01/secret");
});

test("teamProjectFromServerPath uses the first folder", () => {
  assert.equal(teamProjectFromServerPath("$/Project/Main/src"), "Project");
  assert.equal(teamProjectFromServerPath("$/Project"), "Project");
});

test("localPathIsInside matches nested folders", () => {
  assert.equal(localPathIsInside("C:\\code\\Main\\src", "C:\\code\\Main"), true);
  assert.equal(localPathIsInside("C:\\code\\Main2", "C:\\code\\Main"), false);
});

const history = `-------------------------------------------------------------------------------
Changeset: 20
User: Leah Antkiewicz
Date: Wednesday, February 22, 2017 1:47:26 PM
Comment:
  Add login form

Items:
  edit $/proj/src/login.ts
  add $/proj/src/auth.ts
`;

test("parseHistory reads detailed changeset blocks", () => {
  const entries = parseHistory(history);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].changeset, "20");
  assert.equal(entries[0].user, "Leah Antkiewicz");
  assert.match(entries[0].comment, /Add login form/);
  assert.equal(entries[0].items.length, 2);
});

test("parseChangesetNumber extracts the checked-in id", () => {
  assert.equal(parseChangesetNumber("Changeset #20 checked in."), "20");
});

test("parseShelvesets reads detailed shelveset blocks", () => {
  const output = `-------------------------------------------------------------------------------
Shelveset: wip (Jeff Young)
Date: Wednesday, February 22, 2017 1:47:26 PM
Comment:
  park this
`;
  const sets = parseShelvesets(output);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].name, "wip");
  assert.equal(sets[0].owner, "Jeff Young");
});
