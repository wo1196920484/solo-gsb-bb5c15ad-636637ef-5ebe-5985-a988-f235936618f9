import { useState } from 'react';
import ConflictPanel from './ConflictPanel';
import MergeTree from './MergeTree';
import {
  countConflicts,
  type MergeResult,
  type Resolution,
  type Resolutions,
} from '../merge/threeWayMerge';
import { buildSnapshot, serializeSnapshot, type RestoreResult } from '../merge/snapshot';
import type { JsonValue } from '../merge/types';
import { download } from '../download';

interface Props {
  mergeResult: MergeResult;
  sources: { base: JsonValue; ours: JsonValue; theirs: JsonValue };
  resolutions: Resolutions;
  restoreSummary: RestoreResult | null;
  onDismissRestoreSummary: () => void;
  onResolutionsChange: (r: Resolutions) => void;
  onFinish: () => void;
  onBack: () => void;
}

export default function MergeStage({
  mergeResult,
  sources,
  resolutions,
  restoreSummary,
  onDismissRestoreSummary,
  onResolutionsChange,
  onFinish,
  onBack,
}: Props) {
  // 定位到首个未解决的冲突（快照恢复后自动跳过已解决项）
  const [selectedId, setSelectedId] = useState<string | null>(
    mergeResult.conflicts.find((c) => !resolutions[c.id])?.id ??
      mergeResult.conflicts[0]?.id ??
      null,
  );
  const [showUnchanged, setShowUnchanged] = useState(true);

  const { total, resolved } = countConflicts(mergeResult.root, resolutions);
  const allResolved = total === resolved;

  const handleResolve = (id: string, res: Resolution) => {
    const next = { ...resolutions, [id]: res };
    onResolutionsChange(next);
    // 自动跳到下一个未解决的冲突
    const nextUnresolved = mergeResult.conflicts.find((c) => c.id !== id && !next[c.id]);
    if (nextUnresolved) setSelectedId(nextUnresolved.id);
  };

  const handleDownloadSnapshot = () => {
    const snapshot = buildSnapshot(sources, mergeResult.conflicts, resolutions);
    download('merge-session-snapshot.json', serializeSnapshot(snapshot));
  };

  return (
    <>
      <div className="merge-layout">
        <div className="merge-tree-panel">
          <h3>合并树</h3>
          <div className="tree-toolbar">
            <label>
              <input
                type="checkbox"
                checked={showUnchanged}
                onChange={(e) => setShowUnchanged(e.target.checked)}
              />{' '}
              显示未变更节点
            </label>
            <span>点击红色冲突行可定位并解决</span>
          </div>
          <MergeTree
            root={mergeResult.root}
            resolutions={resolutions}
            selectedConflictId={selectedId}
            onSelectConflict={setSelectedId}
            showUnchanged={showUnchanged}
          />
        </div>
        <div className="conflict-panel">
          <h3>冲突解决</h3>
          {restoreSummary && (
            <div className="restore-summary">
              <div className="restore-summary-line">
                <span>
                  📥 快照已导入：恢复 <strong>{restoreSummary.restored}</strong> 项选择
                  {restoreSummary.skipped.length > 0 && (
                    <>
                      ，跳过 <strong>{restoreSummary.skipped.length}</strong> 项
                    </>
                  )}
                </span>
                <button className="small" onClick={onDismissRestoreSummary}>
                  知道了
                </button>
              </div>
              {restoreSummary.skipped.length > 0 && (
                <ul>
                  {restoreSummary.skipped.map((s, i) => (
                    <li key={i}>
                      <code>{s.pointer || '（根节点）'}</code>：{s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="progress-line">
            已解决 <strong>{resolved}</strong> / {total} 个冲突
          </div>
          <div className="progress-bar">
            <div style={{ width: total === 0 ? '100%' : `${(resolved / total) * 100}%` }} />
          </div>
          {allResolved && (
            <div className="all-done">✅ 全部冲突已解决，可以生成合并结果。</div>
          )}
          <ConflictPanel
            conflicts={mergeResult.conflicts}
            resolutions={resolutions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onResolve={handleResolve}
          />
        </div>
      </div>
      <div className="merge-footer">
        <button onClick={onBack}>← 返回重新输入</button>
        <button onClick={handleDownloadSnapshot} title="下载包含三份源 JSON 与当前已选解决方案的会话快照">
          ⬇ 下载会话快照
        </button>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="primary" onClick={onFinish} disabled={!allResolved}>
          生成合并结果 →
        </button>
      </div>
    </>
  );
}
