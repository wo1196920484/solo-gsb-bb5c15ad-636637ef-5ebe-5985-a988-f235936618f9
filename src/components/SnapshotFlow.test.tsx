// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import InputStage from './InputStage';
import MergeStage from './MergeStage';
import { threeWayMerge } from '../merge/threeWayMerge';
import {
  buildSnapshot,
  parseSnapshot,
  restoreResolutions,
  serializeSnapshot,
  type ParsedSnapshot,
} from '../merge/snapshot';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 未实现的浏览器 API
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function renderInto(container: HTMLElement, node: ReactElement) {
  const root = createRoot(container);
  act(() => root.render(node));
  return root;
}

function pickSnapshotFile(container: HTMLElement, text: string) {
  const input = container.querySelector('input.snapshot-file-input') as HTMLInputElement;
  const file = new File([text], 'snapshot.json', { type: 'application/json' });
  // jsdom 的 File 未实现 .text()
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('InputStage 快照导入', () => {
  it('快照非法时显示错误且不触发导入、不清空当前输入', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let imported = false;
    renderInto(
      container,
      <InputStage
        onMerge={() => {}}
        onImportSnapshot={() => {
          imported = true;
        }}
      />,
    );

    await act(async () => pickSnapshotFile(container, '{"format":"wrong"}'));

    expect(container.querySelector('.snapshot-error')?.textContent).toContain('快照导入失败');
    expect(container.querySelector('.snapshot-error')?.textContent).toContain('format');
    expect(imported).toBe(false);
  });

  it('快照合法时触发导入回调并传出三份源 JSON', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const merge = threeWayMerge({ a: 1 }, { a: 2 }, { a: 3 });
    const text = serializeSnapshot(
      buildSnapshot({ base: { a: 1 }, ours: { a: 2 }, theirs: { a: 3 } }, merge.conflicts, {
        c0: { kind: 'ours' },
      }),
    );
    let got: ParsedSnapshot | null = null;
    renderInto(
      container,
      <InputStage
        onMerge={() => {}}
        onImportSnapshot={(s) => {
          got = s;
        }}
      />,
    );

    await act(async () => pickSnapshotFile(container, text));

    expect(container.querySelector('.snapshot-error')).toBeNull();
    expect(got).not.toBeNull();
    expect(got!.sources).toEqual({ base: { a: 1 }, ours: { a: 2 }, theirs: { a: 3 } });
    expect(got!.resolutions).toHaveLength(1);
  });
});

describe('MergeStage 快照恢复', () => {
  it('显示恢复/跳过汇总，并定位到首个未解决冲突', () => {
    const base = { a: 1, gone: 5 };
    const ours = { a: 2 };
    const theirs = { a: 3, gone: 6 };
    const merge1 = threeWayMerge(base, ours, theirs);
    const allOurs = Object.fromEntries(merge1.conflicts.map((c) => [c.id, { kind: 'ours' as const }]));
    const parsed = parseSnapshot(
      serializeSnapshot(buildSnapshot({ base, ours, theirs }, merge1.conflicts, allOurs)),
    );

    // 新会话：/a 的目标分支值变了 → 跳过；/gone 一致 → 恢复
    const theirs2 = { a: 99, gone: 6 };
    const merge2 = threeWayMerge(base, ours, theirs2);
    const restore = restoreResolutions(parsed, merge2);
    expect(restore.restored).toBe(1);
    expect(restore.skipped).toHaveLength(1);

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderInto(
      container,
      <MergeStage
        mergeResult={merge2}
        sources={{ base, ours, theirs: theirs2 }}
        resolutions={restore.resolutions}
        restoreSummary={restore}
        onDismissRestoreSummary={() => {}}
        onResolutionsChange={() => {}}
        onFinish={() => {}}
        onBack={() => {}}
      />,
    );

    // 汇总条：恢复 1 项、跳过 1 项，跳过原因含路径与不一致的侧
    const banner = container.querySelector('.restore-summary');
    expect(banner?.textContent).toContain('恢复');
    expect(banner?.textContent).toContain('跳过');
    expect(banner?.textContent).toContain('/a');
    expect(banner?.textContent).toContain('目标分支');

    // 定位到首个未解决冲突 /a，进度 1/2
    expect(container.querySelector('.conflict-detail .pointer')?.textContent).toBe('/a');
    expect(container.querySelector('.progress-line')?.textContent).toContain('1');
    expect(container.querySelector('.tree-row.conflict.selected .key')?.textContent).toBe('a');
  });

  it('无恢复汇总时不显示汇总条，初始定位到第一个冲突', () => {
    const merge = threeWayMerge({ a: 1 }, { a: 2 }, { a: 3 });
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderInto(
      container,
      <MergeStage
        mergeResult={merge}
        sources={{ base: { a: 1 }, ours: { a: 2 }, theirs: { a: 3 } }}
        resolutions={{}}
        restoreSummary={null}
        onDismissRestoreSummary={() => {}}
        onResolutionsChange={() => {}}
        onFinish={() => {}}
        onBack={() => {}}
      />,
    );
    expect(container.querySelector('.restore-summary')).toBeNull();
    expect(container.querySelector('.conflict-detail .pointer')?.textContent).toBe('/a');
  });
});
