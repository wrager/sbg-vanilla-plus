import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Script } from 'node:vm';
import { test } from 'node:test';
const source = readFileSync(
  new URL('../.github/workflows/pr-coauthors.yml', import.meta.url),
  'utf8',
);
const separator = '          script: |\n';
const script = source.split(separator)[1];
assert.ok(script, 'The trusted workflow must contain one inline metadata script');
const program = new Script(`(async () => {\n${script.replace(/^ {12}/gm, '')}\n})()`);
const marker = '<!-- pr-coauthors:managed -->';
const first = 'Co-authored-by: GPT-6 <noreply@openai.com>';
const second = 'Co-authored-by: GPT-6.1 <noreply@openai.com>';
function fixture(options = {}) {
  const updates = [];
  const gets = new Map();
  let graphCalls = 0;
  const numbers = options.batch ?? [7];
  const states = new Map(
    numbers.map((number) => [
      number,
      {
        number,
        state: options.closed ? 'closed' : 'open',
        base: { ref: options.base ?? 'main' },
        head: { sha: 'original-head' },
        body: options.body ?? 'Описание PR',
      },
    ]),
  );
  const messages = options.messages ?? [`ci: metadata\n\n${first}`];
  const github = {
    rest: {
      pulls: {
        async get({ pull_number }) {
          const state = states.get(pull_number);
          assert.ok(state);
          const count = (gets.get(pull_number) ?? 0) + 1;
          gets.set(pull_number, count);
          if (count % 2 === 0 && options.changedHead === 'final') state.head.sha = 'changed-head';
          return { data: structuredClone(state) };
        },
        async update(input) {
          assert.deepEqual(Object.keys(input).sort(), ['body', 'owner', 'pull_number', 'repo']);
          const state = states.get(input.pull_number);
          assert.ok(state);
          state.body = input.body;
          updates.push({ body: input.body, pull_number: input.pull_number });
        },
        async list() {
          return [];
        },
      },
    },
    async paginate(method, input) {
      assert.equal(method, github.rest.pulls.list);
      assert.equal(input.state, 'open');
      assert.equal(input.base, 'main');
      assert.equal(input.per_page, 100);
      return numbers.map((number) => ({ number }));
    },
    async graphql(query, input) {
      assert.match(query, /commits\(first: 100/);
      graphCalls += 1;
      const state = states.get(input.number);
      assert.ok(state);
      if (options.changedHead === 'page') state.head.sha = 'changed-head';
      if (options.editedBody !== undefined) state.body = options.editedBody;
      const start = input.cursor === null ? 0 : Number(input.cursor);
      const end = Math.min(start + 100, messages.length);
      return {
        repository: {
          pullRequest: {
            headRefOid: state.head.sha,
            commits: {
              totalCount: messages.length + (options.incomplete ? 1 : 0),
              nodes: messages.slice(start, end).map((message) => ({ commit: { message } })),
              pageInfo: { hasNextPage: end < messages.length, endCursor: String(end) },
            },
          },
        },
      };
    },
  };
  const context = {
    repo: { owner: 'wrager', repo: 'example' },
    payload: {
      pull_request: options.sweep || options.input !== undefined ? undefined : { number: 7 },
      inputs: options.input !== undefined ? { pr_number: options.input } : undefined,
    },
  };
  const run = async () => {
    const pending = program.runInNewContext({ github, context, core: { info() {} } });
    await Promise.resolve(pending);
  };
  return { run, updates, states, graphCalls: () => graphCalls };
}
test('all commit pages retain distinct models sharing an email, normalize trailers and deduplicate', async () => {
  const messages = Array.from({ length: 301 }, (_, index) => `ci: item ${index}`);
  messages[0] += `\n\n${first}\n${first}`;
  messages[300] += `\n\n${second.replace('Co-authored-by', 'Co-Authored-By')}`;
  const work = fixture({ messages });
  await work.run();
  assert.equal(work.graphCalls(), 4);
  assert.equal(work.updates.length, 1);
  assert.equal(work.updates[0]?.body, `Описание PR\n\n${marker}\n\n${first}\n${second}`);
  await work.run();
  assert.equal(work.updates.length, 1, 'A repeated event must not rewrite an unchanged body');
});
test('release-please scaffold and metadata survive; trailers remain a real final Git footer', async () => {
  const scaffold =
    '<!-- release-please -->\n<details>\n\n## Features\n\n* Содержимое\n\n</details>';
  const body = `${scaffold}\n\nSigned-off-by: Author <author@example.com>\n${second}`;
  const work = fixture({ body });
  await work.run();
  const updated = work.updates[0]?.body;
  assert.ok(updated);
  assert.ok(updated.startsWith(scaffold + '\n\n'));
  const trailers = execFileSync('git', ['interpret-trailers', '--parse'], {
    input: updated,
    encoding: 'utf8',
  });
  assert.ok(trailers.includes(first));
  assert.ok(trailers.includes(second));
  assert.ok(trailers.includes('Signed-off-by: Author <author@example.com>'));
  assert.ok(updated.endsWith(second));
});
test('human text added after the managed footer survives and explicit existing credits remain', async () => {
  const body = `Описание\n\n${marker}\n\n${second}\n\nДополнение человека`;
  const work = fixture({ body });
  await work.run();
  const updated = work.updates[0]?.body;
  assert.ok(updated?.includes('Дополнение человека'));
  assert.ok(updated?.endsWith(`${first}\n${second}`));
  assert.equal(updated?.split(marker).length, 2);
});
test('latest API description preserves edits made while commits are read; data is never executed', async () => {
  const editedBody = 'Новое описание с `кодом`, $(command) и ${{ untrusted.expression }}';
  const work = fixture({ body: 'Старое описание', editedBody });
  await work.run();
  assert.ok(work.updates[0]?.body.startsWith(editedBody + '\n\n'));
});
for (const changedHead of ['page', 'final']) {
  test(`head change during ${changedHead} refuses a stale update`, async () => {
    const work = fixture({ changedHead });
    await assert.rejects(work.run(), /changed/i);
    assert.equal(work.updates.length, 0);
  });
}
test('an incomplete API list refuses partial credits', async () => {
  const work = fixture({ incomplete: true });
  await assert.rejects(work.run(), /Incomplete commit list/);
  assert.equal(work.updates.length, 0);
});
test('closed or differently targeted PRs are never modified', async () => {
  for (const options of [{ closed: true }, { base: 'other' }]) {
    const work = fixture(options);
    await work.run();
    assert.equal(work.graphCalls(), 0);
    assert.equal(work.updates.length, 0);
  }
});
test('PRs without coauthors stay byte-identical and get no empty marker', async () => {
  const work = fixture({ body: 'Описание  \n', messages: ['ci: no explicit coauthor'] });
  await work.run();
  assert.equal(work.updates.length, 0);
});
test('ambiguous markers and malformed author trailers fail without touching the description', async () => {
  for (const options of [
    { body: `${marker}\n\n${first}\n\n${marker}\n\n${second}` },
    { messages: ['ci: bad footer\n\nCo-authored-by: missing-email'] },
  ]) {
    const work = fixture(options);
    await assert.rejects(work.run(), /markers|Malformed/);
    assert.equal(work.updates.length, 0);
  }
});
test('oversized bodies are refused without truncating human or bot content', async () => {
  const work = fixture({ body: 'x'.repeat(65530) });
  await assert.rejects(work.run(), /exceeds the GitHub limit/);
  assert.equal(work.updates.length, 0);
});
test('push, Release workflow completion and manual sweeps process all listed open PRs', async () => {
  const work = fixture({ sweep: true, batch: [7, 8] });
  await work.run();
  assert.deepEqual(
    work.updates.map((update) => update.pull_number),
    [7, 8],
  );
});
test('manual dispatch accepts a PR number and rejects malformed input', async () => {
  const selected = fixture({ input: '7' });
  await selected.run();
  assert.equal(selected.updates.length, 1);
  const rejected = fixture({ input: '7; command' });
  await assert.rejects(rejected.run(), /positive integer/);
  assert.equal(rejected.updates.length, 0);
});
test('metadata permissions are limited and no untrusted source or expression is executed', () => {
  assert.match(source, /pull_request_target:/);
  assert.match(source, /uses: actions\/github-script@[a-f0-9]{40}\b/);
  assert.doesNotMatch(source, /actions\/checkout/);
  assert.doesNotMatch(script, /\$\{\{|\brequire\(|\beval\(|child_process|downloadArtifact/);
  const permissions = source.split('permissions:\n')[1]?.split('\n\n')[0];
  assert.ok(permissions);
  assert.deepEqual(
    permissions
      .trim()
      .split('\n')
      .map((line) => line.trim())
      .sort(),
    ['contents: read', 'pull-requests: write'],
  );
});
test('BREAKING CHANGE and CRLF trailers retain coauthors without changing the description prefix', async () => {
  const prefix = '<details>\r\nТекст бота\r\n</details>';
  const work = fixture({
    body: prefix,
    messages: [`feat!: contract\r\n\r\nBREAKING CHANGE: new contract\r\n${second}\r\n`],
  });
  await work.run();
  const updated = work.updates[0]?.body;
  assert.ok(updated?.startsWith(prefix + '\n\n'));
  assert.ok(updated?.endsWith(second));
});
