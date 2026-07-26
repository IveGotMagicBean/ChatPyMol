import assert from "node:assert/strict";
import test from "node:test";
import {
  selectPmlSkills,
  validatePmlSkillEdit
} from "./pml-skills.mjs";

test("skill router always loads safety and matches domain skills", async () => {
  const skills = await selectPmlSkills("把配体口袋做成论文白底视图");
  assert.deepEqual(
    skills.map((skill) => skill.id),
    ["safe-pml", "ligand-pocket", "publication-figure"]
  );
});

test("multi-object scene does not require pairwise alignment", () => {
  assert.doesNotThrow(() =>
    validatePmlSkillEdit({
      previousPml: "",
      structures: [
        { objectName: "protein_a" },
        { objectName: "protein_b" },
        { objectName: "dna" }
      ],
      edit: {
        pml: [
          "show cartoon, protein_a or protein_b or dna",
          "translate [20, 0, 0], protein_b",
          "translate [-20, 0, 0], dna",
          "orient protein_a or protein_b or dna"
        ].join("\n")
      }
    })
  );
});

test("alignment skill rejects unknown object names", () => {
  assert.throws(
    () =>
      validatePmlSkillEdit({
        previousPml: "",
        structures: [{ objectName: "protein_a" }],
        edit: { pml: "align invented_object, protein_a" }
      }),
    /未知对象/
  );
});


test("AI edit rejects a chain absent from the structure manifest", () => {
  assert.throws(
    () =>
      validatePmlSkillEdit({
        previousPml: "show cartoon\n",
        structures: [
          {
            objectName: "protein_a",
            metadata: { chains: [{ id: "A" }, { id: "B" }] }
          }
        ],
        edit: { pml: "show cartoon\ncolor cyan, chain Z\n" }
      }),
    /不存在的链 Z/
  );
});


test("AI edit rejects fabricated structure management lines", () => {
  const marker =
    "# @chatpymol structure=str_real sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.throws(
    () =>
      validatePmlSkillEdit({
        previousPml: `${marker}\nload 1CRN.pdb, 1CRN\n`,
        structures: [{ objectName: "1CRN" }],
        edit: {
          pml:
            `${marker}\nload 1CRN.pdb, 1CRN\n` +
            "# @chatpymol structure=str_fake sha256=fake\n" +
            "load 1TRZ.pdb, 1TRZ\n"
        }
      }),
    /不得新增或伪造/
  );
});
