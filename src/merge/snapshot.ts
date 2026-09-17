import { deepEqual } from './deepEqual';
import { parsePointer, toPointer } from './pointer';
import type { Conflict, MergeResult, Resolution, Resolutions } from './threeWayMerge';
import { ABSENT, isAbsent, isPlainObject, type JsonValue, type SideValue } from './types';

/** 快照格式标识（format 字段）与当前支持的格式版本 */
export const SNAPSHOT_FORMAT = 'json-three-way-merge/session-snapshot';
export const SNAPSHOT_VERSION = 1;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** 某一侧值的可序列化编码：ABSENT（删除/不存在）无法直接写入 JSON，用 kind 标签区分 */
export type SideSnapshot = { kind: 'absent' } | { kind: 'value'; value: JsonValue };

/** 单个冲突的已选解决方案，附带恢复时用于匹配的三方值指纹 */
export interface SnapshotResolutionEntry {
  pointer: string;
  base: SideSnapshot;
  ours: SideSnapshot;
  theirs: SideSnapshot;
  resolution: Resolution;
}

/** 可序列化的会话快照（下载到文件的完整结构） */
export interface SessionSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  createdAt: string;
  sources: { base: JsonValue; ours: JsonValue; theirs: JsonValue };
  resolutions: SnapshotResolutionEntry[];
}

/** 解析后的快照：侧值已解码为 SideValue，pointer 已按 RFC 6901 规范化 */
export interface ParsedSnapshot {
  sources: { base: JsonValue; ours: JsonValue; theirs: JsonValue };
  resolutions: {
    pointer: string;
    base: SideValue;
    ours: SideValue;
    theirs: SideValue;
    resolution: Resolution;
  }[];
}

export interface SkippedResolution {
  pointer: string;
  reason: string;
}

export interface RestoreResult {
  resolutions: Resolutions;
  restored: number;
  skipped: SkippedResolution[];
}

function encodeSide(v: SideValue): SideSnapshot {
  return isAbsent(v) ? { kind: 'absent' } : { kind: 'value', value: v };
}

/** 由当前会话状态构建快照（只记录已选择的解决方案） */
export function buildSnapshot(
  sources: { base: JsonValue; ours: JsonValue; theirs: JsonValue },
  conflicts: Conflict[],
  resolutions: Resolutions,
): SessionSnapshot {
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
    sources,
    resolutions: conflicts
      .filter((c) => resolutions[c.id] !== undefined)
      .map((c) => ({
        pointer: c.pointer,
        base: encodeSide(c.base),
        ours: encodeSide(c.ours),
        theirs: encodeSide(c.theirs),
        resolution: resolutions[c.id],
      })),
  };
}

export function serializeSnapshot(snapshot: SessionSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

function fail(message: string): never {
  throw new SnapshotError(message);
}

function parseSide(raw: unknown, where: string): SideValue {
  if (!isPlainObject(raw) || (raw.kind !== 'absent' && raw.kind !== 'value')) {
    fail(`${where}必须是 { "kind": "absent" } 或 { "kind": "value", "value": … }`);
  }
  if (raw.kind === 'absent') return ABSENT;
  if (!('value' in raw)) fail(`${where}缺少 value 字段`);
  return raw.value;
}

function parseResolution(raw: unknown, where: string): Resolution {
  if (!isPlainObject(raw)) fail(`${where}：resolution 必须是对象`);
  if (raw.kind === 'ours') return { kind: 'ours' };
  if (raw.kind === 'theirs') return { kind: 'theirs' };
  if (raw.kind === 'custom') {
    if (!('value' in raw)) fail(`${where}：自定义解决方案缺少 value 字段`);
    return { kind: 'custom', value: raw.value };
  }
  fail(`${where}：resolution.kind 必须是 "ours" / "theirs" / "custom"`);
}

/** 解析并校验快照文本；结构或字段非法时抛出 SnapshotError */
export function parseSnapshot(text: string): ParsedSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    fail(`快照不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isPlainObject(raw)) fail('快照结构非法：顶层必须是 JSON 对象');
  if (raw.format !== SNAPSHOT_FORMAT) {
    fail(`无法识别的快照格式（format 应为 "${SNAPSHOT_FORMAT}"）`);
  }
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    fail('快照结构非法：version 必须是正整数');
  }
  if (raw.version > SNAPSHOT_VERSION) {
    fail(`快照版本过新（v${raw.version}），当前最高支持 v${SNAPSHOT_VERSION}`);
  }

  const sources = raw.sources;
  if (!isPlainObject(sources)) fail('快照结构非法：缺少 sources 对象');
  for (const key of ['base', 'ours', 'theirs'] as const) {
    if (!(key in sources)) fail(`快照结构非法：sources 缺少 ${key} 字段`);
  }

  if (!Array.isArray(raw.resolutions)) fail('快照结构非法：resolutions 必须是数组');
  // 显式标注元素类型：避免 ABSENT 的 unique symbol 在对象字面量推断中被拓宽为 symbol
  const resolutions: ParsedSnapshot['resolutions'] = raw.resolutions.map((item, i) => {
    const where = `第 ${i + 1} 条解决方案`;
    if (!isPlainObject(item)) fail(`${where}：必须是对象`);
    if (typeof item.pointer !== 'string') fail(`${where}：pointer 必须是字符串`);
    let segments: string[];
    try {
      segments = parsePointer(item.pointer);
    } catch {
      fail(`${where}：pointer 不是合法的 JSON Pointer`);
    }
    return {
      pointer: toPointer(segments), // 规范化，匹配时不受转义写法影响
      base: parseSide(item.base, `${where}的 base `),
      ours: parseSide(item.ours, `${where}的 ours `),
      theirs: parseSide(item.theirs, `${where}的 theirs `),
      resolution: parseResolution(item.resolution, where),
    };
  });

  return {
    sources: { base: sources.base, ours: sources.ours, theirs: sources.theirs },
    resolutions,
  };
}

/**
 * 将快照中的解决方案应用到一次新的合并结果上。
 * 仅当冲突的 JSON Pointer 及 base / ours / theirs 三方值均与快照一致时才恢复，
 * 绝不按旧冲突序号套用；不一致的条目跳过并记录原因。
 */
export function restoreResolutions(snapshot: ParsedSnapshot, merge: MergeResult): RestoreResult {
  const byPointer = new Map<string, Conflict>();
  for (const c of merge.conflicts) byPointer.set(c.pointer, c);

  const resolutions: Resolutions = {};
  const skipped: SkippedResolution[] = [];
  let restored = 0;

  for (const entry of snapshot.resolutions) {
    const conflict = byPointer.get(entry.pointer);
    if (!conflict) {
      skipped.push({ pointer: entry.pointer, reason: '当前合并结果中该路径不存在冲突' });
      continue;
    }
    if (resolutions[conflict.id] !== undefined) {
      skipped.push({ pointer: entry.pointer, reason: '快照中存在指向同一冲突的重复条目' });
      continue;
    }
    const changed: string[] = [];
    if (!deepEqual(conflict.base, entry.base)) changed.push('基线');
    if (!deepEqual(conflict.ours, entry.ours)) changed.push('当前分支');
    if (!deepEqual(conflict.theirs, entry.theirs)) changed.push('目标分支');
    if (changed.length > 0) {
      skipped.push({
        pointer: entry.pointer,
        reason: `冲突的${changed.join('、')}值与快照不一致`,
      });
      continue;
    }
    resolutions[conflict.id] = entry.resolution;
    restored++;
  }
  return { resolutions, restored, skipped };
}
