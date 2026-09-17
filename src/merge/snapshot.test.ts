import { describe, expect, it } from 'vitest';
import {
  buildSnapshot,
  parseSnapshot,
  restoreResolutions,
  serializeSnapshot,
  SnapshotError,
  SNAPSHOT_VERSION,
} from './snapshot';
import { buildMerged, threeWayMerge, type Resolutions } from './threeWayMerge';
import { ABSENT, type JsonValue } from './types';

// 两个冲突：/a（双方改成不同值）、/gone（当前分支删除、目标分支修改）
const BASE: JsonValue = { a: 1, gone: 5 };
const OURS: JsonValue = { a: 2 };
const THEIRS: JsonValue = { a: 3, gone: 6 };

function snapshotText(resolutions: Resolutions, sources = { base: BASE, ours: OURS, theirs: THEIRS }) {
  const merge = threeWayMerge(sources.base, sources.ours, sources.theirs);
  return serializeSnapshot(buildSnapshot(sources, merge.conflicts, resolutions));
}

function resolveAll(kind: 'ours' | 'theirs' = 'ours') {
  const merge = threeWayMerge(BASE, OURS, THEIRS);
  const resolutions: Resolutions = {};
  for (const c of merge.conflicts) resolutions[c.id] = { kind };
  return { merge, resolutions };
}

describe('会话快照：构建与解析', () => {
  it('构建 → 序列化 → 解析 往返一致', () => {
    const { merge, resolutions } = resolveAll('theirs');
    const text = serializeSnapshot(
      buildSnapshot({ base: BASE, ours: OURS, theirs: THEIRS }, merge.conflicts, resolutions),
    );
    const parsed = parseSnapshot(text);
    expect(parsed.sources).toEqual({ base: BASE, ours: OURS, theirs: THEIRS });
    expect(parsed.resolutions).toHaveLength(2);
    expect(parsed.resolutions.map((r) => r.pointer)).toEqual(['/a', '/gone']);
    expect(parsed.resolutions[0].resolution).toEqual({ kind: 'theirs' });
  });

  it('只记录已选择的解决方案', () => {
    const merge = threeWayMerge(BASE, OURS, THEIRS);
    const text = serializeSnapshot(
      buildSnapshot(
        { base: BASE, ours: OURS, theirs: THEIRS },
        merge.conflicts,
        { [merge.conflicts[0].id]: { kind: 'ours' } }, // /gone 未解决
      ),
    );
    const parsed = parseSnapshot(text);
    expect(parsed.resolutions).toHaveLength(1);
    expect(parsed.resolutions[0].pointer).toBe('/a');
  });

  it('已删除侧（absent）正确编码并解码回 ABSENT', () => {
    const merge = threeWayMerge(BASE, OURS, THEIRS);
    const gone = merge.conflicts.find((c) => c.pointer === '/gone')!;
    const text = serializeSnapshot(
      buildSnapshot({ base: BASE, ours: OURS, theirs: THEIRS }, merge.conflicts, {
        [gone.id]: { kind: 'ours' },
      }),
    );
    expect(text).toContain('"absent"');
    const entry = parseSnapshot(text).resolutions.find((r) => r.pointer === '/gone')!;
    expect(entry.ours).toBe(ABSENT);
    expect(entry.theirs).toEqual(6);
  });

  it('自定义解决方案的 value 原样保留', () => {
    const text = snapshotText({ c0: { kind: 'custom', value: { merged: [1, 2] } } });
    const parsed = parseSnapshot(text);
    expect(parsed.resolutions[0].resolution).toEqual({ kind: 'custom', value: { merged: [1, 2] } });
  });
});

describe('会话快照：恢复', () => {
  it('三方值与指针一致时全部恢复', () => {
    const { resolutions } = resolveAll('theirs');
    const parsed = parseSnapshot(snapshotText(resolutions));

    const merge2 = threeWayMerge(BASE, OURS, THEIRS);
    const restore = restoreResolutions(parsed, merge2);
    expect(restore.restored).toBe(2);
    expect(restore.skipped).toHaveLength(0);
    expect(buildMerged(merge2.root, restore.resolutions)).toEqual({ a: 3, gone: 6 });
  });

  it('按 JSON Pointer 匹配而非旧冲突序号（冲突 id 偏移仍正确恢复）', () => {
    // 旧会话：/a 为 c0，/gone 为 c1；只对 /gone 做了自定义选择
    const merge1 = threeWayMerge(BASE, OURS, THEIRS);
    const gone = merge1.conflicts.find((c) => c.pointer === '/gone')!;
    expect(gone.id).toBe('c1');
    const parsed = parseSnapshot(
      serializeSnapshot(
        buildSnapshot({ base: BASE, ours: OURS, theirs: THEIRS }, merge1.conflicts, {
          [gone.id]: { kind: 'custom', value: 42 },
        }),
      ),
    );

    // 新会话：/a 不再冲突，/gone 的 id 变为 c0
    const merge2 = threeWayMerge(BASE, { a: 1 }, { a: 1, gone: 6 });
    expect(merge2.conflicts).toHaveLength(1);
    expect(merge2.conflicts[0].pointer).toBe('/gone');

    const restore = restoreResolutions(parsed, merge2);
    expect(restore.restored).toBe(1);
    expect(restore.skipped).toHaveLength(0);
    expect(restore.resolutions).toEqual({ c0: { kind: 'custom', value: 42 } });
    expect(buildMerged(merge2.root, restore.resolutions)).toEqual({ a: 1, gone: 42 });
  });

  it('三方值变化时跳过并给出原因', () => {
    const { resolutions } = resolveAll('ours');
    const parsed = parseSnapshot(snapshotText(resolutions));

    // 新会话：/a 的目标分支值变了，/gone 保持不变
    const merge2 = threeWayMerge(BASE, OURS, { a: 99, gone: 6 });
    const restore = restoreResolutions(parsed, merge2);
    expect(restore.restored).toBe(1);
    expect(restore.skipped).toHaveLength(1);
    expect(restore.skipped[0].pointer).toBe('/a');
    expect(restore.skipped[0].reason).toContain('目标分支');
    // 未恢复的冲突保持未解决
    expect(buildMerged(merge2.root, restore.resolutions)).toBeUndefined();
  });

  it('路径不再是冲突时跳过', () => {
    const { resolutions } = resolveAll('ours');
    const parsed = parseSnapshot(snapshotText(resolutions));

    // 新会话：双方都把 /a 改成 2 → 自动合并，不再是冲突
    const merge2 = threeWayMerge(BASE, { a: 2 }, { a: 2, gone: 6 });
    const restore = restoreResolutions(parsed, merge2);
    expect(restore.restored).toBe(1);
    expect(restore.skipped).toHaveLength(1);
    expect(restore.skipped[0].pointer).toBe('/a');
    expect(restore.skipped[0].reason).toContain('不存在冲突');
  });

  it('指向同一冲突的重复条目只恢复首次', () => {
    const { resolutions } = resolveAll('theirs');
    const parsed = parseSnapshot(snapshotText(resolutions));
    parsed.resolutions.push({ ...parsed.resolutions[0], resolution: { kind: 'ours' } });

    const merge2 = threeWayMerge(BASE, OURS, THEIRS);
    const restore = restoreResolutions(parsed, merge2);
    expect(restore.restored).toBe(2);
    expect(restore.skipped).toHaveLength(1);
    expect(restore.skipped[0].reason).toContain('重复');
    // 首次出现的条目生效
    expect(restore.resolutions[merge2.conflicts[0].id]).toEqual({ kind: 'theirs' });
  });

  it('根节点冲突（pointer 为空串）也能恢复', () => {
    const merge1 = threeWayMerge(1, 2, 3);
    const parsed = parseSnapshot(
      serializeSnapshot(
        buildSnapshot({ base: 1, ours: 2, theirs: 3 }, merge1.conflicts, {
          c0: { kind: 'theirs' },
        }),
      ),
    );
    expect(parsed.resolutions[0].pointer).toBe('');

    const merge2 = threeWayMerge(1, 2, 3);
    const restore = restoreResolutions(parsed, merge2);
    expect(restore.restored).toBe(1);
    expect(buildMerged(merge2.root, restore.resolutions)).toBe(3);
  });

  it('恢复「采用已删除的一侧」即删除该键', () => {
    const parsed = parseSnapshot(
      snapshotText({ c0: { kind: 'ours' } }, { base: { gone: 5 }, ours: {}, theirs: { gone: 6 } }),
    );
    const merge2 = threeWayMerge({ gone: 5 }, {}, { gone: 6 });
    const restore = restoreResolutions(parsed, merge2);
    expect(restore.restored).toBe(1);
    expect(buildMerged(merge2.root, restore.resolutions)).toEqual({});
  });
});

describe('会话快照：非法输入', () => {
  const validObject = () => JSON.parse(snapshotText(resolveAll().resolutions)) as Record<string, unknown>;

  it('非 JSON / 非对象 / 格式标识错误', () => {
    expect(() => parseSnapshot('{bad')).toThrow(SnapshotError);
    expect(() => parseSnapshot('{bad')).toThrow(/合法 JSON/);
    expect(() => parseSnapshot('[1,2]')).toThrow(/顶层/);
    expect(() => parseSnapshot('{"format":"other","version":1}')).toThrow(/format/);
    expect(() => parseSnapshot('{"version":1}')).toThrow(/format/);
  });

  it('版本非法或过新', () => {
    const newer = validObject();
    newer.version = SNAPSHOT_VERSION + 1;
    expect(() => parseSnapshot(JSON.stringify(newer))).toThrow(/过新/);

    const bad = validObject();
    bad.version = '1';
    expect(() => parseSnapshot(JSON.stringify(bad))).toThrow(/version/);
  });

  it('sources 缺失字段', () => {
    const s = validObject();
    delete (s.sources as Record<string, unknown>).ours;
    expect(() => parseSnapshot(JSON.stringify(s))).toThrow(/ours/);

    const noSources = validObject();
    delete noSources.sources;
    expect(() => parseSnapshot(JSON.stringify(noSources))).toThrow(/sources/);
  });

  it('resolutions 必须是数组', () => {
    const s = validObject();
    s.resolutions = {};
    expect(() => parseSnapshot(JSON.stringify(s))).toThrow(/resolutions/);
  });

  it('解决方案条目字段非法', () => {
    const badPointerType = validObject();
    (badPointerType.resolutions as Record<string, unknown>[])[0].pointer = 123;
    expect(() => parseSnapshot(JSON.stringify(badPointerType))).toThrow(/pointer/);

    const badPointerSyntax = validObject();
    (badPointerSyntax.resolutions as Record<string, unknown>[])[0].pointer = 'no-slash';
    expect(() => parseSnapshot(JSON.stringify(badPointerSyntax))).toThrow(/JSON Pointer/);

    const sideMissingValue = validObject();
    (sideMissingValue.resolutions as Record<string, unknown>[])[0].base = { kind: 'value' };
    expect(() => parseSnapshot(JSON.stringify(sideMissingValue))).toThrow(/value/);

    const badSideKind = validObject();
    (badSideKind.resolutions as Record<string, unknown>[])[0].theirs = { kind: 'gone' };
    expect(() => parseSnapshot(JSON.stringify(badSideKind))).toThrow(/kind/);

    const customMissingValue = validObject();
    (customMissingValue.resolutions as Record<string, unknown>[])[0].resolution = { kind: 'custom' };
    expect(() => parseSnapshot(JSON.stringify(customMissingValue))).toThrow(/value/);

    const badResolutionKind = validObject();
    (badResolutionKind.resolutions as Record<string, unknown>[])[0].resolution = { kind: 'yours' };
    expect(() => parseSnapshot(JSON.stringify(badResolutionKind))).toThrow(/resolution\.kind/);
  });
});
