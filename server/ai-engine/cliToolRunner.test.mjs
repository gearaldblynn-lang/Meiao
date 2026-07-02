import test from 'node:test';
import assert from 'node:assert/strict';

import { createCliToolExecutors, runAllowedCliTool } from './cliToolRunner.mjs';

test('runs Feishu allowlisted CLI-style executor through configured command', async () => {
  const script = [
    'const chunks=[];',
    'process.stdin.on("data",c=>chunks.push(c));',
    'process.stdin.on("end",()=>{',
    'const input=JSON.parse(Buffer.concat(chunks).toString("utf8"));',
    'process.stdout.write(JSON.stringify({url:`https://feishu.test/sheets/${encodeURIComponent(input.args.title)}`}));',
    '});',
  ].join('');
  const result = await runAllowedCliTool({
    executorRef: 'feishu.create_sheet',
    args: { title: '日报' },
    env: {
      SMART_FACTORY_CLI_FEISHU_CREATE_SHEET_COMMAND: JSON.stringify([process.execPath, '-e', script]),
    },
  });

  assert.equal(result[0].type, 'link');
  assert.match(result[0].message.text, /https:\/\/feishu\.test\/sheets/);
});

test('fails Feishu executor when no real CLI command is configured', async () => {
  await assert.rejects(
    () => runAllowedCliTool({
      executorRef: 'feishu.create_sheet',
      args: { title: '日报' },
      env: {},
    }),
    /SMART_FACTORY_CLI_FEISHU_CREATE_SHEET_COMMAND/
  );
});

test('rejects non-allowlisted CLI executor refs', async () => {
  await assert.rejects(
    () => runAllowedCliTool({ executorRef: 'shell.rm', args: {} }),
    /not allowlisted/
  );
});

test('builds executors for enabled tools only', async () => {
  const executors = createCliToolExecutors([
    { name: 'feishu_create_sheet', executorRef: 'feishu.create_sheet', enabled: true },
    { name: 'disabled', executorRef: 'feishu.create_sheet', enabled: false },
  ]);

  assert.deepEqual(Object.keys(executors), ['feishu_create_sheet']);
  await assert.rejects(
    () => executors.feishu_create_sheet({ args: { title: '周报' }, env: {} }),
    /SMART_FACTORY_CLI_FEISHU_CREATE_SHEET_COMMAND/
  );
});
