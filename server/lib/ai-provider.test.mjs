import assert from "node:assert/strict";
import test from "node:test";
import { compactLegacyPml, proposePmlEdit } from "./ai-provider.mjs";

const BASE_PML = `# @chatpymol structure sample
load sample.pdb, sample

# PyMOL 原生界面操作
_ set_view (\\
_    1.000000000, 0.000000000, 0.000000000,\\
_    0.000000000, 1.000000000, 0.000000000 )

# @chatpymol view-begin
set_view (\\
  1.000000000, 0.000000000, 0.000000000,\\
  0.000000000, 1.000000000, 0.000000000 )
# @chatpymol view-end
`;

const STRUCTURES = [
  {
    filename: "sample.pdb",
    objectName: "sample",
    format: "pdb",
    sha256: "test",
    metadata: { chains: [{ id: "A" }, { id: "B" }] }
  }
];

function args(message) {
  return {
    message,
    pml: BASE_PML,
    scene: {},
    structures: STRUCTURES,
    history: []
  };
}

async function withBailianFetch(fetchImpl, callback) {
  const previousKey = process.env.DASHSCOPE_API_KEY;
  const previousOpenAiKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.DASHSCOPE_API_KEY = "test-key";
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = fetchImpl;
  try {
    return await callback();
  } finally {
    if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
    else process.env.DASHSCOPE_API_KEY = previousKey;
    if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousOpenAiKey;
    globalThis.fetch = previousFetch;
  }
}

test("compactLegacyPml removes native _ set_view logs but preserves managed view", () => {
  const compact = compactLegacyPml(BASE_PML);
  assert.doesNotMatch(compact, /^_\s+set_view/m);
  assert.doesNotMatch(compact, /^_\s+/m);
  assert.doesNotMatch(compact, /# PyMOL 原生界面操作/);
  assert.match(compact, /# @chatpymol view-begin/);
  assert.match(compact, /^set_view \(\\/m);
  assert.match(compact, /# @chatpymol view-end/);
});

test("simple pink edit uses instant path and skips Bailian", async () => {
  let fetchCalled = false;
  const proposal = await withBailianFetch(
    async () => {
      fetchCalled = true;
      throw new Error("should not call provider");
    },
    () => proposePmlEdit(args("把它改成粉红色"))
  );

  assert.equal(fetchCalled, false);
  assert.equal(proposal.mode, "instant");
  assert.equal(proposal.model, null);
  assert.equal(typeof proposal.assistantMessage, "string");
  assert.equal(typeof proposal.summary, "string");
  assert.equal(typeof proposal.conversationTitle, "string");
  assert.ok(Array.isArray(proposal.skills));
  assert.match(proposal.pml, /color pink, all/);
  assert.doesNotMatch(proposal.pml, /^_\s+/m);
  assert.match(proposal.pml, /# @chatpymol view-begin/);
});

test("simple chain color targets a known chain", async () => {
  const proposal = await withBailianFetch(
    async () => {
      throw new Error("should not call provider");
    },
    () => proposePmlEdit(args("把 A 链改成粉色"))
  );

  assert.equal(proposal.mode, "instant");
  assert.match(proposal.pml, /color pink, chain A/);
  assert.match(proposal.summary, /A 链/);
});

test("file format questions use an instant answer and preserve PML", async () => {
  let fetchCalled = false;
  const proposal = await withBailianFetch(
    async () => {
      fetchCalled = true;
      throw new Error("should not call provider");
    },
    () => proposePmlEdit(args("PML 和 PSE 是什么？"))
  );

  assert.equal(fetchCalled, false);
  assert.equal(proposal.mode, "instant");
  assert.equal(proposal.pml, compactLegacyPml(BASE_PML));
  assert.match(proposal.assistantMessage, /原始原子坐标/);
  assert.match(proposal.assistantMessage, /完整会话/);
});

test("last command questions use the latest editable PML command", async () => {
  let fetchCalled = false;
  const pml = `${BASE_PML}\ncolor green, chain A\n`;
  const proposal = await withBailianFetch(
    async () => {
      fetchCalled = true;
      throw new Error("should not call provider");
    },
    () =>
      proposePmlEdit({
        ...args("你刚才用的什么命令？"),
        pml
      })
  );

  assert.equal(fetchCalled, false);
  assert.equal(proposal.mode, "instant");
  assert.equal(proposal.pml, compactLegacyPml(pml));
  assert.match(proposal.assistantMessage, /color green, chain A/);
});

test("multi-step color request is not swallowed by instant path", async () => {
  let requestBody;
  const proposal = await withBailianFetch(
    async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  assistantMessage: "已完成复合视觉修改。",
                  summary: "改色并显示表面",
                  conversationTitle: "复合视觉修改",
                  pml: `${compactLegacyPml(BASE_PML)}\n# @chatpymol structure=fake\ncolor pink, all\nshow surface\n`
                })
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    },
    () => proposePmlEdit(args("改成粉色，然后显示表面"))
  );

  assert.equal(proposal.mode, "bailian");
  assert.equal(requestBody.model, process.env.BAILIAN_MODEL || "qwen3.7-max");
  assert.equal(requestBody.enable_thinking, false);
  assert.doesNotMatch(proposal.pml, /structure=fake/);
  const prompt = requestBody.messages.at(-1).content;
  assert.doesNotMatch(prompt, /_ set_view/);
  assert.match(prompt, /# @chatpymol view-begin/);
});

test("Bailian timeout has a clear error and uses an abort signal", async () => {
  await withBailianFetch(
    async (_url, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    },
    async () => {
      await assert.rejects(
        proposePmlEdit(args("请优化一下整体视觉效果")),
        /百炼暂时繁忙，45 秒内未完成响应/
      );
    }
  );
});
