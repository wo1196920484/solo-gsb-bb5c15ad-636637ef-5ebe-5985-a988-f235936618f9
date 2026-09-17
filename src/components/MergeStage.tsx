import { useState } from 'react';
import ConflictPanel from './ConflictPanel';
import MergeTree from './MergeTree';
import {
  countConflicts,
  type MergeResult,
  type Resolution,
  type Resolutions,
} from '../merge/threeWayMerge';

interface Props {
  mergeResult: MergeResult;
  resolutions: Resolutions;
  onResolutionsChange: (r: Resolutions) => void;
  onFinish: () => void;
  onBack: () => void;
}

export default function MergeStage({
  mergeResult,
  resolutions,
  onResolutionsChange,
  onFinish,
  onBack,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(mergeResult.conflicts[0]?.id ?? null);
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
        <div className="spacer" style={{ flex: 1 }} />
        <button className="primary" onClick={onFinish} disabled={!allResolved}>
          生成合并结果 →
        </button>
      </div>
    </>
  );
}
